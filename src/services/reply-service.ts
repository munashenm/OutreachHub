import { getDb } from "../lib/db";
import { AppError } from "../lib/errors";
import { replyTargets } from "../lib/gmail-message";
import { ownedByWorkspace } from "../lib/gmail-sync";
import { fullName } from "../lib/format";
import { recordActivity } from "./activity-service";
import { sendGmailMessage } from "./google-service";
import { accessTokenForMailbox } from "./mailbox-service";
import type { Actor } from "./types";

export async function getThread(workspaceId: string, messageId: string) {
  const message = ownedByWorkspace(
    await getDb().message.findFirst({ where: { id: messageId, workspaceId } }),
    workspaceId,
  );
  if (!message) return null;
  const include = {
    prospect: { select: { id: true, firstName: true, lastName: true, email: true, company: { select: { id: true, companyName: true } } } },
    campaign: { select: { id: true, name: true } },
  } as const;
  const messages = message.threadId
    ? await getDb().message.findMany({
      where: { workspaceId, threadId: message.threadId },
      orderBy: { sentAt: "asc" },
      include,
    })
    : await getDb().message.findMany({ where: { id: message.id, workspaceId }, include });
  return { message, messages };
}

export async function sendThreadReply(actor: Actor, input: { messageId: string; to: string; cc: string; subject: string; body: string }) {
  const original = ownedByWorkspace(
    await getDb().message.findFirst({ where: { id: input.messageId, workspaceId: actor.workspaceId } }),
    actor.workspaceId,
  );
  if (!original) throw new AppError("Message not found.", 404, "NOT_FOUND");
  const mailbox = await getDb().mailbox.findFirst({
    where: { workspaceId: actor.workspaceId, provider: "GOOGLE", connectionStatus: "CONNECTED" },
    orderBy: { updatedAt: "desc" },
  });
  if (!mailbox) throw new AppError("Connect the Google Workspace mailbox before replying.");
  const target = replyTargets({
    threadId: original.threadId,
    internetMessageId: original.internetMessageId,
    subject: input.subject,
    fromEmail: input.to,
  });
  const access = await accessTokenForMailbox(mailbox.id, actor.workspaceId);
  const sent = await sendGmailMessage(access.token, {
    from: access.email,
    to: input.to,
    cc: input.cc || undefined,
    subject: input.subject,
    body: input.body,
    threadId: target.threadId,
    inReplyTo: target.inReplyTo,
  });
  const saved = await getDb().$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        workspaceId: actor.workspaceId,
        direction: "OUTBOUND",
        status: "SENT",
        subject: input.subject,
        body: input.body,
        snippet: input.body.slice(0, 180),
        fromEmail: access.email,
        externalId: sent.id,
        threadId: sent.threadId,
        prospectId: original.prospectId,
        campaignId: original.campaignId,
        sentAt: new Date(),
      },
    });
    await tx.mailbox.update({
      where: { id: mailbox.id },
      data: { lastSuccessfulSendAt: new Date(), lastError: null, connectionStatus: "CONNECTED" },
    });
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId === "system" ? null : actor.userId,
      prospectId: original.prospectId,
      campaignId: original.campaignId,
      type: "EMAIL_SENT",
      summary: `Replied to ${input.to}.`,
    });
    return message;
  });
  return saved;
}

export function replyDefaults(message: { threadId: string | null; internetMessageId: string | null; subject: string; fromEmail: string | null; fromName: string | null }) {
  const target = replyTargets(message);
  return { ...target, name: message.fromName ? fullName(message.fromName, "") : target.to };
}
