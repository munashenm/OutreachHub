import type { RfqStatus } from "../generated/prisma/client";
import { getDb } from "../lib/db";
import { AppError } from "../lib/errors";
import { ownedByWorkspace, rfqDraftFromMessage } from "../lib/gmail-sync";
import { recordActivity } from "./activity-service";
import type { Actor } from "./types";

const include = {
  prospect: { select: { id: true, firstName: true, lastName: true, email: true } },
  company: { select: { id: true, companyName: true } },
  sourceMessage: true,
} as const;

export async function listRfqs(workspaceId: string) {
  return getDb().rfq.findMany({
    where: { workspaceId },
    include,
    orderBy: { updatedAt: "desc" },
  });
}

export async function getRfq(workspaceId: string, id: string) {
  const rfq = await getDb().rfq.findFirst({ where: { id, workspaceId }, include });
  return ownedByWorkspace(rfq, workspaceId);
}

export async function createRfqFromMessage(actor: Actor, messageId: string) {
  const message = ownedByWorkspace(
    await getDb().message.findFirst({
      where: { id: messageId, workspaceId: actor.workspaceId },
      include: { prospect: { select: { companyId: true } } },
    }),
    actor.workspaceId,
  );
  if (!message) throw new AppError("Message not found.", 404, "NOT_FOUND");
  const draft = rfqDraftFromMessage({
    subject: message.subject,
    body: message.body,
    prospectId: message.prospectId,
    companyId: message.prospect?.companyId ?? null,
  });
  return getDb().$transaction(async (tx) => {
    const rfq = await tx.rfq.create({
      data: {
        workspaceId: actor.workspaceId,
        sourceMessageId: message.id,
        subject: draft.subject,
        description: draft.description,
        prospectId: draft.prospectId,
        companyId: draft.companyId,
      },
    });
    if (!message.category) {
      await tx.message.update({ where: { id: message.id }, data: { category: "RFQ" } });
    }
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      prospectId: draft.prospectId,
      companyId: draft.companyId,
      type: "RFQ_CREATED",
      summary: `Created an RFQ from “${draft.subject}”.`,
    });
    return rfq;
  });
}

export async function updateRfq(actor: Actor, id: string, input: { status: RfqStatus; notes: string }) {
  const current = await getRfq(actor.workspaceId, id);
  if (!current) throw new AppError("RFQ not found.", 404, "NOT_FOUND");
  return getDb().rfq.update({
    where: { id: current.id },
    data: { status: input.status, notes: input.notes },
  });
}
