import { Prisma } from "../generated/prisma/client";
import { getDb, type DbClient } from "../lib/db";
import { AppError } from "../lib/errors";
import { assertPublicHttpsUrl, markedUpCents, priceAllowedByMargin, stockLeft, stockLevel } from "../lib/stock";
import {
  chooseSupplierOffer,
  exclusiveCostCents,
  matchCatalogueOffer,
  parseCsvOffers,
  parseJsonOffers,
  parseXmlOffers,
  priceChangeNeedsApproval,
  readFieldMapping,
  type SupplierFieldMapping,
  type SupplierOffer,
} from "../lib/supplier-connector";
import { decryptSecret, encryptSecret } from "../lib/token-crypto";
import { recordActivity } from "./activity-service";
import { createStoreProvider, type StoreCatalogProduct } from "./store";
import type { Actor } from "./types";

const BATCH = 40;

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

type FeedSettings = {
  supplierId: string;
  markupPercent: number;
  stockFeedUrl: string;
  stockFeedKey: string;
  authPassword: string;
  feedType: "JSON" | "XML" | "CSV_URL" | "MANUAL_CSV";
  authType: "NONE" | "BEARER" | "API_KEY_HEADER" | "BASIC";
  authHeaderName: string;
  authUsername: string;
  vatMode: "INCLUSIVE" | "EXCLUSIVE";
  stockSyncIntervalMinutes: number;
  priceSyncIntervalMinutes: number;
  preference: number;
  leadTimeDays: string;
  productElement: string;
  mapSku: string;
  mapMpn: string;
  mapName: string;
  mapBrand: string;
  mapCost: string;
  mapStock: string;
  mapDescription: string;
  mapSpecifications: string;
  mapImages: string;
  mapCategory: string;
  mapLeadTime: string;
};

export async function saveSupplierFeed(actor: Actor, input: FeedSettings) {
  const supplier = await ownedSupplier(actor.workspaceId, input.supplierId);
  const manual = input.feedType === "MANUAL_CSV";
  const url = manual ? "" : input.stockFeedUrl.trim();
  if (url) publicUrl(url);
  const leadTimeDays = readLeadTime(input.leadTimeDays);
  const headerName = input.authHeaderName.trim() || "X-Api-Key";
  if (input.authType === "API_KEY_HEADER" && !FIELD_NAME.test(headerName)) {
    throw new AppError("Enter a header name such as X-Api-Key.");
  }
  const mapping = mappingFromInput(input);
  for (const name of Object.values(mapping)) {
    if (!FIELD_NAME.test(name)) throw new AppError("Field names can use letters, numbers, and hyphens.");
  }
  const existing = unpackCreds(supplier.stockFeedKeyEncrypted ? openKey(supplier.stockFeedKeyEncrypted) : null);
  const token = input.stockFeedKey.trim() || existing.token;
  const password = input.authPassword.trim() || existing.password;
  const username = input.authUsername.trim();
  const hasSecret = Boolean(token || password || username);
  const stockFeedKeyEncrypted = !url || !hasSecret ? null : sealKey(JSON.stringify({ token, username, password }));
  await getDb().supplier.update({
    where: { id: supplier.id },
    data: {
      markupPercent: input.markupPercent,
      feedType: input.feedType,
      feedEnabled: Boolean(url),
      stockFeedUrl: url || null,
      authType: input.authType,
      authHeaderName: headerName,
      authUsername: username,
      stockFeedKeyEncrypted,
      vatMode: input.vatMode,
      stockSyncIntervalMinutes: input.stockSyncIntervalMinutes,
      priceSyncIntervalMinutes: input.priceSyncIntervalMinutes,
      preference: input.preference,
      leadTimeDays,
      fieldMapping: Object.keys(mapping).length === 0 ? Prisma.JsonNull : mapping,
    },
  });
}

