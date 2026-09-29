import type { LeadStatus } from "../generated/prisma/client";
import { getDb, type DbClient } from "../lib/db";
import { fullName } from "../lib/format";
import { renderTemplate } from "../lib/merge";
import { unsubscribeUrl, withUnsubscribeFooter } from "../lib/unsubscribe";
import { marketingBlockReason } from "../lib/marketing";
import { isWithinSendingWindow, leadStatusAfterReply, leadStatusAfterSend, startOfDayInTimeZone } from "../lib/sending-window";
import { recordActivity } from "./activity-service";
import { headerValue, listGmailThread, sendGmailMessage } from "./google-service";
import { accessTokenForMailbox } from "./mailbox-service";
import { listMicrosoftConversation, sendMicrosoftMessage, type RemoteThreadMessage } from "./microsoft-service";
import { suppressedEmailSet } from "./suppression-service";

const RUN_LIMIT = 25;

export type SendSummary = {
  sent: number;
  skipped: number;
  failed: number;
  replies: number;
  notes: string[];
};

export async function sendDueEmails(input: { workspaceId?: string; campaignId?: string; actorId?: string | null }): Promise<SendSummary> {
  const summary: SendSummary = { sent: 0, skipped: 0, failed: 0, replies: 0, notes: [] };
  const campaigns = await getDb().campaign.findMany({
    where: {
      status: "ACTIVE",
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.campaignId ? { id: input.campaignId } : {}),
    },
    include: { mailbox: true, template: true },
    orderBy: { updatedAt: "asc" },
  });

  for (const campaign of campaigns) {
    if (summary.sent + summary.failed >= RUN_LIMIT) break;
    if (!campaign.mailbox || !campaign.template) {
      summary.notes.push(`${campaign.name} needs a mailbox and a template.`);
      continue;
    }
    const now = new Date();
    if (!isWithinSendingWindow(now, campaign.timezone, campaign.sendingStartTime, campaign.sendingEndTime)) {
      summary.notes.push(`${campaign.name} is outside its sending window.`);
      continue;
    }

    const sentToday = await getDb().message.count({
      where: {
        campaignId: campaign.id,
        direction: "OUTBOUND",
        status: "SENT",
        sentAt: { gte: startOfDayInTimeZone(now, campaign.timezone) },
      },
    });
    let remaining = Math.min(campaign.dailyLimit - sentToday, RUN_LIMIT - summary.sent - summary.failed);
    if (remaining <= 0) {
      summary.notes.push(`${campaign.name} has reached its daily limit.`);
      continue;
    }

    let access: { token: string; email: string; provider: "GOOGLE" | "MICROSOFT" };
    try {
      access = await accessTokenForMailbox(campaign.mailbox.id, campaign.workspaceId);
    } catch {
      summary.notes.push(`${campaign.name}: reconnect the mailbox.`);
      summary.failed += 1;
      continue;
    }

    const links = await getDb().campaignProspect.findMany({
      where: { campaignId: campaign.id, workspaceId: campaign.workspaceId },
      include: { prospect: { include: { company: { select: { companyName: true } } } } },
      orderBy: { addedAt: "asc" },
      take: 300,
    });
    const suppressed = await suppressedEmailSet(campaign.workspaceId, links.map((link) => link.prospect.email));

    for (const link of links) {
      if (remaining <= 0) break;
      const prospect = link.prospect;
      const name = fullName(prospect.firstName, prospect.lastName);
      const existing = await getDb().message.findFirst({
        where: { workspaceId: campaign.workspaceId, campaignId: campaign.id, prospectId: prospect.id, direction: "OUTBOUND" },
      });
      if (existing?.status === "SENT") continue;

      const block = marketingBlockReason(prospect.marketingStatus, suppressed.has(prospect.email));
      if (block) {
        await saveOutbound(campaign.workspaceId, campaign.id, prospect.id, {
          status: "SKIPPED",
          subject: campaign.template.subject,
          body: "",
          error: block,
          sentAt: null,
        });
        summary.skipped += 1;
        continue;
      }

      const values = {
        firstName: prospect.firstName,
        lastName: prospect.lastName,
        email: prospect.email,
        companyName: prospect.company?.companyName ?? "",
        jobTitle: prospect.jobTitle ?? "",
      };
      const subject = renderTemplate(campaign.template.subject, values);
      const unsubscribe = await unsubscribeUrl({
        workspaceId: campaign.workspaceId,
        prospectId: prospect.id,
        campaignId: campaign.id,
      });
      const body = withUnsubscribeFooter(renderTemplate(campaign.template.body, values), unsubscribe);
      const htmlSource = campaign.template.htmlBody?.trim();
      const html = htmlSource ? withUnsubscribeFooter(renderTemplate(htmlSource, values), unsubscribe).replaceAll("\n", "<br>") : undefined;
      try {
        const sent = access.provider === "MICROSOFT"
          ? await sendMicrosoftMessage(access.token, { to: prospect.email, subject, body, listUnsubscribe: unsubscribe })
          : await sendGmailMessage(access.token, { from: access.email, to: prospect.email, subject, body, html, listUnsubscribe: unsubscribe });
        await getDb().$transaction(async (tx) => {
          await saveOutbound(campaign.workspaceId, campaign.id, prospect.id, {
            status: "SENT",
            subject,
            body,
            error: null,
            externalId: sent.id,
            threadId: sent.threadId,
            sentAt: new Date(),
          }, tx);
          const nextStatus = leadStatusAfterSend(prospect.leadStatus);
          if (nextStatus) {
            await tx.prospect.update({ where: { id: prospect.id }, data: { leadStatus: nextStatus as LeadStatus } });
            await tx.leadStatusHistory.create({
              data: {
                workspaceId: campaign.workspaceId,
                prospectId: prospect.id,
                fromStatus: prospect.leadStatus,
                toStatus: nextStatus as LeadStatus,
                changedById: input.actorId ?? null,
              },
            });
          }
          await recordActivity(tx, {
            workspaceId: campaign.workspaceId,
            actorId: input.actorId ?? null,
            prospectId: prospect.id,
            companyId: prospect.companyId,
            campaignId: campaign.id,
            type: "EMAIL_SENT",
            summary: `Sent campaign email to ${name}.`,
          });
        });
        if (campaign.mailbox) {
          await getDb().mailbox.update({
            where: { id: campaign.mailbox.id },
            data: { lastSuccessfulSendAt: new Date(), lastError: null, connectionStatus: "CONNECTED" },
          });
        }
        summary.sent += 1;
        remaining -= 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "The mailbox refused the message.";
        await saveOutbound(campaign.workspaceId, campaign.id, prospect.id, {
          status: "FAILED",
          subject,
          body,
          error: message.slice(0, 500),
          sentAt: null,
        });
        await recordActivity(getDb(), {
          workspaceId: campaign.workspaceId,
          actorId: input.actorId ?? null,
          prospectId: prospect.id,
          campaignId: campaign.id,
          type: "EMAIL_FAILED",
          summary: `Could not email ${name}.`,
          metadata: { error: message.slice(0, 300) },
        });
        summary.failed += 1;
        remaining -= 1;
      }
    }

    summary.replies += await syncReplies({
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      mailboxEmail: access.email,
      accessToken: access.token,
      provider: access.provider,
      actorId: input.actorId ?? null,
    });
  }

  return summary;
}

