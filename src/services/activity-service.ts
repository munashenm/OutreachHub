import type { ActivityType, Prisma } from "../generated/prisma/client";
import type { DbClient } from "../lib/db";
import { getDb } from "../lib/db";

type ActivityInput = {
  workspaceId: string;
  type: ActivityType;
  summary: string;
  actorId?: string | null;
  prospectId?: string | null;
  companyId?: string | null;
  campaignId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export async function recordActivity(db: DbClient, input: ActivityInput) {
  await db.activity.create({
    data: {
      workspaceId: input.workspaceId,
      type: input.type,
      summary: input.summary,
      actorId: input.actorId ?? null,
      prospectId: input.prospectId ?? null,
      companyId: input.companyId ?? null,
      campaignId: input.campaignId ?? null,
      metadata: input.metadata,
    },
  });
}

export async function listActivities(input: {
  workspaceId: string;
  prospectId?: string;
  companyId?: string;
  campaignId?: string;
  take?: number;
  skip?: number;
}) {
  return getDb().activity.findMany({
    where: {
      workspaceId: input.workspaceId,
      prospectId: input.prospectId,
      campaignId: input.campaignId,
      ...(input.companyId
        ? {
            OR: [{ companyId: input.companyId }, { prospect: { companyId: input.companyId } }],
          }
        : {}),
    },
    include: { actor: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: input.take ?? 50,
    skip: input.skip ?? 0,
  });
}

export async function countActivities(workspaceId: string) {
  return getDb().activity.count({ where: { workspaceId } });
}