export async function syncSupplierFeed(actor: Actor, supplierId: string, options?: { respectInterval?: boolean }) {
  const supplier = await ownedSupplier(actor.workspaceId, supplierId);
  if (supplier.feedType === "MANUAL_CSV") throw new AppError("This supplier uses a CSV file. Upload it on this page.");
  if (!supplier.feedEnabled || !supplier.stockFeedUrl) throw new AppError("Add the supplier feed address first.");
  const now = new Date();
  const stockDue = due(supplier.lastStockSyncAt, supplier.stockSyncIntervalMinutes, now);
  const priceDue = due(supplier.lastPriceSyncAt, supplier.priceSyncIntervalMinutes, now);
  if (options?.respectInterval && !stockDue && !priceDue) {
    return { updated: 0, unmatched: 0, pricesHeld: 0, priceChangesFlagged: 0, skipped: true };
  }
  const applyStock = options?.respectInterval ? stockDue : true;
  const applyPrice = options?.respectInterval ? priceDue : true;
  try {
    const parsed = await readFeed(supplier);
    if (parsed.error) throw new AppError(parsed.error);
    const result = await applyFeed(actor, supplier.id, parsed.offers, { applyPrice, applyStock });
    await getDb().supplier.update({
      where: { id: supplier.id },
      data: {
        ...(applyStock ? { lastStockSyncAt: now } : {}),
        ...(applyPrice ? { lastPriceSyncAt: now } : {}),
        lastStockSyncError: null,
      },
    });
    return result;
  } catch (error) {
    const message = error instanceof AppError ? error.message : "The supplier feed could not be read.";
    await getDb().supplier.update({
      where: { id: supplier.id },
      data: { lastStockSyncError: message.slice(0, 300) },
    });
    throw error instanceof AppError ? error : new AppError(message);
  }
}

export async function getStoreConnection(workspaceId: string) {
  const workspace = await getDb().workspace.findFirst({
    where: { id: workspaceId },
    select: {
      storeName: true,
      storePublicUrl: true,
      storeBaseUrl: true,
      storeKeyEncrypted: true,
      minimumMarginPercent: true,
      storeLastSyncAt: true,
      storeLastError: true,
    },
  });
  if (!workspace) return null;
  const connected = Boolean(workspace.storeName && workspace.storePublicUrl && workspace.storeBaseUrl && workspace.storeKeyEncrypted);
  return {
    storeName: workspace.storeName ?? "",
    storeUrl: workspace.storePublicUrl ?? "",
    apiBaseUrl: workspace.storeBaseUrl ?? "",
    minimumMarginPercent: workspace.minimumMarginPercent,
    connected,
    status: !connected ? "Not connected" : workspace.storeLastError ? "Error" : "Connected",
    lastSyncAt: workspace.storeLastSyncAt,
    lastError: workspace.storeLastError,
  };
}

export async function saveStoreConnection(actor: Actor, input: {
  storeName: string;
  storeUrl: string;
  apiBaseUrl: string;
  apiKey: string;
  minimumMarginPercent: number;
}) {
  const workspace = await getDb().workspace.findFirst({
    where: { id: actor.workspaceId },
    select: { id: true, storeKeyEncrypted: true },
  });
  if (!workspace) throw new AppError("Workspace not found.", 404, "NOT_FOUND");
  const storeName = input.storeName.trim();
  const storeUrl = input.storeUrl.trim();
  const apiBaseUrl = input.apiBaseUrl.trim();
  if (storeUrl) publicUrl(storeUrl);
  if (apiBaseUrl) publicUrl(apiBaseUrl);
  const storeKeyEncrypted = input.apiKey.trim() ? sealKey(input.apiKey.trim()) : workspace.storeKeyEncrypted;
  const clearing = !storeName && !storeUrl && !apiBaseUrl;
  if (!clearing && (!storeName || !storeUrl || !apiBaseUrl || !storeKeyEncrypted)) {
    throw new AppError("Enter the store name, store URL, API base URL, and API key.");
  }
  await getDb().workspace.update({
    where: { id: workspace.id },
    data: {
      storeName: clearing ? null : storeName,
      storePublicUrl: clearing ? null : storeUrl,
      storeBaseUrl: clearing ? null : apiBaseUrl,
      storeProvider: "urban-focus",
      storeKeyEncrypted: clearing ? null : storeKeyEncrypted,
      storeSecretEncrypted: null,
      minimumMarginPercent: input.minimumMarginPercent,
      storeLastError: null,
    },
  });
}

