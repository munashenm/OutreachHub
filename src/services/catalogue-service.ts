import { Prisma } from "../generated/prisma/client";
import { getDb } from "../lib/db";
import { AppError } from "../lib/errors";
import { acceptProductImage } from "../lib/automation";
import {
  analyseCatalogue,
  catalogueDifference,
  mpnKey,
  parseStoreCataloguePage,
  secretFieldPaths,
  sharesDuplicateKey,
  skuKey,
  type CatalogueOfferView,
  type CatalogueRecord,
  type CatalogueStats,
} from "../lib/catalogue-reconcile";
import { markedUpCents } from "../lib/stock";
import { classFromScorecard, SCORECARD_FIELD_SELECT } from "../lib/supplier-scorecard";
import { chooseSupplierOffer, selectedSupplierStock, type SupplierChoice } from "../lib/supplier-connector";
import { verifiedProductImageUrls } from "./external-sourcing-service";
import { loadStoreProvider } from "./store/load";

async function listCataloguePage(provider: { listCatalogue(page: number, perPage: number): Promise<unknown> }, page: number, perPage: number) {
  try {
    return await provider.listCatalogue(page, perPage);
  } catch (error) {
    if (error instanceof AppError) throw error;
    return provider.listCatalogue(page, perPage);
  }
}

function safeCatalogueFailure(error: unknown) {
  if (error instanceof AppError) return error.message;
  if (error instanceof Prisma.PrismaClientKnownRequestError) return `The catalogue could not be saved (${error.code}).`;
  if (error instanceof Prisma.PrismaClientValidationError) return "The catalogue page included a value that could not be saved.";
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "The store catalogue request timed out.";
  return error instanceof Error ? `The store catalogue could not be read (${error.name}).` : "The store catalogue could not be read.";
}

const PAGE_SIZE = 40;
const MANUAL = new Set(["ACCEPTED", "REJECTED", "IGNORED", "MERGED", "IMAGE_REVIEW_REQUIRED"]);

