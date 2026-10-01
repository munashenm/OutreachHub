import { getDb } from "../lib/db";
import { addDeliveryRow, emptyDelivery, type DeliveryCounts } from "../lib/delivery";
import { INTERESTED_STATUSES, LEAD_STATUSES } from "../lib/labels";
import { startOfDayInTimeZone } from "../lib/sending-window";

export async function getCampaignDelivery(workspaceId: string, campaignId: string) {
  const rows = await getDb().message.groupBy({
    by: ["direction", "status"],
    where: { workspaceId, campaignId },
    _count: { _all: true },
  });
  const counts = emptyDelivery();
  for (const row of rows) {
    addDeliveryRow(counts, { direction: row.direction, status: row.status, count: row._count._all });
  }
  return counts;
}

export async function getDashboard(workspaceId: string) {
  const db = getDb();
  const where = { workspaceId };
  const today = startOfDayInTimeZone(new Date(), "Africa/Johannesburg");
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
    messageGroups,
    newEnquiries,
    rfqsAwaitingReview,
    repliesToday,
    campaignSentToday,
    respondedLeads,
    mailbox,
  ] = await Promise.all([
    db.prospect.count({ where }),
    db.campaign.count({ where: { ...where, status: "ACTIVE" } }),
    db.message.count({ where: { ...where, direction: "OUTBOUND", status: "SENT" } }),
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
    db.message.groupBy({
      by: ["campaignId", "direction", "status"],
      where: { workspaceId, campaignId: { not: null } },
      _count: { _all: true },
    }),
    db.message.count({
      where: { workspaceId, direction: "INBOUND", ignored: false, OR: [{ category: null }, { category: "NEW_ENQUIRY" }] },
    }),
    db.rfq.count({ where: { workspaceId, status: { in: ["NEW", "SOURCING", "REVIEWING"] } } }),
    db.message.count({ where: { workspaceId, direction: "INBOUND", createdAt: { gte: today } } }),
    db.message.count({
      where: { workspaceId, direction: "OUTBOUND", status: "SENT", campaignId: { not: null }, sentAt: { gte: today } },
    }),
    db.prospect.count({ where: { workspaceId, leadStatus: { in: ["RESPONDED", ...INTERESTED_STATUSES] } } }),
    db.mailbox.findFirst({
      where: { workspaceId, provider: "GOOGLE" },
      select: {
        email: true,
        connectionStatus: true,
        lastSyncAt: true,
        lastError: true,
        lastSuccessfulSendAt: true,
        lastInboundSyncAt: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const deliveryByCampaign: Record<string, DeliveryCounts> = {};
  const delivery = emptyDelivery();
  for (const row of messageGroups) {
    if (!row.campaignId) continue;
    const counts = deliveryByCampaign[row.campaignId] ?? emptyDelivery();
    const item = { direction: row.direction, status: row.status, count: row._count._all };
    addDeliveryRow(counts, item);
    addDeliveryRow(delivery, item);
    deliveryByCampaign[row.campaignId] = counts;
  }

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
    delivery,
    deliveryByCampaign,
    newEnquiries,
    rfqsAwaitingReview,
    repliesToday,
    campaignSentToday,
    respondedLeads,
    mailbox,
  };
}