async function storeProviderFor(workspaceId: string) {
  const workspace = await getDb().workspace.findFirst({
    where: { id: workspaceId },
    select: {
      id: true,
      storeName: true,
      storePublicUrl: true,
      storeBaseUrl: true,
      storeProvider: true,
      storeKeyEncrypted: true,
      minimumMarginPercent: true,
      storeLastSyncAt: true,
    },
  });
  if (!workspace?.storeName || !workspace.storePublicUrl || !workspace.storeBaseUrl || !workspace.storeKeyEncrypted) {
    return null;
  }
  return {
    workspace,
    provider: createStoreProvider(workspace.storeProvider, {
      apiBaseUrl: workspace.storeBaseUrl,
      token: decryptSecret(workspace.storeKeyEncrypted),
    }),
  };
}

export async function testStoreConnection(workspaceId: string) {
  const loaded = await storeProviderFor(workspaceId);
  if (!loaded) throw new AppError("Save the store connection before testing it.");
  try {
    await loaded.provider.testConnection();
    await getDb().workspace.update({ where: { id: loaded.workspace.id }, data: { storeLastError: null } });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "The store connection test failed.";
    await getDb().workspace.update({ where: { id: loaded.workspace.id }, data: { storeLastError: message.slice(0, 300) } });
    throw error instanceof AppError ? error : new AppError(message);
  }
}

export async function fetchStoreOrders(workspaceId: string) {
  const loaded = await storeProviderFor(workspaceId);
  if (!loaded) throw new AppError("Connect the store under Settings before syncing orders.");
  return loaded.provider.listOrders(40);
}

