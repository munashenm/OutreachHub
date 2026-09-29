import { getDb } from "../lib/db";
import { AppError } from "../lib/errors";
import { planSupplierPriceImport } from "../lib/supplier-feed";
import type { SupplierInput } from "../lib/validators";
import { recordActivity } from "./activity-service";
import type { Actor } from "./types";

export async function listSuppliers(workspaceId: string) {
  return getDb().supplier.findMany({
    where: { workspaceId },
    include: { _count: { select: { prices: true } } },
    orderBy: { name: "asc" },
  });
}

export async function getSupplier(workspaceId: string, id: string) {
  return getDb().supplier.findFirst({
    where: { id, workspaceId },
    include: {
      prices: {
        include: { product: { select: { id: true, sku: true, name: true, unitPriceCents: true, currency: true } } },
        orderBy: { updatedAt: "desc" },
      },
    },
  });
}

export async function createSupplier(actor: Actor, input: SupplierInput) {
  return getDb().supplier.create({
    data: {
      workspaceId: actor.workspaceId,
      name: input.name,
      email: input.email,
      notes: input.notes,
    },
  });
}

export async function lowestCostsByProduct(workspaceId: string, productIds: string[]) {
  if (productIds.length === 0) return new Map<string, number>();
  const rows = await getDb().supplierPrice.findMany({
    where: { workspaceId, productId: { in: productIds } },
    select: { productId: true, costCents: true },
  });
  const costs = new Map<string, number>();
  for (const row of rows) {
    const current = costs.get(row.productId);
    if (current === undefined || row.costCents < current) costs.set(row.productId, row.costCents);
  }
  return costs;
}

export async function importSupplierPrices(actor: Actor, supplierId: string, records: Record<string, string>[]) {
  const supplier = await getDb().supplier.findFirst({
    where: { id: supplierId, workspaceId: actor.workspaceId },
    select: { id: true, name: true },
  });
  if (!supplier) throw new AppError("Supplier not found.", 404, "NOT_FOUND");
  const skus = [...new Set(records.map((record) => (record.sku ?? "").trim().toLowerCase()).filter(Boolean))];
  const products = await getDb().product.findMany({
    where: { workspaceId: actor.workspaceId },
    select: { id: true, sku: true },
  });
  const wanted = new Set(skus);
  const productsBySku = new Map(
    products.filter((product) => wanted.has(product.sku.toLowerCase())).map((product) => [product.sku.toLowerCase(), product.id]),
  );
  const plan = planSupplierPriceImport(records, productsBySku);
  for (const item of plan.ready) {
    await getDb().supplierPrice.upsert({
      where: { supplierId_productId: { supplierId: supplier.id, productId: item.productId } },
      update: { supplierSku: item.supplierSku, costCents: item.costCents },
      create: {
        workspaceId: actor.workspaceId,
        supplierId: supplier.id,
        productId: item.productId,
        supplierSku: item.supplierSku,
        costCents: item.costCents,
      },
    });
  }
  if (plan.ready.length > 0) {
    await recordActivity(getDb(), {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      type: "SUPPLIER_IMPORTED",
      summary: `Imported ${plan.ready.length} prices for ${supplier.name}.`,
    });
  }
  return { updated: plan.ready.length, rejected: plan.rejected };
}
