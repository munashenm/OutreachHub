import type { Prisma } from "../generated/prisma/client";
import { getDb, type DbClient } from "../lib/db";
import { AppError } from "../lib/errors";
import { fullName } from "../lib/format";
import {
  PAGE_SIZE,
  isLeadStatus,
  isMarketingStatus,
  type LeadStatus,
  type MarketingStatus,
} from "../lib/labels";
import { requiresSuppression } from "../lib/marketing";
import type { ProspectInput } from "../lib/validators";
import { recordActivity } from "./activity-service";
import { findOrCreateCompanyByName } from "./company-service";
import { ensureSuppression } from "./suppression-service";
import type { Actor } from "./types";

export type ProspectQuery = {
  q: string;
  leadStatus: string;
  marketingStatus: string;
  companyId: string;
  sort: string;
  dir: "asc" | "desc";
  page: number;
};

const prospectInclude = {
  company: { select: { id: true, companyName: true } },
} satisfies Prisma.ProspectInclude;

export function prospectWhere(workspaceId: string, query: Omit<ProspectQuery, "page" | "sort" | "dir">): Prisma.ProspectWhereInput {
  const where: Prisma.ProspectWhereInput = { workspaceId };
  if (query.q) {
    where.OR = [
      { firstName: { contains: query.q, mode: "insensitive" } },
      { lastName: { contains: query.q, mode: "insensitive" } },
      { email: { contains: query.q, mode: "insensitive" } },
      { company: { companyName: { contains: query.q, mode: "insensitive" } } },
    ];
  }
  if (isLeadStatus(query.leadStatus)) where.leadStatus = query.leadStatus;
  if (isMarketingStatus(query.marketingStatus)) where.marketingStatus = query.marketingStatus;
  if (query.companyId) where.companyId = query.companyId;
  return where;
}

function prospectOrder(sort: string, dir: "asc" | "desc"): Prisma.ProspectOrderByWithRelationInput | Prisma.ProspectOrderByWithRelationInput[] {
  switch (sort) {
    case "name":
      return [{ lastName: dir }, { firstName: dir }];
    case "email":
      return { email: dir };
    case "company":
      return { company: { companyName: dir } };
    case "leadStatus":
      return { leadStatus: dir };
    case "marketingStatus":
      return { marketingStatus: dir };
    case "updatedAt":
      return { updatedAt: dir };
    default:
      return { createdAt: dir };
  }
}

export async function listProspects(workspaceId: string, query: ProspectQuery) {
  const where = prospectWhere(workspaceId, query);
  const [items, total] = await Promise.all([
    getDb().prospect.findMany({
      where,
      include: prospectInclude,
      orderBy: prospectOrder(query.sort, query.dir),
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    getDb().prospect.count({ where }),
  ]);
  return { items, total, pageSize: PAGE_SIZE };
}

export async function listProspectsForExport(workspaceId: string, query: Omit<ProspectQuery, "page">) {
  const where = prospectWhere(workspaceId, query);
  const total = await getDb().prospect.count({ where });
  if (total > 5000) {
    throw new AppError("Narrow the filters before exporting. Exports are limited to 5,000 prospects.");
  }
  return getDb().prospect.findMany({
    where,
    include: prospectInclude,
    orderBy: prospectOrder(query.sort, query.dir),
  });
}

export async function getProspect(workspaceId: string, id: string) {
  return getDb().prospect.findFirst({
    where: { id, workspaceId },
    include: {
      company: true,
      campaignProspects: {
        include: { campaign: { select: { id: true, name: true, status: true } } },
        orderBy: { addedAt: "desc" },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { actor: { select: { name: true } } },
      },
      statusHistory: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { changedBy: { select: { name: true } } },
      },
    },
  });
}

async function resolveCompanyId(
  db: DbClient,
  actor: Actor,
  input: Pick<ProspectInput, "companyId" | "newCompanyName">,
) {
  if (input.companyId) {
    const company = await db.company.findFirst({
      where: { id: input.companyId, workspaceId: actor.workspaceId },
    });
    if (!company) throw new AppError("Company not found in this workspace.");
    return company.id;
  }
  if (input.newCompanyName) {
    const company = await findOrCreateCompanyByName(db, actor, input.newCompanyName);
    return company.id;
  }
  return null;
}

function prospectFields(input: ProspectInput, companyId: string | null) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    jobTitle: input.jobTitle,
    email: input.email,
    phone: input.phone,
    companyId,
    website: input.website,
    industry: input.industry,
    country: input.country,
    province: input.province,
    city: input.city,
    source: input.source,
    linkedinUrl: input.linkedinUrl,
    notes: input.notes,
    leadStatus: input.leadStatus,
    marketingStatus: input.marketingStatus,
  };
}

async function assertEmailAvailable(db: DbClient, workspaceId: string, email: string, ignoreId?: string) {
  const existing = await db.prospect.findFirst({
    where: { workspaceId, email, ...(ignoreId ? { NOT: { id: ignoreId } } : {}) },
    select: { id: true },
  });
  if (existing) {
    throw new AppError("A prospect with this email already exists in this workspace.");
  }
}

async function applySuppressionForStatus(
  db: DbClient,
  actor: Actor,
  email: string,
  status: MarketingStatus,
) {
  if (!requiresSuppression(status)) return;
  await ensureSuppression(db, actor, {
    email,
    reason: status === "OPTED_OUT" ? "Prospect opted out." : "Prospect blocked.",
    source: "marketing_status",
    campaignId: null,
  });
}