async function saveOutbound(
  workspaceId: string,
  campaignId: string,
  prospectId: string,
  data: {
    status: "SENT" | "FAILED" | "SKIPPED";
    subject: string;
    body: string;
    error: string | null;
    externalId?: string;
    threadId?: string;
    sentAt: Date | null;
  },
  db: DbClient = getDb(),
) {
  const existing = await db.message.findFirst({
    where: { workspaceId, campaignId, prospectId, direction: "OUTBOUND" },
  });
  if (existing) {
    return db.message.update({ where: { id: existing.id }, data });
  }
  return db.message.create({
    data: { workspaceId, campaignId, prospectId, direction: "OUTBOUND", ...data },
  });
}

async function listThread(provider: "GOOGLE" | "MICROSOFT", accessToken: string, threadId: string): Promise<RemoteThreadMessage[]> {
  if (provider === "MICROSOFT") return listMicrosoftConversation(accessToken, threadId);
  const thread = await listGmailThread(accessToken, threadId);
  return thread.map((item) => ({
    id: item.id,
    from: headerValue(item, "From"),
    subject: headerValue(item, "Subject"),
    snippet: item.snippet ?? "",
  }));
}

async function syncReplies(input: {
  workspaceId: string;
  campaignId: string;
  mailboxEmail: string;
  accessToken: string;
  provider: "GOOGLE" | "MICROSOFT";
  actorId: string | null;
}) {
  const sent = await getDb().message.findMany({
    where: {
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      direction: "OUTBOUND",
      status: "SENT",
      threadId: { not: null },
    },
    include: { prospect: true },
    orderBy: { sentAt: "desc" },
    take: 15,
  });
  let replies = 0;
  for (const message of sent) {
    const prospect = message.prospect;
    if (!message.threadId || !prospect) continue;
    const thread = await listThread(input.provider, input.accessToken, message.threadId);
    for (const item of thread) {
      if (item.id === message.externalId) continue;
      const from = item.from.toLowerCase();
      if (from.includes(input.mailboxEmail.toLowerCase())) continue;
      const already = await getDb().message.findFirst({
        where: { workspaceId: input.workspaceId, externalId: item.id },
        select: { id: true },
      });
      if (already) continue;
      const subject = item.subject || message.subject;
      await getDb().$transaction(async (tx) => {
        await tx.message.create({
          data: {
            workspaceId: input.workspaceId,
            campaignId: input.campaignId,
            prospectId: message.prospectId,
            direction: "INBOUND",
            status: "SENT",
            subject,
            body: item.snippet,
            externalId: item.id,
            threadId: message.threadId,
            sentAt: new Date(),
          },
        });
        const nextStatus = leadStatusAfterReply(prospect.leadStatus);
        if (nextStatus) {
          await tx.prospect.update({ where: { id: prospect.id }, data: { leadStatus: nextStatus as LeadStatus } });
          await tx.leadStatusHistory.create({
            data: {
              workspaceId: input.workspaceId,
              prospectId: prospect.id,
              fromStatus: prospect.leadStatus,
              toStatus: nextStatus as LeadStatus,
              changedById: input.actorId,
            },
          });
        }
        await recordActivity(tx, {
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          prospectId: prospect.id,
          companyId: prospect.companyId,
          campaignId: input.campaignId,
          type: "REPLY_RECEIVED",
          summary: `Reply received from ${fullName(prospect.firstName, prospect.lastName)}.`,
        });
      });
      replies += 1;
    }
  }
  return replies;
}

export async function listInbox(workspaceId: string, page: number) {
  const pageSize = 25;
  const where = { workspaceId };
  const [items, total] = await Promise.all([
    getDb().message.findMany({
      where,
      include: {
        prospect: { select: { id: true, firstName: true, lastName: true, email: true } },
        campaign: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    getDb().message.count({ where }),
  ]);
  return { items, total, pageSize };
}
