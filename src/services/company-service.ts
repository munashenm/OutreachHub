import type { Prisma } from "../generated/prisma/client";
import { getDb, type DbClient } from "../lib/db";
import { AppError } from "../lib/errors";
import type { CompanyInput } from "../lib/validators";
import { recordActivity } from "./activity-service";
import type { Actor } from "./types";

export async function listCompanies(workspaceId: string, query: { q: string; page: number }) {
  const where: Prisma.CompanyWhereInput = {
    workspaceId,
    ...(query.q
      ? { companyName: { contains: query.q, mode: "insensitive" } }
      : {}),
  };
  const pageSize = 25;
  const [items, total] = await Promise.all([
    getDb().company.findMany({
      where,
      include: { _count: { select: { prospects: true } } },
      orderBy: { companyName: "asc" },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    getDb().company.count({ where }),
  ]);
  return { items, total, pageSize };
}

export async function listCompanyOptions(workspaceId: string) {
  return getDb().company.findMany({
    where: { workspaceId },
    select: { id: true, companyName: true },
    orderBy: { companyName: "asc" },
  });
}

export async function getCompany(workspaceId: string, id: string) {
  return getDb().company.findFirst({
    where: { id, workspaceId },
    include: {
      prospects: {
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        include: {
          campaignProspects: { include: { campaign: { select: { id: true, name: true, status: true } } } },
        },
      },
    },
  });
}

async function companyOrThrow(workspaceId: string, id: string) {
  const company = await getDb().company.findFirst({ where: { id, workspaceId } });
  if (!company) throw new AppError("Company not found.", 404, "NOT_FOUND");
  return company;
}

export async function createCompany(actor: Actor, input: CompanyInput) {
  return getDb().$transaction(async (tx) => {
    const company = await tx.company.create({
      data: { ...input, workspaceId: actor.workspaceId },
    });
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      companyId: company.id,
      type: "COMPANY_CREATED",
      summary: `Created company ${company.companyName}.`,
    });
    return company;
  });
}

export async function updateCompany(actor: Actor, id: string, input: CompanyInput) {
  await companyOrThrow(actor.workspaceId, id);
  return getDb().$transaction(async (tx) => {
    const company = await tx.company.update({
      where: { id },
      data: input,
    });
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      companyId: company.id,
      type: "COMPANY_EDITED",
      summary: `Updated company ${company.companyName}.`,
    });
    return company;
  });
}

export async function deleteCompany(actor: Actor, id: string) {
  const company = await getDb().company.findFirst({
    where: { id, workspaceId: actor.workspaceId },
    include: { _count: { select: { prospects: true } } },
  });
  if (!company) throw new AppError("Company not found.", 404, "NOT_FOUND");
  if (company._count.prospects > 0) {
    throw new AppError("Reassign or remove this company's contacts before deleting it.");
  }
  await getDb().$transaction(async (tx) => {
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      type: "COMPANY_DELETED",
      summary: `Deleted company ${company.companyName}.`,
    });
    await tx.company.deleteMany({ where: { id, workspaceId: actor.workspaceId } });
  });
}

export async function findOrCreateCompanyByName(db: DbClient, actor: Actor, companyName: string) {
  const existing = await db.company.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      companyName: { equals: companyName, mode: "insensitive" },
    },
  });
  if (existing) return existing;
  const company = await db.company.create({
    data: { workspaceId: actor.workspaceId, companyName },
  });
  await recordActivity(db, {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    companyId: company.id,
    type: "COMPANY_CREATED",
    summary: `Created company ${company.companyName}.`,
  });
  return company;
}
