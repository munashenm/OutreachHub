import type { LeadStatus } from "../generated/prisma/client";
import { getDb } from "../lib/db";
import { isUniqueViolation } from "../lib/db";
import { AppError } from "../lib/errors";
import { extractPlainText, parseEmailAddress } from "../lib/gmail-message";
import {
  campaignLinkForInbound,
  isInvalidGrant,
  matchSender,
  planInboundInserts,
  shouldIngestGmailMessage,
} from "../lib/gmail-sync";
import { fullName } from "../lib/format";
import { leadStatusAfterReply } from "../lib/sending-window";
import { recordActivity } from "./activity-service";
import { getGmailMessage, googleAccountEmail, listGmailHistory, listRecentGmailIds, messageHeaders } from "./google-service";
import { accessTokenForMailbox } from "./mailbox-service";

export async function syncConnectedGmail() {
  const mailboxes = await getDb().mailbox.findMany({
    where: { provider: "GOOGLE", connectionStatus: "CONNECTED" },
    select: { id: true, workspaceId: true, email: true },
  });
  const results: { email: string; synced?: number; error?: string }[] = [];
  for (const mailbox of mailboxes) {
    try {
      const synced = await syncGmailMailbox(mailbox.id, mailbox.workspaceId);
      results.push({ email: mailbox.email, synced });
    } catch (error) {
      if (error instanceof AppError && error.code === "SYNC_IN_PROGRESS") {
        results.push({ email: mailbox.email, synced: 0 });
        continue;
      }
      const message = error instanceof Error ? error.message.slice(0, 300) : "Sync failed.";
      results.push({ email: mailbox.email, error: message });
    }
  }
  return results;
}

export async function syncGmailMailbox(mailboxId: string, workspaceId: string) {
  const mailbox = await getDb().mailbox.findFirst({ where: { id: mailboxId, workspaceId, provider: "GOOGLE" } });
  if (!mailbox) throw new AppError("Mailbox not found.", 404, "NOT_FOUND");
  const claimed = await claimSyncLease(mailbox.id, workspaceId);
  if (!claimed) throw new AppError("A Gmail sync is already running for this mailbox.", 409, "SYNC_IN_PROGRESS");
  try {
  let access: { token: string; email: string };
  try {
    access = await accessTokenForMailbox(mailbox.id, workspaceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token refresh failed.";
    if (!isInvalidGrant(message) && !(error instanceof AppError && error.code === "RECONNECT")) {
      await getDb().mailbox.update({
        where: { id: mailbox.id },
        data: { lastError: message.slice(0, 300), lastSyncAt: new Date() },
      });
    }
    throw error;
  }

  const profile = await googleAccountEmail(access.token);
  let ids: string[] = [];
  let nextHistoryId = mailbox.historyId;
  if (!mailbox.historyId) {
    ids = await listRecentGmailIds(access.token);
    nextHistoryId = profile.historyId;
  } else {
    const history = await listGmailHistory(access.token, mailbox.historyId);
    if (history.expired) {
      ids = await listRecentGmailIds(access.token);
      nextHistoryId = profile.historyId;
    } else {
      ids = history.ids.map((item) => item.id);
      nextHistoryId = history.historyId || profile.historyId;
    }
  }

  const existingRows = await getDb().message.findMany({
    where: { workspaceId, externalId: { in: ids } },
    select: { externalId: true },
  });
  const existing = new Set(existingRows.flatMap((row) => (row.externalId ? [row.externalId] : [])));
  const fresh = planInboundInserts(existing, ids.map((externalId) => ({ externalId })));
  let synced = 0;
  for (const item of fresh) {
    const saved = await ingestGmailMessage({
      accessToken: access.token,
      workspaceId,
      mailboxEmail: access.email,
      externalId: item.externalId,
    });
    if (saved) synced += 1;
  }
  await getDb().mailbox.update({
    where: { id: mailbox.id },
    data: {
      historyId: nextHistoryId,
      lastSyncAt: new Date(),
      lastInboundSyncAt: new Date(),
      lastError: null,
      connectionStatus: "CONNECTED",
      syncLeaseUntil: null,
    },
  });
  return synced;
  } finally {
    await getDb().mailbox.updateMany({
      where: { id: mailbox.id, workspaceId },
      data: { syncLeaseUntil: null },
    });
  }
}

async function claimSyncLease(mailboxId: string, workspaceId: string) {
  const now = new Date();
  const claimed = await getDb().mailbox.updateMany({
    where: {
      id: mailboxId,
      workspaceId,
      OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: now } }],
    },
    data: { syncLeaseUntil: new Date(now.getTime() + 10 * 60 * 1000) },
  });
  return claimed.count === 1;
}

async function ingestGmailMessage(input: { accessToken: string; workspaceId: string; mailboxEmail: string; externalId: string }) {
  const message = await getGmailMessage(input.accessToken, input.externalId);
  if (!message || !shouldIngestGmailMessage(message.labelIds)) return false;
  const headers = messageHeaders(message);
  const from = parseEmailAddress(headers.from);
  const own = from.email === input.mailboxEmail.toLowerCase();
  const body = extractPlainText(message.payload);
  const prospects = from.email
    ? await getDb().prospect.findMany({
      where: { workspaceId: input.workspaceId, email: from.email },
      select: { id: true, email: true, companyId: true, leadStatus: true, firstName: true, lastName: true },
    })
    : [];
  const matched = matchSender(from.email, prospects);
  const outbound = await getDb().message.findMany({
    where: { workspaceId: input.workspaceId, threadId: message.threadId, direction: "OUTBOUND" },
    select: { id: true, threadId: true, campaignId: true, prospectId: true },
  });
  const campaign = own ? null : campaignLinkForInbound(message.threadId, outbound);
  const prospect = matched.kind === "matched" ? matched.prospect : null;
  const prospectId = prospect?.id ?? campaign?.prospectId ?? null;
  const companyId = prospect?.companyId ?? null;
  const receivedAt = headers.date ? new Date(headers.date) : new Date();
  try {
    await getDb().$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          workspaceId: input.workspaceId,
          direction: own ? "OUTBOUND" : "INBOUND",
          status: "SENT",
          subject: headers.subject,
          body,
          snippet: message.snippet ?? body.slice(0, 180),
          fromEmail: from.email || null,
          fromName: from.name || null,
          internetMessageId: headers.messageId || null,
          externalId: message.id,
          threadId: message.threadId,
          campaignId: campaign?.campaignId ?? null,
          prospectId,
          category: campaign?.campaignId ? "CAMPAIGN_REPLY" : null,
          sentAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
        },
      });
      if (!own && prospect && campaign?.campaignId) {
        const nextStatus = leadStatusAfterReply(prospect.leadStatus);
        if (nextStatus) {
          await tx.prospect.update({ where: { id: prospect.id }, data: { leadStatus: nextStatus as LeadStatus } });
          await tx.leadStatusHistory.create({
            data: {
              workspaceId: input.workspaceId,
              prospectId: prospect.id,
              fromStatus: prospect.leadStatus,
              toStatus: nextStatus as LeadStatus,
              changedById: null,
            },
          });
        }
        await recordActivity(tx, {
          workspaceId: input.workspaceId,
          prospectId: prospect.id,
          companyId,
          campaignId: campaign.campaignId,
          type: "REPLY_RECEIVED",
          summary: `Reply received from ${fullName(prospect.firstName, prospect.lastName)}.`,
        });
      }
      return created;
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}
