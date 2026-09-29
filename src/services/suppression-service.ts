import type { Prisma } from "../generated/prisma/client";
import { getDb, type DbClient } from "../lib/db";
import { AppError } from "../lib/errors";
import type { SuppressionInput } from "../lib/validators";
import { recordActivity } from "./activity-service";
import type { Actor } from "./types";

export async function listSuppressions(workspaceId: string) {
  return getDb().suppression.findMany({
    where: { workspaceId },
    include: {
      user: { select: { name: true } },
      campaign: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function suppressedEmailSet(workspaceId: string, emails: string[]) {
  if (emails.length === 0) return new Set<string>();
  const rows = await getDb().suppression.findMany({
    where: { workspaceId, email: { in: emails } },
    select: { email: true },
  });
  return new Set(rows.map((row) => row.email));
}

export async function ensureSuppression(
  db: DbClient,
  actor: Actor,
  input: { email: string; reason: string; source?: string | null; campaignId?: string | null },
) {
  const existing = await db.suppression.findUnique({
    where: { workspaceId_email: { workspaceId: actor.workspaceId, email: input.email } },
  });
  if (existing) return existing;

  const created = await db.suppression.create({
    data: {
      workspaceId: actor.workspaceId,
      email: input.email,
      reason: input.reason,
      source: input.source ?? null,
      campaignId: input.campaignId ?? null,
      userId: actor.userId,
    },
  });
  await recordActivity(db, {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    campaignId: input.campaignId ?? null,
    type: "SUPPRESSION_ADDED",
    summary: `Added ${input.email} to the suppression list.`,
    metadata: { reason: input.reason, source: input.source ?? null },
  });
  return created;
}

export async function addSuppression(actor: Actor, input: SuppressionInput) {
  if (input.campaignId) {
    const campaign = await getDb().campaign.findFirst({
      where: { id: input.campaignId, workspaceId: actor.workspaceId },
      select: { id: true },
    });
    if (!campaign) throw new AppError("Campaign not found in this workspace.");
  }
  const existing = await getDb().suppression.findUnique({
    where: { workspaceId_email: { workspaceId: actor.workspaceId, email: input.email } },
  });
  if (existing) {
    throw new AppError("This email address is already on the suppression list.");
  }
  return getDb().$transaction((tx) => ensureSuppression(tx, actor, input));
}

export async function removeSuppression(actor: Actor, id: string) {
  const row = await getDb().suppression.findFirst({
    where: { id, workspaceId: actor.workspaceId },
  });
  if (!row) throw new AppError("Suppression record not found.", 404, "NOT_FOUND");
  await getDb().$transaction(async (tx) => {
    await tx.suppression.deleteMany({ where: { id: row.id, workspaceId: actor.workspaceId } });
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      campaignId: row.campaignId,
      type: "SUPPRESSION_REMOVED",
      summary: `Removed ${row.email} from the suppression list.`,
      metadata: { reason: row.reason },
    });
  });
}

export type SuppressionWhere = Prisma.SuppressionWhereInput;
