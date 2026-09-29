import type { InboxCategory } from "../generated/prisma/client";
import { getDb } from "../lib/db";
import { AppError } from "../lib/errors";
import { ownedByWorkspace } from "../lib/gmail-sync";
import { PAGE_SIZE } from "../lib/labels";
import { recordActivity } from "./activity-service";
import type { Actor } from "./types";

const messageInclude = {
  prospect: { select: { id: true, firstName: true, lastName: true, email: true, company: { select: { id: true, companyName: true } } } },
  campaign: { select: { id: true, name: true } },
} as const;

export async function listInboxMessages(workspaceId: string, page: number) {
  const where = { workspaceId, direction: "INBOUND" as const, ignored: false };
  const [items, total] = await Promise.all([
    getDb().message.findMany({
      where,
      include: messageInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    getDb().message.count({ where }),
  ]);
  return { items, total, pageSize: PAGE_SIZE };
}

async function messageInWorkspace(workspaceId: string, id: string) {
  return ownedByWorkspace(await getDb().message.findFirst({ where: { id, workspaceId } }), workspaceId);
}

export async function setMessageCategory(actor: Actor, id: string, category: InboxCategory) {
  const message = await messageInWorkspace(actor.workspaceId, id);
  if (!message) throw new AppError("Message not found.", 404, "NOT_FOUND");
  await getDb().message.updateMany({ where: { id: message.id, workspaceId: actor.workspaceId }, data: { category } });
  await recordActivity(getDb(), {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    prospectId: message.prospectId,
    campaignId: message.campaignId,
    type: "INBOX_UPDATED",
    summary: `Set a message category to ${category}.`,
  });
}

export async function ignoreMessage(actor: Actor, id: string) {
  const message = await messageInWorkspace(actor.workspaceId, id);
  if (!message) throw new AppError("Message not found.", 404, "NOT_FOUND");
  await getDb().message.updateMany({ where: { id: message.id, workspaceId: actor.workspaceId }, data: { ignored: true } });
}

export async function linkMessageToProspect(actor: Actor, messageId: string, email: string) {
  const message = await messageInWorkspace(actor.workspaceId, messageId);
  if (!message) throw new AppError("Message not found.", 404, "NOT_FOUND");
  const prospect = await getDb().prospect.findFirst({
    where: { workspaceId: actor.workspaceId, email: email.toLowerCase() },
  });
  if (!prospect) throw new AppError("No prospect in this workspace uses that email.");
  await getDb().message.updateMany({
    where: {
      workspaceId: actor.workspaceId,
      OR: [{ id: message.id }, ...(message.threadId ? [{ threadId: message.threadId }] : [])],
      prospectId: null,
    },
    data: { prospectId: prospect.id },
  });
  return prospect;
}

export async function createProspectFromMessage(actor: Actor, messageId: string) {
  const message = await messageInWorkspace(actor.workspaceId, messageId);
  if (!message) throw new AppError("Message not found.", 404, "NOT_FOUND");
  if (!message.fromEmail) throw new AppError("This message has no sender email.");
  if (message.prospectId) return message.prospectId;
  const existing = await getDb().prospect.findFirst({
    where: { workspaceId: actor.workspaceId, email: message.fromEmail },
  });
  if (existing) {
    await linkMessageToProspect(actor, message.id, existing.email);
    return existing.id;
  }
  const name = (message.fromName || message.fromEmail).split(/\s+/);
  const firstName = name[0] || "Unknown";
  const lastName = name.slice(1).join(" ");
  return getDb().$transaction(async (tx) => {
    const prospect = await tx.prospect.create({
      data: {
        workspaceId: actor.workspaceId,
        firstName,
        lastName,
        email: message.fromEmail!,
        source: "gmail",
      },
    });
    await tx.message.updateMany({
      where: { workspaceId: actor.workspaceId, id: message.id },
      data: { prospectId: prospect.id },
    });
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      prospectId: prospect.id,
      type: "PROSPECT_CREATED",
      summary: `Created prospect ${firstName} ${lastName} from an inbound email.`.trim(),
    });
    return prospect.id;
  });
}