export async function createProspect(actor: Actor, input: ProspectInput) {
  return getDb().$transaction(async (tx) => {
    await assertEmailAvailable(tx, actor.workspaceId, input.email);
    const companyId = await resolveCompanyId(tx, actor, input);
    const prospect = await tx.prospect.create({
      data: { workspaceId: actor.workspaceId, ...prospectFields(input, companyId) },
    });
    await tx.leadStatusHistory.create({
      data: {
        workspaceId: actor.workspaceId,
        prospectId: prospect.id,
        fromStatus: null,
        toStatus: prospect.leadStatus,
        changedById: actor.userId,
      },
    });
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      prospectId: prospect.id,
      companyId,
      type: "PROSPECT_CREATED",
      summary: `Created prospect ${fullName(prospect.firstName, prospect.lastName)}.`,
    });
    await applySuppressionForStatus(tx, actor, prospect.email, prospect.marketingStatus);
    return prospect;
  });
}

export async function updateProspect(actor: Actor, id: string, input: ProspectInput) {
  const current = await getDb().prospect.findFirst({ where: { id, workspaceId: actor.workspaceId } });
  if (!current) throw new AppError("Prospect not found.", 404, "NOT_FOUND");

  return getDb().$transaction(async (tx) => {
    if (input.email !== current.email) {
      await assertEmailAvailable(tx, actor.workspaceId, input.email, id);
    }
    const companyId = await resolveCompanyId(tx, actor, input);
    const data = prospectFields(input, companyId);
    const prospect = await tx.prospect.update({ where: { id: current.id }, data });
    const changedFields = (Object.keys(data) as (keyof typeof data)[]).filter((key) => {
      if (key === "leadStatus" || key === "marketingStatus") return false;
      return data[key] !== current[key];
    });

    if (input.leadStatus !== current.leadStatus) {
      await tx.leadStatusHistory.create({
        data: {
          workspaceId: actor.workspaceId,
          prospectId: prospect.id,
          fromStatus: current.leadStatus,
          toStatus: input.leadStatus,
          changedById: actor.userId,
        },
      });
      await recordActivity(tx, {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        prospectId: prospect.id,
        companyId,
        type: "LEAD_STATUS_CHANGED",
        summary: `Changed ${fullName(prospect.firstName, prospect.lastName)} from ${current.leadStatus} to ${input.leadStatus}.`,
        metadata: { from: current.leadStatus, to: input.leadStatus },
      });
    }

    if (input.marketingStatus !== current.marketingStatus) {
      await recordActivity(tx, {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        prospectId: prospect.id,
        companyId,
        type: "MARKETING_STATUS_CHANGED",
        summary: `Changed marketing status for ${fullName(prospect.firstName, prospect.lastName)} from ${current.marketingStatus} to ${input.marketingStatus}.`,
        metadata: { from: current.marketingStatus, to: input.marketingStatus },
      });
      await applySuppressionForStatus(tx, actor, prospect.email, input.marketingStatus);
    }

    if (changedFields.length > 0) {
      await recordActivity(tx, {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        prospectId: prospect.id,
        companyId,
        type: "PROSPECT_EDITED",
        summary: `Updated prospect ${fullName(prospect.firstName, prospect.lastName)}.`,
        metadata: { fields: changedFields },
      });
    }

    return prospect;
  });
}

export async function changeLeadStatus(actor: Actor, id: string, toStatus: LeadStatus) {
  const current = await getDb().prospect.findFirst({ where: { id, workspaceId: actor.workspaceId } });
  if (!current) throw new AppError("Prospect not found.", 404, "NOT_FOUND");
  if (current.leadStatus === toStatus) return current;

  return getDb().$transaction(async (tx) => {
    const prospect = await tx.prospect.update({
      where: { id: current.id },
      data: { leadStatus: toStatus },
    });
    await tx.leadStatusHistory.create({
      data: {
        workspaceId: actor.workspaceId,
        prospectId: prospect.id,
        fromStatus: current.leadStatus,
        toStatus,
        changedById: actor.userId,
      },
    });
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      prospectId: prospect.id,
      companyId: prospect.companyId,
      type: "LEAD_STATUS_CHANGED",
      summary: `Changed ${fullName(prospect.firstName, prospect.lastName)} from ${current.leadStatus} to ${toStatus}.`,
      metadata: { from: current.leadStatus, to: toStatus },
    });
    return prospect;
  });
}

export async function deleteProspects(actor: Actor, ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  const prospects = await getDb().prospect.findMany({
    where: { workspaceId: actor.workspaceId, id: { in: uniqueIds } },
  });
  if (prospects.length === 0) throw new AppError("No matching prospects were found.");

  await getDb().$transaction(async (tx) => {
    for (const prospect of prospects) {
      await recordActivity(tx, {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        prospectId: prospect.id,
        companyId: prospect.companyId,
        type: "PROSPECT_DELETED",
        summary: `Deleted prospect ${fullName(prospect.firstName, prospect.lastName)} (${prospect.email}).`,
      });
    }
    await tx.prospect.deleteMany({
      where: { workspaceId: actor.workspaceId, id: { in: prospects.map((prospect) => prospect.id) } },
    });
  });
}

export async function listPipeline(workspaceId: string) {
  const [prospects, total] = await Promise.all([
    getDb().prospect.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
      take: 500,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        jobTitle: true,
        leadStatus: true,
        company: { select: { companyName: true } },
      },
    }),
    getDb().prospect.count({ where: { workspaceId } }),
  ]);
  return { prospects, total, truncated: total > prospects.length };
}