export async function readStoreCatalogueBatch(workspaceId: string) {
  const loaded = await loadStoreProvider(workspaceId);
  if (!loaded) throw new AppError("Connect the store under Settings before reading the catalogue.");
  const db = getDb();
  let scan = await db.storeCatalogueScan.findFirst({
    where: { workspaceId, status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });
  if (!scan) {
    const failed = await db.storeCatalogueScan.findFirst({
      where: { workspaceId, status: "FAILED" },
      orderBy: { startedAt: "desc" },
    });
    scan = failed
      ? await db.storeCatalogueScan.update({ where: { id: failed.id }, data: { status: "RUNNING", error: null } })
      : await db.storeCatalogueScan.create({
          data: { workspaceId, status: "RUNNING", page: 1, perPage: 100, readOnly: true },
        });
  }
  const scanId = scan.id;
  let parsed;
  try {
    const body = await listCataloguePage(loaded.provider, scan.page, scan.perPage);
    const page = parseStoreCataloguePage(body);
    if ("error" in page) throw new AppError(page.error);
    parsed = page;
  } catch (error) {
    const message = safeCatalogueFailure(error);
    await db.storeCatalogueScan.update({ where: { id: scan.id }, data: { status: "FAILED", error: message.slice(0, 300) } });
    throw new AppError(message);
  }
  const products = [...new Map(parsed.products.map((product) => [product.storeProductId, product])).values()];
  if (products.length > 0) {
    for (let index = 0; index < products.length; index += 10) {
      const chunk = products.slice(index, index + 10);
      await db.$transaction(chunk.map((product) => db.storeCatalogueItem.upsert({
      where: { workspaceId_storeProductId: { workspaceId, storeProductId: product.storeProductId } },
      create: {
        workspaceId,
        scanId,
        storeProductId: product.storeProductId,
        sku: product.sku,
        skuKey: product.skuKey,
        manufacturerPartNumber: product.manufacturerPartNumber,
        mpnKey: product.mpnKey,
        barcode: product.barcode,
        barcodeKey: product.barcodeKey,
        name: product.name,
        brand: product.brand,
        brandModelKey: product.brandModelKey,
        category: product.category,
        unitPriceCents: product.unitPriceCents,
        salePriceCents: product.salePriceCents,
        currency: product.currency,
        stockQuantity: product.stockQuantity,
        stockStatus: product.stockStatus,
        description: product.description,
        specifications: product.specifications,
        imageUrls: product.imageUrls,
        published: product.published,
        slug: product.slug,
        url: product.url,
        storeUpdatedAt: product.storeUpdatedAt ? new Date(product.storeUpdatedAt) : null,
      },
      update: {
        scanId,
        sku: product.sku,
        skuKey: product.skuKey,
        manufacturerPartNumber: product.manufacturerPartNumber,
        mpnKey: product.mpnKey,
        barcode: product.barcode,
        barcodeKey: product.barcodeKey,
        name: product.name,
        brand: product.brand,
        brandModelKey: product.brandModelKey,
        category: product.category,
        unitPriceCents: product.unitPriceCents,
        salePriceCents: product.salePriceCents,
        currency: product.currency,
        stockQuantity: product.stockQuantity,
        stockStatus: product.stockStatus,
        description: product.description,
        specifications: product.specifications,
        imageUrls: product.imageUrls,
        published: product.published,
        slug: product.slug,
        url: product.url,
        storeUpdatedAt: product.storeUpdatedAt ? new Date(product.storeUpdatedAt) : null,
      },
      })), { timeout: 15_000 });
    }
  }
  const imported = scan.imported + parsed.products.length;
  if (scan.page < parsed.lastPage) {
    await db.storeCatalogueScan.update({
      where: { id: scan.id },
      data: { page: scan.page + 1, imported, total: parsed.total, error: null },
    });
    return { done: false, imported, total: parsed.total, stats: null as CatalogueStats | null };
  }
  const stats = await finishCatalogueScan(workspaceId, scan.id, imported, parsed.total);
  return { done: true, imported: stats.total, total: stats.total, stats };
}

export async function verifyStoreCatalogueAccess(workspaceId: string) {
  const loaded = await loadStoreProvider(workspaceId);
  if (!loaded) throw new AppError("Connect the store under Settings before reading the catalogue.");
  const first = await loaded.provider.listCatalogue(1, 1);
  const repeat = await loaded.provider.listCatalogue(1, 1);
  const parsed = parseStoreCataloguePage(first);
  const repeated = parseStoreCataloguePage(repeat);
  if ("error" in parsed) throw new AppError(parsed.error);
  if ("error" in repeated) throw new AppError(repeated.error);
  const sample = parsed.products[0];
  const repeatedSample = repeated.products[0];
  let secondPageDifferent = parsed.total <= 1;
  if (parsed.total > 1) {
    const second = parseStoreCataloguePage(await loaded.provider.listCatalogue(2, 1));
    if ("error" in second) throw new AppError(second.error);
    secondPageDifferent = second.products[0]?.storeProductId !== sample?.storeProductId;
  }
  const lookupKnown = sample?.sku
    ? Boolean((await loaded.provider.findByIdentity({ sku: sample.sku }))?.sku)
    : sample?.manufacturerPartNumber
      ? Boolean((await loaded.provider.findByIdentity({ mpn: sample.manufacturerPartNumber }))?.sku)
      : sample?.barcode
        ? Boolean((await loaded.provider.findByIdentity({ barcode: sample.barcode }))?.sku)
        : false;
  const lookupMissing = await loaded.provider.findByIdentity({ sku: "UF-BASELINE-MISSING-000" });
  return {
    total: parsed.total,
    lastPage: parsed.lastPage,
    perPage: parsed.perPage,
    secondPageDifferent,
    updatedAtUnchanged: sample?.storeUpdatedAt === repeatedSample?.storeUpdatedAt,
    lookupKnown,
    lookupMissing: lookupMissing === null,
    secretFields: secretFieldPaths(first),
  };
}

export async function readCatalogueForCron() {
  const workspaces = await getDb().workspace.findMany({
    where: { storeName: { not: null }, storePublicUrl: { not: null }, storeBaseUrl: { not: null }, storeKeyEncrypted: { not: null } },
    select: { id: true },
  });
  const results = [];
  for (const workspace of workspaces) {
    try {
      const running = await getDb().storeCatalogueScan.findFirst({
        where: { workspaceId: workspace.id, status: "RUNNING" },
        select: { imported: true },
      });
      const checks = running ? null : await verifyStoreCatalogueAccess(workspace.id);
      const started = Date.now();
      let result = await readStoreCatalogueBatch(workspace.id);
      let pages = 1;
      while (!result.done && Date.now() - started < 45_000) {
        result = await readStoreCatalogueBatch(workspace.id);
        pages += 1;
      }
      results.push({ done: result.done, imported: result.imported, total: result.total, pages, stats: result.stats, checks, error: null as string | null });
    } catch (error) {
      results.push({
        done: false,
        imported: 0,
        total: 0,
        pages: 0,
        stats: null,
        checks: null,
        error: safeCatalogueFailure(error),
      });
    }
  }
  return results;
}

export async function baselineIdentities(workspaceId: string) {
  const scan = await getDb().storeCatalogueScan.findFirst({
    where: { workspaceId, status: "COMPLETE" },
    orderBy: { finishedAt: "desc" },
  });
  if (!scan) return null;
  const items = await getDb().storeCatalogueItem.findMany({
    where: { scanId: scan.id },
    select: { storeProductId: true, sku: true, skuKey: true, mpnKey: true, barcodeKey: true, brandModelKey: true, name: true },
  });
  const links = await getDb().supplierPrice.findMany({
    where: { workspaceId, product: { storeProductId: { not: null } } },
    select: { supplierSku: true, product: { select: { storeProductId: true } } },
  });
  const confirmed = new Map<string, string>();
  for (const link of links) {
    const storeProductId = link.product.storeProductId;
    const key = skuKey(link.supplierSku);
    if (storeProductId && key && !confirmed.has(key)) confirmed.set(key, storeProductId);
  }
  return { items, confirmed };
}

export async function getCatalogueReport(workspaceId: string, view: string, page: number) {
  const db = getDb();
  const [scan, running, audits] = await Promise.all([
    db.storeCatalogueScan.findFirst({ where: { workspaceId, status: "COMPLETE" }, orderBy: { finishedAt: "desc" } }),
    db.storeCatalogueScan.findFirst({ where: { workspaceId, status: "RUNNING" }, orderBy: { startedAt: "desc" } }),
    db.catalogueAudit.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);
  const currentPage = Math.max(1, page);
  if (!scan) return { scan: null, running, items: [], total: 0, pageCount: 1, page: currentPage, audits, stats: null as CatalogueStats | null, differences: null as CatalogueDifferenceSummary | null };
  const differences = await loadCatalogueComparisons(workspaceId, scan.id);
  const filteredIds = view === "stock-diff" ? differences.stockIds : view === "price-diff" ? differences.priceIds : null;
  const pageIds = filteredIds?.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE) ?? null;
  const where: Prisma.StoreCatalogueItemWhereInput = pageIds
    ? (pageIds.length === 0 ? { id: "__none__" } : { scanId: scan.id, id: { in: pageIds } })
    : { scanId: scan.id, ...viewWhere(view) };
  const [total, items] = await Promise.all([
    filteredIds ? Promise.resolve(filteredIds.length) : db.storeCatalogueItem.count({ where }),
    db.storeCatalogueItem.findMany({
      where,
      orderBy: [{ name: "asc" }, { storeProductId: "asc" }],
      skip: pageIds ? 0 : (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        storeProductId: true,
        sku: true,
        skuKey: true,
        manufacturerPartNumber: true,
        mpnKey: true,
        barcode: true,
        name: true,
        brand: true,
        unitPriceCents: true,
        salePriceCents: true,
        currency: true,
        stockQuantity: true,
        stockStatus: true,
        imageUrls: true,
        published: true,
        url: true,
        reviewStatus: true,
        duplicateKinds: true,
        mergedIntoStoreProductId: true,
        productId: true,
      },
    }),
  ]);
  return {
    scan,
    running,
    items: items.map((item) => ({ ...item, comparison: differences.byId.get(item.id) ?? null })),
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    page: currentPage,
    audits,
    stats: readStats(scan.stats),
    differences,
  };
}

export async function reviewCatalogueItem(workspaceId: string, itemId: string, action: "accept" | "reject" | "ignore" | "image") {
  if (action === "image") return findCatalogueImage(workspaceId, itemId);
  const item = await ownedItem(workspaceId, itemId);
  const next = {
    accept: { reviewStatus: "ACCEPTED", action: "MATCH_ACCEPTED", summary: "Accepted the existing store product" },
    reject: { reviewStatus: "REJECTED", action: "MATCH_REJECTED", summary: "Rejected this match" },
    ignore: { reviewStatus: "IGNORED", action: "MATCH_IGNORED", summary: "Ignored this store product for supplier matching" },
  }[action];
  await getDb().storeCatalogueItem.update({ where: { id: item.id }, data: { reviewStatus: next.reviewStatus } });
  const summary = `${next.summary} ${label(item)}. The website was not changed.`;
  await writeAudit(workspaceId, next.action, item.storeProductId, summary);
  return summary;
}

export async function mergeCatalogueItems(workspaceId: string, itemId: string, targetStoreProductId: string) {
  const item = await ownedItem(workspaceId, itemId);
  const targetId = targetStoreProductId.trim();
  if (!targetId || targetId === item.storeProductId) throw new AppError("Enter the other store product id from the same duplicate.");
  const target = await getDb().storeCatalogueItem.findFirst({ where: { workspaceId, storeProductId: targetId } });
  if (!target) throw new AppError("That store product is not in the baseline.");
  if (!sharesDuplicateKey(item, target)) throw new AppError("Those products do not share a SKU, part number, barcode, or brand and model.");
  await getDb().storeCatalogueItem.update({
    where: { id: item.id },
    data: {
      reviewStatus: "MERGED",
      mergedIntoStoreProductId: target.storeProductId,
      reviewNote: `Kept store product ${target.storeProductId} as the master. The website product was not deleted.`,
    },
  });
  await writeAudit(workspaceId, "MATCH_MERGED", item.storeProductId, `Merged ${label(item)} into store product ${target.storeProductId} locally. No website product was deleted.`);
}

async function finishCatalogueScan(workspaceId: string, scanId: string, imported: number, total: number) {
  const db = getDb();
  const rows = await db.storeCatalogueItem.findMany({
    where: { workspaceId, scanId },
    select: {
      id: true,
      storeProductId: true,
      sku: true,
      skuKey: true,
      mpnKey: true,
      barcodeKey: true,
      brandModelKey: true,
      name: true,
      unitPriceCents: true,
      stockQuantity: true,
      imageUrls: true,
      published: true,
      productId: true,
      reviewStatus: true,
      duplicateKinds: true,
    },
  });
  const records: CatalogueRecord[] = rows.map((row) => ({
    id: row.id,
    storeProductId: row.storeProductId,
    sku: row.sku,
    skuKey: row.skuKey,
    mpnKey: row.mpnKey,
    barcodeKey: row.barcodeKey,
    brandModelKey: row.brandModelKey,
    name: row.name,
    unitPriceCents: row.unitPriceCents,
    stockQuantity: row.stockQuantity,
    imageCount: row.imageUrls.length,
    published: row.published,
    productId: row.productId,
    reviewStatus: row.reviewStatus,
  }));
  const analysed = analyseCatalogue(records);
  const groups = new Map<string, { reviewStatus: string; duplicateKinds: string; ids: string[] }>();
  for (const row of rows) {
    const kinds = analysed.flags.get(row.id) ?? [];
    const reviewStatus = MANUAL.has(row.reviewStatus) ? row.reviewStatus : kinds.length > 0 ? "MATCH_REVIEW_REQUIRED" : "BASELINE";
    const duplicateKinds = kinds.join(",");
    if (reviewStatus === row.reviewStatus && duplicateKinds === row.duplicateKinds) continue;
    const signature = `${reviewStatus}|${duplicateKinds}`;
    const group = groups.get(signature) ?? { reviewStatus, duplicateKinds, ids: [] };
    group.ids.push(row.id);
    groups.set(signature, group);
  }
  for (const group of groups.values()) {
    for (const ids of chunks(group.ids, 400)) {
      await db.storeCatalogueItem.updateMany({
        where: { id: { in: ids } },
        data: { reviewStatus: group.reviewStatus, duplicateKinds: group.duplicateKinds },
      });
    }
  }
  const matched = await linkExistingProducts(workspaceId, rows, analysed.flags);
  analysed.stats.matchedToCatalogue = matched;
  await db.storeCatalogueItem.deleteMany({ where: { workspaceId, NOT: { scanId } } });
  await db.storeCatalogueScan.updateMany({
    where: { workspaceId, status: "COMPLETE", NOT: { id: scanId } },
    data: { status: "SUPERSEDED" },
  });
  await db.storeCatalogueScan.update({
    where: { id: scanId },
    data: { status: "COMPLETE", finishedAt: new Date(), imported, total, stats: analysed.stats, error: null, readOnly: true },
  });
  const stats = analysed.stats;
  await writeAudit(workspaceId, "CATALOGUE_READ", "", `Read ${stats.total} store products without changing the website. ${stats.duplicateSkuGroups} duplicate SKUs, ${stats.missingImages} missing images, ${stats.withoutSku} without a SKU, ${stats.withoutPrice} without a price, ${stats.zeroStock} with zero stock, ${stats.readyForSupplierMatching} ready for supplier matching.`);
  if (stats.duplicateSkuGroups + stats.duplicateMpnGroups + stats.duplicateBarcodeGroups + stats.duplicateBrandModelGroups > 0) {
    await writeAudit(workspaceId, "DUPLICATE_PREVENTED", "", "Duplicate identifiers were recorded. No second website product was created.");
  }
  if (matched > 0) {
    await writeAudit(workspaceId, "PRODUCT_MATCHED", "", `Linked ${matched} existing catalogue products by SKU. Names, prices, stock, and images were left unchanged.`);
  }
  return stats;
}

async function linkExistingProducts(workspaceId: string, rows: { id: string; storeProductId: string; skuKey: string; productId: string | null }[], flags: Map<string, string[]>) {
  const products = await getDb().product.findMany({
    where: { workspaceId },
    select: { id: true, sku: true, storeProductId: true },
  });
  const bySku = new Map(products.map((product) => [skuKey(product.sku), product]));
  const linked = new Set(rows.filter((row) => row.productId).map((row) => row.id));
  for (const row of rows) {
    if (!row.skuKey || flags.get(row.id)?.includes("sku")) continue;
    const product = bySku.get(row.skuKey);
    if (!product) continue;
    if (product.storeProductId && product.storeProductId !== row.storeProductId) continue;
    if (products.some((other) => other.id !== product.id && other.storeProductId === row.storeProductId)) continue;
    try {
      if (!product.storeProductId) {
        await getDb().product.update({ where: { id: product.id }, data: { storeProductId: row.storeProductId } });
        product.storeProductId = row.storeProductId;
      }
      if (row.productId !== product.id) {
        await getDb().storeCatalogueItem.update({ where: { id: row.id }, data: { productId: product.id } });
      }
      linked.add(row.id);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    }
  }
  return linked.size;
}

async function ownedItem(workspaceId: string, itemId: string) {
  const item = await getDb().storeCatalogueItem.findFirst({ where: { id: itemId, workspaceId } });
  if (!item) throw new AppError("That store product is not in the baseline.");
  return item;
}

async function writeAudit(workspaceId: string, action: string, storeProductId: string, summary: string) {
  await getDb().catalogueAudit.create({
    data: { workspaceId, action, storeProductId, summary: summary.slice(0, 500) },
  });
}

function label(item: { sku: string; name: string; storeProductId: string }) {
  return `${item.sku || "no SKU"} ${item.name} (${item.storeProductId})`.trim();
}

type CatalogueRowComparison = CatalogueOfferView & { stockDiffers: boolean; priceDiffers: boolean };

type CatalogueDifferenceSummary = {
  stockDifferences: number;
  priceDifferences: number;
  compared: number;
  stockIds: string[];
  priceIds: string[];
  byId: Map<string, CatalogueRowComparison>;
};

type PricedChoice = SupplierChoice & { name: string; markupPercent: number; imageUrls: string[] };

async function loadCatalogueComparisons(workspaceId: string, scanId: string): Promise<CatalogueDifferenceSummary> {
  const db = getDb();
  const [items, products, prices, feeds] = await Promise.all([
    db.storeCatalogueItem.findMany({
      where: { scanId },
      orderBy: [{ name: "asc" }, { storeProductId: "asc" }],
      select: { id: true, productId: true, skuKey: true, mpnKey: true, stockQuantity: true, unitPriceCents: true },
    }),
    db.product.findMany({ where: { workspaceId }, select: { id: true, unitPriceCents: true } }),
    db.supplierPrice.findMany({
      where: { workspaceId },
      select: {
        productId: true,
        supplierId: true,
        costCents: true,
        costKnown: true,
        stockQty: true,
        stockKnown: true,
        updatedAt: true,
        leadTimeDays: true,
        imageUrls: true,
        supplier: { select: { name: true, preference: true, leadTimeDays: true, priceSyncIntervalMinutes: true, markupPercent: true, scorecard: { select: SCORECARD_FIELD_SELECT } } },
      },
    }),
    db.supplierFeedItem.findMany({
      where: { workspaceId },
      select: {
        productId: true,
        supplierId: true,
        supplierSku: true,
        manufacturerPartNumber: true,
        costCents: true,
        costKnown: true,
        stockQty: true,
        stockKnown: true,
        updatedAt: true,
        leadTimeDays: true,
        imageUrls: true,
        supplier: { select: { name: true, preference: true, leadTimeDays: true, priceSyncIntervalMinutes: true, markupPercent: true, scorecard: { select: SCORECARD_FIELD_SELECT } } },
      },
    }),
  ]);
  const sellByProduct = new Map(products.map((product) => [product.id, product.unitPriceCents]));
  const byProduct = new Map<string, PricedChoice[]>();
  const bySku = new Map<string, PricedChoice[]>();
  const byMpn = new Map<string, PricedChoice[]>();
  const push = (map: Map<string, PricedChoice[]>, key: string, choice: PricedChoice) => {
    if (!key) return;
    const list = map.get(key) ?? [];
    list.push(choice);
    map.set(key, list);
  };
  for (const row of prices) push(byProduct, row.productId, pricedChoice(row));
  for (const row of feeds) {
    const choice = pricedChoice(row);
    if (row.productId) push(byProduct, row.productId, choice);
    push(bySku, skuKey(row.supplierSku), choice);
    push(byMpn, mpnKey(row.manufacturerPartNumber), choice);
  }
  const now = new Date();
  const byId = new Map<string, CatalogueRowComparison>();
  const stockIds: string[] = [];
  const priceIds: string[] = [];
  let compared = 0;
  for (const item of items) {
    const choices = item.productId && byProduct.has(item.productId)
      ? byProduct.get(item.productId) ?? []
      : bySku.get(item.skuKey) ?? byMpn.get(item.mpnKey) ?? [];
    const offer = offerView(choices, item.productId ? sellByProduct.get(item.productId) ?? null : null, now);
    const difference = catalogueDifference(item, offer);
    if (!difference.compared || !offer) continue;
    compared += 1;
    byId.set(item.id, { ...offer, stockDiffers: difference.stockDiffers, priceDiffers: difference.priceDiffers });
    if (difference.stockDiffers) stockIds.push(item.id);
    if (difference.priceDiffers) priceIds.push(item.id);
  }
  return { stockDifferences: stockIds.length, priceDifferences: priceIds.length, compared, stockIds, priceIds, byId };
}

function pricedChoice(row: {
  supplierId: string;
  costCents: number;
  costKnown: boolean;
  stockQty: number;
  stockKnown: boolean;
  updatedAt: Date;
  leadTimeDays: number | null;
  imageUrls: string[];
  supplier: { name: string; preference: number; leadTimeDays: number | null; priceSyncIntervalMinutes: number; markupPercent: number; scorecard: Parameters<typeof classFromScorecard>[0] };
}): PricedChoice {
  return {
    supplierId: row.supplierId,
    costCents: row.costKnown ? row.costCents : null,
    costKnown: row.costKnown,
    stockQty: row.stockKnown ? row.stockQty : null,
    stockKnown: row.stockKnown,
    updatedAt: row.updatedAt,
    preference: row.supplier.preference,
    leadTimeDays: row.leadTimeDays ?? row.supplier.leadTimeDays,
    priceFreshMs: row.supplier.priceSyncIntervalMinutes * 60 * 1000,
    supplierClass: classFromScorecard(row.supplier.scorecard),
    name: row.supplier.name,
    markupPercent: row.supplier.markupPercent,
    imageUrls: row.imageUrls,
  };
}

function offerView(choices: PricedChoice[], productSellCents: number | null, now: Date): CatalogueOfferView | null {
  const chosen = chooseSupplierOffer(choices, 1, now);
  const stockQty = choices.length > 0 ? selectedSupplierStock(choices, now) : null;
  const named = chosen ? choices.find((choice) => choice.supplierId === chosen.supplierId) ?? null : null;
  const costCents = chosen?.costCents ?? null;
  const marked = costCents != null && named ? markedUpCents(costCents, named.markupPercent) : null;
  const sellCents = productSellCents != null && productSellCents > 0 ? productSellCents : marked;
  if (stockQty == null && (sellCents == null || sellCents <= 0)) return null;
  return { supplierName: named?.name ?? "Catalogue", costCents, stockQty, sellCents };
}

async function findCatalogueImage(workspaceId: string, itemId: string) {
  const item = await ownedItem(workspaceId, itemId);
  const identity = { brand: item.brand, sku: item.sku, manufacturerPartNumber: item.manufacturerPartNumber };
  const stored = await supplierImageUrls(workspaceId, item.productId, item.sku, item.manufacturerPartNumber);
  const accepted = stored.filter((url) => acceptProductImage(url, identity));
  const found = accepted.length > 0
    ? accepted
    : await verifiedProductImageUrls({ brand: item.brand, sku: item.sku, manufacturerPartNumber: item.manufacturerPartNumber, pageUrl: item.url });
  if (found.length === 0) {
    await getDb().storeCatalogueItem.update({ where: { id: item.id }, data: { reviewStatus: "IMAGE_REVIEW_REQUIRED" } });
    const summary = `No verified image was found for ${label(item)}. It stays in image review. The website was not changed.`;
    await writeAudit(workspaceId, "IMAGE_REVIEW_REQUIRED", item.storeProductId, summary);
    return summary;
  }
  const imageUrls = [...item.imageUrls];
  for (const url of found) {
    if (!imageUrls.includes(url)) imageUrls.push(url);
  }
  const saved = imageUrls.slice(0, 8);
  await getDb().storeCatalogueItem.update({
    where: { id: item.id },
    data: {
      imageUrls: saved,
      reviewStatus: item.reviewStatus === "IMAGE_REVIEW_REQUIRED" ? "BASELINE" : item.reviewStatus,
    },
  });
  if (item.productId) {
    const product = await getDb().product.findFirst({ where: { id: item.productId, workspaceId }, select: { imageUrls: true } });
    if (product && product.imageUrls.length === 0) {
      await getDb().product.update({ where: { id: item.productId }, data: { imageUrls: saved } });
    }
  }
  const source = accepted.length > 0 ? "the supplier feed" : "a verified product page";
  const summary = `Saved ${found.length} image address${found.length === 1 ? "" : "es"} from ${source} on ${label(item)}. The website was not changed.`;
  await writeAudit(workspaceId, "IMAGE_SAVED", item.storeProductId, summary);
  return summary;
}

async function supplierImageUrls(workspaceId: string, productId: string | null, sku: string, part: string) {
  const db = getDb();
  const feedOr = [
    ...(productId ? [{ productId }] : []),
    ...(sku ? [{ supplierSku: { equals: sku, mode: "insensitive" as const } }] : []),
    ...(part ? [{ manufacturerPartNumber: { equals: part, mode: "insensitive" as const } }] : []),
  ];
  const [prices, feeds] = await Promise.all([
    productId ? db.supplierPrice.findMany({ where: { workspaceId, productId }, select: { imageUrls: true } }) : Promise.resolve([]),
    feedOr.length > 0 ? db.supplierFeedItem.findMany({ where: { workspaceId, OR: feedOr }, select: { imageUrls: true } }) : Promise.resolve([]),
  ]);
  return [...prices, ...feeds].flatMap((row) => row.imageUrls);
}

function viewWhere(view: string): Prisma.StoreCatalogueItemWhereInput {
  if (view === "duplicates") return { duplicateKinds: { not: "" } };
  if (view === "images") return { imageUrls: { isEmpty: true } };
  if (view === "identity") return { skuKey: "", mpnKey: "" };
  if (view === "price") return { unitPriceCents: 0 };
  if (view === "stock") return { stockQuantity: 0 };
  if (view === "review") return { reviewStatus: { in: ["MATCH_REVIEW_REQUIRED", "IMAGE_REVIEW_REQUIRED"] } };
  if (view === "unpublished") return { published: false };
  if (view === "matched") return { productId: { not: null } };
  if (view === "ready") {
    return { duplicateKinds: "", OR: [{ skuKey: { not: "" } }, { mpnKey: { not: "" } }, { barcodeKey: { not: "" } }] };
  }
  return {};
}

function readStats(value: unknown): CatalogueStats | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stats = value as CatalogueStats;
  return typeof stats.total === "number" ? stats : null;
}

function chunks<T>(values: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size));
  return groups;
}
