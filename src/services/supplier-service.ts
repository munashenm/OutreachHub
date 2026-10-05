import { getDb } from "../lib/db";
import { missingDistributors } from "../lib/distributors";
import { AppError } from "../lib/errors";
import { chooseSupplierOffer, matchCatalogueOffer, offersFromCsvRecords, type SupplierOffer } from "../lib/supplier-connector";
import { planSupplierPriceImport } from "../lib/supplier-feed";
import type { SupplierInput } from "../lib/validators";
import { recordActivity } from "./activity-service";
import { saveSupplierOffers } from "./stock-sync-service";
import type { Actor } from "./types";

export async function listSuppliers(workspaceId: string) {
  return getDb().supplier.findMany({
    where: { workspaceId },
    include: { _count: { select: { prices: true, feedItems: true } } },
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
        take: 100,
      },
      feedItems: { orderBy: { updatedAt: "desc" }, take: 100 },
      imports: { orderBy: { uploadedAt: "desc" }, take: 30 },
      _count: { select: { feedItems: true } },
    },
  });
}

export async function createSupplier(actor: Actor, input: SupplierInput) {
  const db = getDb();
  const existing = await db.supplier.findFirst({
    where: { workspaceId: actor.workspaceId, name: { equals: input.name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) throw new AppError("This supplier is already in the workspace.");
  return db.supplier.create({
    data: {
      workspaceId: actor.workspaceId,
      name: input.name,
      email: input.email,
      country: input.country,
      notes: input.notes,
    },
  });
}

export async function addMissingDistributors(actor: Actor) {
  const db = getDb();
  const existing = await db.supplier.findMany({ where: { workspaceId: actor.workspaceId }, select: { name: true } });
  const missing = missingDistributors(existing.map((supplier) => supplier.name));
  for (const distributor of missing) {
    await db.supplier.create({
      data: {
        workspaceId: actor.workspaceId,
        name: distributor.name,
        country: distributor.country,
        notes: distributor.notes,
      },
    });
  }
  return missing.length;
}

export async function lowestCostsByProduct(workspaceId: string, productIds: string[]) {
  if (productIds.length === 0) return new Map<string, number>();
  const rows = await getDb().supplierPrice.findMany({
    where: { workspaceId, productId: { in: productIds } },
    select: {
      productId: true,
      supplierId: true,
      costCents: true,
      costKnown: true,
      stockQty: true,
      stockKnown: true,
      updatedAt: true,
      leadTimeDays: true,
      supplier: { select: { preference: true, leadTimeDays: true, priceSyncIntervalMinutes: true } },
    },
  });
  const costs = new Map<string, number>();
  const now = new Date();
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = grouped.get(row.productId) ?? [];
    list.push(row);
    grouped.set(row.productId, list);
  }
  for (const [productId, offers] of grouped) {
    const chosen = chooseSupplierOffer(offers.map((row) => ({
      supplierId: row.supplierId,
      costCents: row.costCents,
      costKnown: row.costKnown,
      stockQty: row.stockQty,
      stockKnown: row.stockKnown,
      updatedAt: row.updatedAt,
      preference: row.supplier.preference,
      leadTimeDays: row.leadTimeDays ?? row.supplier.leadTimeDays,
      priceFreshMs: row.supplier.priceSyncIntervalMinutes * 60 * 1000,
    })), 1, now);
    if (chosen?.costCents != null) costs.set(productId, chosen.costCents);
  }
  return costs;
}

export async function importSupplierPrices(actor: Actor, supplierId: string, records: Record<string, string>[]) {
  const supplier = await getDb().supplier.findFirst({
    where: { id: supplierId, workspaceId: actor.workspaceId },
    select: { id: true, name: true },
  });
  if (!supplier) throw new AppError("Supplier not found.", 404, "NOT_FOUND");
  const products = await getDb().product.findMany({
    where: { workspaceId: actor.workspaceId },
    select: { id: true, sku: true },
  });
  const productsBySku = new Map(products.map((product) => [product.sku.toLowerCase(), product.id]));
  const links = await getDb().supplierPrice.findMany({
    where: { workspaceId: actor.workspaceId },
    select: { manufacturerPartNumber: true, productId: true },
  });
  const productByMpn = new Map<string, string>();
  for (const link of links) {
    if (link.manufacturerPartNumber) productByMpn.set(link.manufacturerPartNumber.toLowerCase(), link.productId);
  }
  const plan = planSupplierPriceImport(records, productsBySku);
  const readyOffers: SupplierOffer[] = plan.ready.map((item) => {
    const record = records[item.row - 2] ?? {};
    const offer = offersFromCsvRecords([record]).offers[0];
    return {
      supplierSku: item.supplierSku,
      manufacturerPartNumber: offer?.manufacturerPartNumber ?? "",
      name: offer?.name ?? "",
      brand: offer?.brand ?? "",
      costCents: item.costCents,
      stockQty: offer?.stockQty ?? null,
      description: offer?.description ?? "",
      specifications: offer?.specifications ?? "",
      imageUrls: offer?.imageUrls ?? [],
      category: offer?.category ?? "",
      leadTimeDays: offer?.leadTimeDays ?? null,
      matchSkus: [item.sku, item.supplierSku],
    };
  });
  const rejected = plan.rejected.filter((item) => {
    if (!item.reason.includes("not added")) return true;
    const record = records[item.row - 2];
    const offer = record ? offersFromCsvRecords([record]).offers[0] : undefined;
    if (!offer?.manufacturerPartNumber || offer.costCents === null) return true;
    const productId = matchCatalogueOffer(offer, productsBySku, productByMpn);
    if (!productId) return true;
    readyOffers.push({ ...offer, matchSkus: [offer.manufacturerPartNumber, offer.supplierSku] });
    return false;
  });
  if (readyOffers.length > 0) {
    await saveSupplierOffers(actor, supplier.id, readyOffers, {
      applyPrice: false,
      applyStock: readyOffers.some((offer) => offer.stockQty !== null),
      preserveMissing: true,
    });
  }
  if (readyOffers.length > 0) {
    await recordActivity(getDb(), {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      type: "SUPPLIER_IMPORTED",
      summary: `Imported ${readyOffers.length} prices for ${supplier.name}.`,
    });
  }
  return { updated: readyOffers.length, rejected };
}
