import { getDb, type DbClient } from "../lib/db";
import { AppError } from "../lib/errors";
import { assertPublicHttpsUrl, markedUpCents, parseSupplierStockBody, priceAllowedByMargin, stockLeft, stockLevel } from "../lib/stock";
import { decryptSecret, encryptSecret } from "../lib/token-crypto";
import { recordActivity } from "./activity-service";
import { createStoreProvider, type StoreCatalogProduct } from "./store";
import type { Actor } from "./types";

const BATCH = 40;

export async function saveSupplierFeed(actor: Actor, input: { supplierId: string; markupPercent: number; stockFeedUrl: string; stockFeedKey: string }) {
  const supplier = await ownedSupplier(actor.workspaceId, input.supplierId);
  const url = input.stockFeedUrl.trim();
  if (url) publicUrl(url);
  let stockFeedKeyEncrypted = supplier.stockFeedKeyEncrypted;
  if (!url) stockFeedKeyEncrypted = null;
  else if (input.stockFeedKey.trim()) stockFeedKeyEncrypted = sealKey(input.stockFeedKey.trim());
  await getDb().supplier.update({
    where: { id: supplier.id },
    data: { markupPercent: input.markupPercent, stockFeedUrl: url || null, stockFeedKeyEncrypted },
  });
}

export async function syncSupplierFeed(actor: Actor, supplierId: string) {
  const supplier = await ownedSupplier(actor.workspaceId, supplierId);
  if (!supplier.stockFeedUrl) throw new AppError("Add the supplier stock feed address first.");
  try {
    const parsed = await readFeed(supplier.stockFeedUrl, supplier.stockFeedKeyEncrypted);
    if (parsed.error) throw new AppError(parsed.error);
    const result = await applyFeed(actor, supplier.id, parsed.items);
    await getDb().supplier.update({
      where: { id: supplier.id },
      data: { lastStockSyncAt: new Date(), lastStockSyncError: null },
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
    where: { stockFeedUrl: { not: null } },
    select: { id: true, workspaceId: true },
  });
  const workspaces = new Set<string>();
  const results: { supplierId: string; updated?: number; error?: string }[] = [];
  for (const supplier of suppliers) {
    workspaces.add(supplier.workspaceId);
    try {
      const result = await syncSupplierFeed({ userId: "system", workspaceId: supplier.workspaceId }, supplier.id);
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
    where: { workspaceId, productId: { in: productIds }, costCents: { gt: 0 } },
    select: { productId: true, costCents: true, stockQty: true },
  });
  const inStock = new Map<string, number>();
  for (const row of rows) {
    const current = costs.get(row.productId);
    if (current === undefined || row.costCents < current) costs.set(row.productId, row.costCents);
    if (row.stockQty > 0) {
      const stocked = inStock.get(row.productId);
      if (stocked === undefined || row.costCents < stocked) inStock.set(row.productId, row.costCents);
    }
  }
  for (const [productId, cost] of inStock) costs.set(productId, cost);
  return costs;
}

async function applyFeed(actor: Actor, supplierId: string, items: { sku: string; costCents: number | null; stockQty: number }[]) {
  const margin = await getDb().workspace.findFirst({
    where: { id: actor.workspaceId },
    select: { minimumMarginPercent: true },
  });
  const minimumMarginPercent = margin?.minimumMarginPercent ?? 0;
  const products = await getDb().product.findMany({
    where: { workspaceId: actor.workspaceId },
    select: { id: true, sku: true },
  });
  const bySku = new Map(products.map((product) => [product.sku.toLowerCase(), product.id]));
  const links = await getDb().supplierPrice.findMany({
    where: { workspaceId: actor.workspaceId, supplierId },
    select: { productId: true, supplierSku: true },
  });
  for (const link of links) bySku.set(link.supplierSku.toLowerCase(), link.productId);
  const touched = new Set<string>();
  let unmatched = 0;
  let pricesHeld = 0;
  for (const item of items) {
    const productId = bySku.get(item.sku.toLowerCase());
    if (!productId) {
      unmatched += 1;
      continue;
    }
    await getDb().supplierPrice.upsert({
      where: { supplierId_productId: { supplierId, productId } },
      update: {
        supplierSku: item.sku,
        stockQty: item.stockQty,
        ...(item.costCents === null ? {} : { costCents: item.costCents }),
      },
      create: {
        workspaceId: actor.workspaceId,
        supplierId,
        productId,
        supplierSku: item.sku,
        costCents: item.costCents ?? 0,
        stockQty: item.stockQty,
      },
    });
    touched.add(productId);
  }
  for (const productId of touched) {
    const rows = await getDb().supplierPrice.findMany({
      where: { workspaceId: actor.workspaceId, productId },
      include: { supplier: { select: { markupPercent: true } } },
    });
    const available = rows.filter((row) => row.costCents > 0 && row.stockQty > 0);
    const priced = available.length > 0 ? available : rows.filter((row) => row.costCents > 0);
    const best = priced.reduce<(typeof priced)[number] | null>((lowest, row) => {
      if (!lowest || row.costCents < lowest.costCents) return row;
      return lowest;
    }, null);
    const unitPriceCents = best ? markedUpCents(best.costCents, best.supplier.markupPercent) : null;
    const publishPrice = unitPriceCents !== null && best !== null && priceAllowedByMargin(best.costCents, unitPriceCents, minimumMarginPercent);
    if (unitPriceCents !== null && !publishPrice) pricesHeld += 1;
    await getDb().product.update({
      where: { id: productId },
      data: {
        stockOnHand: stockLevel(rows.map((row) => row.stockQty)),
        ...(publishPrice && unitPriceCents !== null ? { unitPriceCents } : {}),
      },
    });
  }
  if (touched.size > 0) {
    await recordActivity(getDb(), {
      workspaceId: actor.workspaceId,
      actorId: actor.userId === "system" ? null : actor.userId,
      type: "STOCK_SYNCED",
      summary: `Updated stock for ${touched.size} products.`,
    });
  }
  return { updated: touched.size, unmatched, pricesHeld };
}

async function readFeed(url: string, encryptedKey: string | null) {
  const headers = new Headers({ accept: "application/json" });
  if (encryptedKey) headers.set("authorization", `Bearer ${decryptSecret(encryptedKey)}`);
  const response = await fetch(publicUrl(url), { headers, redirect: "manual", signal: AbortSignal.timeout(20000) });
  if (response.status >= 300 && response.status < 400) throw new AppError("The supplier feed must not redirect.");
  if (!response.ok) throw new AppError(`The supplier feed returned ${response.status}.`);
  return parseSupplierStockBody(await response.json());
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
