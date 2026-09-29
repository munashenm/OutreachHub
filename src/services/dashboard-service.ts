import { getDb } from "../lib/db";
import { INTERESTED_STATUSES, LEAD_STATUSES } from "../lib/labels";

export async function getDashboard(workspaceId: string) {
  const db = getDb();
  const where = { workspaceId };
  const [
    totalProspects,
    activeCampaigns,
    emailsSent,
    replies,
    interestedLeads,
    quotesRequested,
    wonOpportunities,
    pipelineGroups,
    marketingGroups,
    recentActivity,
    campaigns,
  ] = await Promise.all([
    db.prospect.count({ where }),
    db.campaign.count({ where: { ...where, status: "ACTIVE" } }),
    db.message.count({ where: { ...where, direction: "OUTBOUND" } }),
    db.message.count({ where: { ...where, direction: "INBOUND" } }),
    db.prospect.count({ where: { ...where, leadStatus: { in: [...INTERESTED_STATUSES] } } }),
    db.prospect.count({ where: { ...where, leadStatus: "QUOTE_REQUESTED" } }),
    db.prospect.count({ where: { ...where, leadStatus: "WON" } }),
    db.prospect.groupBy({ by: ["leadStatus"], where, _count: { _all: true } }),
    db.prospect.groupBy({ by: ["marketingStatus"], where, _count: { _all: true } }),
    db.activity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { actor: { select: { name: true } } },
    }),
    db.campaign.findMany({
      where: { ...where, status: { not: "ARCHIVED" } },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: { _count: { select: { prospects: true } } },
    }),
  ]);

  const pipeline = LEAD_STATUSES.map((status) => ({
    status,
    count: pipelineGroups.find((group) => group.leadStatus === status)?._count._all ?? 0,
  }));

  return {
    totalProspects,
    activeCampaigns,
    emailsSent,
    replies,
    interestedLeads,
    quotesRequested,
    wonOpportunities,
    pipeline,
    marketingGroups,
    recentActivity,
    campaigns,
  };
}
