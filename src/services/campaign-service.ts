import { getDb } from "../lib/db";
import { AppError } from "../lib/errors";
import { fullName } from "../lib/format";
import type { CampaignStatus } from "../lib/labels";
import { marketingBlockReason } from "../lib/marketing";
import type { CampaignInput } from "../lib/validators";
import { recordActivity } from "./activity-service";
import { suppressedEmailSet } from "./suppression-service";
import type { Actor } from "./types";

export async function listCampaigns(workspaceId: string) {
  return getDb().campaign.findMany({
    where: { workspaceId },
    include: { _count: { select: { prospects: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getCampaign(workspaceId: string, id: string) {
  return getDb().campaign.findFirst({
    where: { id, workspaceId },
    include: {
      prospects: {
        include: {
          prospect: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              marketingStatus: true,
              leadStatus: true,
              company: { select: { companyName: true } },
            },
          },
        },
        orderBy: { addedAt: "desc" },
      },
    },
  });
}

export async function listCampaignOptions(workspaceId: string) {
  return getDb().campaign.findMany({
    where: { workspaceId, status: { not: "ARCHIVED" } },
    select: { id: true, name: true, status: true },
    orderBy: { name: "asc" },
  });
}

export async function createCampaign(actor: Actor, input: CampaignInput) {
  return getDb().$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: { ...input, workspaceId: actor.workspaceId },
    });
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      campaignId: campaign.id,
      type: "CAMPAIGN_CREATED",
      summary: `Created campaign ${campaign.name}.`,
    });
    return campaign;
  });
}

export async function updateCampaign(actor: Actor, id: string, input: CampaignInput) {
  const current = await getDb().campaign.findFirst({
    where: { id, workspaceId: actor.workspaceId },
  });
  if (!current) throw new AppError("Campaign not found.", 404, "NOT_FOUND");
  return getDb().$transaction(async (tx) => {
    const campaign = await tx.campaign.update({ where: { id: current.id }, data: input });
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      campaignId: campaign.id,
      type: "CAMPAIGN_UPDATED",
      summary: `Updated campaign ${campaign.name}.`,
      metadata: { status: campaign.status satisfies CampaignStatus },
    });
    return campaign;
  });
}

export async function deleteCampaign(actor: Actor, id: string) {
  const campaign = await getDb().campaign.findFirst({
    where: { id, workspaceId: actor.workspaceId },
  });
  if (!campaign) throw new AppError("Campaign not found.", 404, "NOT_FOUND");
  await getDb().$transaction(async (tx) => {
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      type: "CAMPAIGN_UPDATED",
      summary: `Deleted campaign ${campaign.name}.`,
    });
    await tx.campaign.deleteMany({ where: { id: campaign.id, workspaceId: actor.workspaceId } });
  });
}

export async function addProspectsToCampaign(actor: Actor, campaignId: string, prospectIds: string[]) {
  const campaign = await getDb().campaign.findFirst({
    where: { id: campaignId, workspaceId: actor.workspaceId },
  });
  if (!campaign) throw new AppError("Campaign not found.", 404, "NOT_FOUND");
  if (campaign.status === "ARCHIVED") {
    throw new AppError("Archived campaigns cannot accept prospects.");
  }

  const uniqueIds = [...new Set(prospectIds)];
  const prospects = await getDb().prospect.findMany({
    where: { workspaceId: actor.workspaceId, id: { in: uniqueIds } },
  });
  const found = new Set(prospects.map((prospect) => prospect.id));
  const suppressed = await suppressedEmailSet(
    actor.workspaceId,
    prospects.map((prospect) => prospect.email),
  );
  const existingLinks = await getDb().campaignProspect.findMany({
    where: { workspaceId: actor.workspaceId, campaignId: campaign.id, prospectId: { in: uniqueIds } },
    select: { prospectId: true },
  });
  const alreadyAdded = new Set(existingLinks.map((link) => link.prospectId));

  const added: string[] = [];
  const rejected: { email: string; name: string; reason: string }[] = [];

  for (const id of uniqueIds) {
    if (!found.has(id)) {
      rejected.push({ email: "", name: "Unknown prospect", reason: "Prospect not found in this workspace." });
    }
  }

  await getDb().$transaction(async (tx) => {
    for (const prospect of prospects) {
      const name = fullName(prospect.firstName, prospect.lastName);
      const reason = marketingBlockReason(prospect.marketingStatus, suppressed.has(prospect.email));
      if (reason) {
        rejected.push({ email: prospect.email, name, reason });
        continue;
      }
      if (alreadyAdded.has(prospect.id)) {
        rejected.push({ email: prospect.email, name, reason: "Already in this campaign." });
        continue;
      }
      await tx.campaignProspect.create({
        data: {
          workspaceId: actor.workspaceId,
          campaignId: campaign.id,
          prospectId: prospect.id,
          addedById: actor.userId,
        },
      });
      await recordActivity(tx, {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        prospectId: prospect.id,
        companyId: prospect.companyId,
        campaignId: campaign.id,
        type: "PROSPECT_ADDED_TO_CAMPAIGN",
        summary: `Added ${name} to campaign ${campaign.name}.`,
      });
      added.push(prospect.id);
    }
  });

  return { added, rejected };
}

export async function removeProspectFromCampaign(actor: Actor, campaignId: string, prospectId: string) {
  const link = await getDb().campaignProspect.findFirst({
    where: { campaignId, prospectId, workspaceId: actor.workspaceId },
    include: { prospect: true, campaign: true },
  });
  if (!link) throw new AppError("That prospect is not in this campaign.", 404, "NOT_FOUND");
  await getDb().$transaction(async (tx) => {
    await tx.campaignProspect.deleteMany({
      where: { id: link.id, workspaceId: actor.workspaceId },
    });
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      prospectId: link.prospectId,
      companyId: link.prospect.companyId,
      campaignId: link.campaignId,
      type: "CAMPAIGN_UPDATED",
      summary: `Removed ${fullName(link.prospect.firstName, link.prospect.lastName)} from campaign ${link.campaign.name}.`,
    });
  });
}

export async function listEligibleProspects(workspaceId: string, campaignId: string) {
  const linked = await getDb().campaignProspect.findMany({
    where: { workspaceId, campaignId },
    select: { prospectId: true },
  });
  return getDb().prospect.findMany({
    where: {
      workspaceId,
      id: { notIn: linked.map((item) => item.prospectId) },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      marketingStatus: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 200,
  });
}