export async function pushStoreStock(workspaceId: string) {
  const loaded = await storeProviderFor(workspaceId);
  if (!loaded) return { pushed: 0, pricesHeld: 0, pending: false };
  const products = await getDb().product.findMany({
    where: { workspaceId, updatedAt: { gt: loaded.workspace.storeLastSyncAt ?? new Date(0) } },
    orderBy: { updatedAt: "asc" },
    take: BATCH,
  });
  const productIds = products.map((product) => product.id);
  const costs = await lowestCostByProduct(workspaceId, productIds);
  const alternateSkus = await supplierSkusByProduct(workspaceId, productIds);
  let pushed = 0;
  let pricesHeld = 0;
  let cursor = loaded.workspace.storeLastSyncAt;
  const reserved = await reservedByProduct(workspaceId);
  try {
    for (const product of products) {
      const available = stockLeft(product.stockOnHand, reserved.get(product.id) ?? 0);
      const cost = costs.get(product.id) ?? 0;
      const priceAllowed = priceAllowedByMargin(cost, product.unitPriceCents, loaded.workspace.minimumMarginPercent);
      const payload = catalogPayload(product, available);
      const matchedSku = await findStoreSku(loaded.provider, product.sku, alternateSkus.get(product.id) ?? []);
      if (!matchedSku) {
        if (!priceAllowed) {
          pricesHeld += 1;
          cursor = product.updatedAt;
          continue;
        }
        await loaded.provider.createProduct(payload);
      } else {
        await loaded.provider.updateStock(matchedSku, available);
        await loaded.provider.updateContent(matchedSku, {
          name: product.name,
          description: product.description,
          specifications: product.specifications,
        });
        if (product.imageUrls.length > 0) await loaded.provider.updateImages(matchedSku, product.imageUrls);
        await loaded.provider.setPublished(matchedSku, product.active);
        if (priceAllowed) await loaded.provider.updatePrice(matchedSku, product.unitPriceCents, product.currency);
        else pricesHeld += 1;
      }
      pushed += 1;
      cursor = product.updatedAt;
    }
    await getDb().workspace.update({
      where: { id: loaded.workspace.id },
      data: { storeLastSyncAt: cursor, storeLastError: null },
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "The store did not accept the catalogue update.";
    await getDb().workspace.update({
      where: { id: loaded.workspace.id },
      data: { storeLastSyncAt: cursor, storeLastError: message.slice(0, 300) },
    });
    throw error instanceof AppError ? error : new AppError(message);
  }
  return { pushed, pricesHeld, pending: products.length === BATCH };
}

async function supplierSkusByProduct(workspaceId: string, productIds: string[]) {
  const grouped = new Map<string, string[]>();
  if (productIds.length === 0) return grouped;
  const rows = await getDb().supplierPrice.findMany({
    where: { workspaceId, productId: { in: productIds } },
    select: { productId: true, supplierSku: true },
  });
  for (const row of rows) {
    const list = grouped.get(row.productId) ?? [];
    list.push(row.supplierSku);
    grouped.set(row.productId, list);
  }
  return grouped;
}

async function findStoreSku(provider: { findProductBySku(sku: string): Promise<{ sku: string } | null> }, sku: string, alternates: string[]) {
  const keys = [sku, ...alternates.filter((item) => item.toLowerCase() !== sku.toLowerCase())];
  for (const key of keys) {
    const found = await provider.findProductBySku(key);
    if (found) return found.sku;
  }
  return null;
}

function catalogPayload(product: { sku: string; name: string; description: string; specifications: string; imageUrls: string[]; unitPriceCents: number; currency: string; active: boolean }, stockQuantity: number): StoreCatalogProduct {
  return {
    sku: product.sku,
    name: product.name,
    description: product.description,
    specifications: product.specifications,
    unitPriceCents: product.unitPriceCents,
    currency: product.currency,
    stockQuantity,
    published: product.active,
    imageUrls: product.imageUrls,
  };
}

export async function supplierTrackedProductIds(workspaceId: string) {
  const rows = await getDb().supplierPrice.findMany({
    where: { workspaceId },
    select: { productId: true },
    distinct: ["productId"],
  });
  return new Set(rows.map((row) => row.productId));
}

export async function holdsForProduct(workspaceId: string, productId: string) {
  const [quotes, orders] = await Promise.all([
    getDb().quoteLine.findMany({
      where: {
        workspaceId,
        productId,
        quote: { status: "SENT", rfq: { status: { notIn: ["WON", "LOST"] } } },
      },
      select: {
        id: true,
        quantity: true,
        quote: { select: { id: true, number: true, issuedAt: true, rfqId: true } },
      },
    }),
    getDb().storeOrderLine.findMany({
      where: {
        workspaceId,
        productId,
        order: { status: { in: ["pending", "processing", "on-hold"] } },
      },
      select: {
        id: true,
        quantity: true,
        order: { select: { id: true, number: true, status: true } },
      },
    }),
  ]);
  return { quotes, orders };
}

export async function reservedByProduct(workspaceId: string) {
  const lines = await getDb().quoteLine.findMany({
    where: {
      workspaceId,
      productId: { not: null },
      quote: { status: "SENT", rfq: { status: { notIn: ["WON", "LOST"] } } },
    },
    select: { productId: true, quantity: true },
  });
  const reserved = new Map<string, number>();
  for (const line of lines) {
    if (!line.productId) continue;
    reserved.set(line.productId, (reserved.get(line.productId) ?? 0) + Number(line.quantity));
  }
  const orderLines = await getDb().storeOrderLine.findMany({
    where: {
      workspaceId,
      productId: { not: null },
      order: { status: { in: ["pending", "processing", "on-hold"] } },
    },
    select: { productId: true, quantity: true },
  });
  for (const line of orderLines) {
    if (!line.productId) continue;
    reserved.set(line.productId, (reserved.get(line.productId) ?? 0) + line.quantity);
  }
  return reserved;
}

export async function queueStockForWebsite(db: DbClient, workspaceId: string, productIds: string[]) {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return;
  await db.product.updateMany({
    where: { workspaceId, id: { in: ids } },
    data: { updatedAt: new Date() },
  });
}

export async function syncAllStockFeeds() {
  const suppliers = await getDb().supplier.findMany({
    where: { feedEnabled: true, stockFeedUrl: { not: null }, feedType: { in: ["JSON", "XML", "CSV_URL"] } },
    select: { id: true, workspaceId: true },
  });
  const workspaces = new Set<string>();
  const results: { supplierId: string; updated?: number; error?: string }[] = [];
  for (const supplier of suppliers) {
    try {
      const result = await syncSupplierFeed({ userId: "system", workspaceId: supplier.workspaceId }, supplier.id, { respectInterval: true });
      if (!result.skipped && result.updated > 0) workspaces.add(supplier.workspaceId);
      results.push({ supplierId: supplier.id, updated: result.updated });
    } catch (error) {
      results.push({ supplierId: supplier.id, error: error instanceof Error ? error.message : "Sync failed." });
    }
  }
  const stores = [];
  for (const workspaceId of workspaces) {
    try {
      stores.push({ workspaceId, ...(await pushStoreStock(workspaceId)) });
    } catch (error) {
      stores.push({ workspaceId, error: error instanceof Error ? error.message : "Website update failed." });
    }
  }
  return { results, stores };
}

async function lowestCostByProduct(workspaceId: string, productIds: string[]) {
  const costs = new Map<string, number>();
  if (productIds.length === 0) return costs;
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

export async function saveSupplierOffers(
  actor: Actor,
  supplierId: string,
  offers: SupplierOffer[],
  options: { applyPrice: boolean; applyStock: boolean; preserveMissing?: boolean },
) {
  const supplier = await ownedSupplier(actor.workspaceId, supplierId);
  return applyFeed(actor, supplier.id, offers, options);
}

async function applyFeed(
  actor: Actor,
  supplierId: string,
  offers: SupplierOffer[],
  options: { applyPrice: boolean; applyStock: boolean; preserveMissing?: boolean },
) {
  const margin = await getDb().workspace.findFirst({
    where: { id: actor.workspaceId },
    select: { minimumMarginPercent: true },
  });
  const minimumMarginPercent = margin?.minimumMarginPercent ?? 0;
  const products = await getDb().product.findMany({
    where: { workspaceId: actor.workspaceId },
    select: { id: true, sku: true, unitPriceCents: true },
  });
  const productBySku = new Map(products.map((product) => [product.sku.toLowerCase(), product.id]));
  const priceById = new Map(products.map((product) => [product.id, product.unitPriceCents]));
  const links = await getDb().supplierPrice.findMany({
    where: { workspaceId: actor.workspaceId },
    select: { productId: true, supplierSku: true, manufacturerPartNumber: true },
  });
  const productByMpn = new Map<string, string>();
  for (const link of links) {
    const skuKey = link.supplierSku.toLowerCase();
    if (!productBySku.has(skuKey)) productBySku.set(skuKey, link.productId);
    if (link.manufacturerPartNumber) {
      const partKey = link.manufacturerPartNumber.toLowerCase();
      if (!productByMpn.has(partKey)) productByMpn.set(partKey, link.productId);
    }
  }
  const matched = new Map<string, SupplierOffer>();
  let unmatched = 0;
  for (const offer of offers) {
    const productId = matchCatalogueOffer(offer, productBySku, productByMpn);
    if (!productId) {
      unmatched += 1;
      continue;
    }
    matched.set(productId, offer);
    const skuKey = offer.supplierSku.toLowerCase();
    if (!productBySku.has(skuKey)) productBySku.set(skuKey, productId);
    if (offer.manufacturerPartNumber) {
      const partKey = offer.manufacturerPartNumber.toLowerCase();
      if (!productByMpn.has(partKey)) productByMpn.set(partKey, productId);
    }
  }
  const touched = new Set<string>();
  for (const [productId, offer] of matched) {
    const costKnown = offer.costCents !== null;
    const stockKnown = offer.stockQty !== null;
    const keep = options.preserveMissing === true;
    const filled = (value: string) => !keep || value.length > 0;
    await getDb().supplierPrice.upsert({
      where: { supplierId_productId: { supplierId, productId } },
      update: {
        supplierSku: offer.supplierSku,
        ...(offer.manufacturerPartNumber || !keep ? { manufacturerPartNumber: offer.manufacturerPartNumber } : {}),
        ...(filled(offer.name) ? { offerName: offer.name } : {}),
        ...(filled(offer.brand) ? { brand: offer.brand } : {}),
        ...(filled(offer.description) ? { description: offer.description } : {}),
        ...(filled(offer.specifications) ? { specifications: offer.specifications } : {}),
        ...(filled(offer.category) ? { category: offer.category } : {}),
        ...(offer.imageUrls.length > 0 || !keep ? { imageUrls: offer.imageUrls } : {}),
        ...(offer.leadTimeDays !== null || !keep ? { leadTimeDays: offer.leadTimeDays } : {}),
        ...(costKnown ? { costCents: offer.costCents ?? 0, costKnown: true } : keep ? {} : { costKnown: false }),
        ...(stockKnown ? { stockQty: offer.stockQty ?? 0, stockKnown: true } : keep ? {} : { stockKnown: false }),
      },
      create: {
        workspaceId: actor.workspaceId,
        supplierId,
        productId,
        supplierSku: offer.supplierSku,
        manufacturerPartNumber: offer.manufacturerPartNumber,
        offerName: offer.name,
        brand: offer.brand,
        description: offer.description,
        specifications: offer.specifications,
        imageUrls: offer.imageUrls,
        category: offer.category,
        leadTimeDays: offer.leadTimeDays,
        costCents: offer.costCents ?? 0,
        costKnown,
        stockQty: offer.stockQty ?? 0,
        stockKnown,
      },
    });
    touched.add(productId);
  }
  const now = new Date();
  let pricesHeld = 0;
  let priceChangesFlagged = 0;
  for (const productId of touched) {
    const rows = await getDb().supplierPrice.findMany({
      where: { workspaceId: actor.workspaceId, productId },
      include: {
        supplier: {
          select: { markupPercent: true, preference: true, leadTimeDays: true, stockSyncIntervalMinutes: true, priceSyncIntervalMinutes: true },
        },
      },
    });
    const data: { stockOnHand?: number; unitPriceCents?: number; pendingUnitPriceCents?: number | null; priceChangeFlagged?: boolean } = {};
    if (options.applyStock) {
      const fresh = rows.filter((row) => row.stockKnown && freshFor(row.updatedAt, row.supplier.stockSyncIntervalMinutes, now));
      if (fresh.length > 0) data.stockOnHand = stockLevel(fresh.map((row) => row.stockQty));
    }
    if (options.applyPrice) {
      const chosen = chooseSupplierOffer(rows.map((row) => ({
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
      const source = chosen ? rows.find((row) => row.supplierId === chosen.supplierId) : null;
      const sell = chosen?.costCents != null && source ? markedUpCents(chosen.costCents, source.supplier.markupPercent) : null;
      if (chosen && sell === null) {
        pricesHeld += 1;
      } else if (chosen && chosen.costCents != null && sell !== null && !priceAllowedByMargin(chosen.costCents, sell, minimumMarginPercent)) {
        pricesHeld += 1;
      } else if (chosen && sell !== null && priceChangeNeedsApproval(priceById.get(productId) ?? 0, sell)) {
        priceChangesFlagged += 1;
        data.pendingUnitPriceCents = sell;
        data.priceChangeFlagged = true;
      } else if (sell !== null) {
        data.unitPriceCents = sell;
        data.pendingUnitPriceCents = null;
        data.priceChangeFlagged = false;
      }
    }
    if (Object.keys(data).length > 0) {
      await getDb().product.update({ where: { id: productId }, data });
    }
  }
  if (!options.preserveMissing && touched.size > 0) {
    await recordActivity(getDb(), {
      workspaceId: actor.workspaceId,
      actorId: actor.userId === "system" ? null : actor.userId,
      type: "STOCK_SYNCED",
      summary: `Updated stock for ${touched.size} products.`,
    });
  }
  return { updated: touched.size, unmatched, pricesHeld, priceChangesFlagged, skipped: false };
}

async function readFeed(supplier: {
  stockFeedUrl: string | null;
  feedType: "JSON" | "XML" | "CSV_URL" | "MANUAL_CSV";
  authType: "NONE" | "BEARER" | "API_KEY_HEADER" | "BASIC";
  authHeaderName: string;
  authUsername: string;
  stockFeedKeyEncrypted: string | null;
  fieldMapping: unknown;
  vatMode: "INCLUSIVE" | "EXCLUSIVE";
}) {
  if (!supplier.stockFeedUrl) throw new AppError("Add the supplier feed address first.");
  const headers = new Headers({
    accept: supplier.feedType === "XML" ? "application/xml, text/xml" : supplier.feedType === "CSV_URL" ? "text/csv, text/plain" : "application/json",
  });
  const creds = unpackCreds(supplier.stockFeedKeyEncrypted ? openKey(supplier.stockFeedKeyEncrypted) : null);
  if (supplier.authType === "BEARER" && creds.token) headers.set("authorization", `Bearer ${creds.token}`);
  if (supplier.authType === "API_KEY_HEADER" && creds.token) headers.set(supplier.authHeaderName || "X-Api-Key", creds.token);
  if (supplier.authType === "BASIC" && (creds.username || creds.password)) {
    headers.set("authorization", `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}`);
  }
  const response = await fetch(publicUrl(supplier.stockFeedUrl), { headers, redirect: "manual", signal: AbortSignal.timeout(20000) });
  if (response.status >= 300 && response.status < 400) throw new AppError("The supplier feed must not redirect.");
  if (!response.ok) throw new AppError(`The supplier feed returned ${response.status}.`);
  const text = await response.text();
  if (text.length > 5_000_000) throw new AppError("The supplier feed is too large.");
  const mapping = readFieldMapping(supplier.fieldMapping);
  const parsed = supplier.feedType === "XML"
    ? parseXmlOffers(text, mapping)
    : supplier.feedType === "CSV_URL"
      ? parseCsvOffers(text, mapping)
      : parseJsonText(text, mapping);
  if (parsed.error) return parsed;
  return {
    ...parsed,
    offers: parsed.offers.map((offer) => ({ ...offer, costCents: exclusiveCostCents(offer.costCents, supplier.vatMode) })),
  };
}

async function ownedSupplier(workspaceId: string, supplierId: string) {
  const supplier = await getDb().supplier.findFirst({ where: { id: supplierId, workspaceId } });
  if (!supplier) throw new AppError("Supplier not found.", 404, "NOT_FOUND");
  return supplier;
}

function publicUrl(value: string) {
  try {
    return assertPublicHttpsUrl(value);
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : "Enter an https address.");
  }
}

function sealKey(value: string) {
  try {
    return encryptSecret(value);
  } catch {
    throw new AppError("Set OAUTH_ENCRYPTION_KEY before saving an API key.");
  }
}

function openKey(value: string) {
  try {
    return decryptSecret(value);
  } catch {
    throw new AppError("The saved supplier credential could not be read.");
  }
}

function unpackCreds(raw: string | null) {
  if (!raw) return { token: "", username: "", password: "" };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && ("token" in parsed || "password" in parsed || "username" in parsed)) {
      return {
        token: typeof parsed.token === "string" ? parsed.token : "",
        username: typeof parsed.username === "string" ? parsed.username : "",
        password: typeof parsed.password === "string" ? parsed.password : "",
      };
    }
  } catch {
    return { token: raw, username: "", password: "" };
  }
  return { token: raw, username: "", password: "" };
}

function mappingFromInput(input: FeedSettings): SupplierFieldMapping {
  const mapping: SupplierFieldMapping = {};
  const assign = (key: keyof SupplierFieldMapping, value: string) => {
    if (value.trim()) mapping[key] = value.trim();
  };
  assign("productElement", input.productElement);
  assign("sku", input.mapSku);
  assign("manufacturerPartNumber", input.mapMpn);
  assign("name", input.mapName);
  assign("brand", input.mapBrand);
  assign("cost", input.mapCost);
  assign("stock", input.mapStock);
  assign("description", input.mapDescription);
  assign("specifications", input.mapSpecifications);
  assign("imageUrls", input.mapImages);
  assign("category", input.mapCategory);
  assign("leadTimeDays", input.mapLeadTime);
  return mapping;
}

function readLeadTime(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const days = Number(trimmed);
  if (!Number.isInteger(days) || days < 0 || days > 365) throw new AppError("Enter a lead time from 0 to 365 days, or leave it blank.");
  return days;
}

function due(last: Date | null, minutes: number, now: Date) {
  if (!last) return true;
  return now.getTime() - last.getTime() >= minutes * 60 * 1000;
}

function freshFor(updatedAt: Date, minutes: number, now: Date) {
  return now.getTime() - updatedAt.getTime() <= minutes * 60 * 1000;
}

function parseJsonText(text: string, mapping: SupplierFieldMapping) {
  try {
    return parseJsonOffers(JSON.parse(text) as unknown, mapping);
  } catch {
    return { offers: [], skipped: 0, error: "The feed is not valid JSON." };
  }
}
