import { getDb, type DbClient } from "../lib/db";
import { AppError } from "../lib/errors";
import { centsToInput } from "./product-service";
import { assertPublicHttpsUrl, markedUpCents, parseSupplierStockBody, stockLeft, stockLevel } from "../lib/stock";
import { decryptSecret, encryptSecret } from "../lib/token-crypto";
import { recordActivity } from "./activity-service";
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
    select: { storeBaseUrl: true, storeKeyEncrypted: true, storeSecretEncrypted: true, storeLastSyncAt: true, storeLastError: true },
  });
  if (!workspace) return null;
  return {
    baseUrl: workspace.storeBaseUrl ?? "",
    connected: Boolean(workspace.storeBaseUrl && workspace.storeKeyEncrypted && workspace.storeSecretEncrypted),
    lastSyncAt: workspace.storeLastSyncAt,
    lastError: workspace.storeLastError,
  };
}

export async function saveStoreConnection(actor: Actor, input: { storeBaseUrl: string; consumerKey: string; consumerSecret: string }) {
  const workspace = await getDb().workspace.findFirst({
    where: { id: actor.workspaceId },
    select: { id: true, storeKeyEncrypted: true, storeSecretEncrypted: true },
  });
  if (!workspace) throw new AppError("Workspace not found.", 404, "NOT_FOUND");
  const url = input.storeBaseUrl.trim();
  if (url) publicUrl(url);
  const storeKeyEncrypted = input.consumerKey.trim() ? sealKey(input.consumerKey.trim()) : workspace.storeKeyEncrypted;
  const storeSecretEncrypted = input.consumerSecret.trim() ? sealKey(input.consumerSecret.trim()) : workspace.storeSecretEncrypted;
  if (url && (!storeKeyEncrypted || !storeSecretEncrypted)) throw new AppError("Enter the WooCommerce consumer key and secret.");
  await getDb().workspace.update({
    where: { id: workspace.id },
    data: {
      storeBaseUrl: url || null,
      storeKeyEncrypted: url ? storeKeyEncrypted : null,
      storeSecretEncrypted: url ? storeSecretEncrypted : null,
      storeLastError: null,
    },
  });
}

export async function pushStoreStock(workspaceId: string) {
  const workspace = await getDb().workspace.findFirst({
    where: { id: workspaceId },
    select: { id: true, storeBaseUrl: true, storeKeyEncrypted: true, storeSecretEncrypted: true, storeLastSyncAt: true },
  });
  if (!workspace?.storeBaseUrl || !workspace.storeKeyEncrypted || !workspace.storeSecretEncrypted) {
    return { pushed: 0, missing: 0, pending: false };
  }
  const key = decryptSecret(workspace.storeKeyEncrypted);
  const secret = decryptSecret(workspace.storeSecretEncrypted);
  const products = await getDb().product.findMany({
    where: { workspaceId, active: true, updatedAt: { gt: workspace.storeLastSyncAt ?? new Date(0) } },
    orderBy: { updatedAt: "asc" },
    take: BATCH,
  });
  let pushed = 0;
  let missing = 0;
  let cursor = workspace.storeLastSyncAt;
  const reserved = await reservedByProduct(workspaceId);
  try {
    for (const product of products) {
      const found = await wooProductId(workspace.storeBaseUrl, key, secret, product.sku);
      if (!found) {
        missing += 1;
        cursor = product.updatedAt;
        continue;
      }
      const available = stockLeft(product.stockOnHand, reserved.get(product.id) ?? 0);
      await wooUpdate(workspace.storeBaseUrl, key, secret, found, available, product.unitPriceCents);
      pushed += 1;
      cursor = product.updatedAt;
    }
    await getDb().workspace.update({
      where: { id: workspace.id },
      data: { storeLastSyncAt: cursor, storeLastError: null },
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "The website did not accept the stock update.";
    await getDb().workspace.update({
      where: { id: workspace.id },
      data: { storeLastSyncAt: cursor, storeLastError: message.slice(0, 300) },
    });
    throw error instanceof AppError ? error : new AppError(message);
  }
  const pending = products.length === BATCH;
  return { pushed, missing, pending };
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

async function applyFeed(actor: Actor, supplierId: string, items: { sku: string; costCents: number | null; stockQty: number }[]) {
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
    await getDb().product.update({
      where: { id: productId },
      data: {
        stockOnHand: stockLevel(rows.map((row) => row.stockQty)),
        ...(unitPriceCents === null ? {} : { unitPriceCents }),
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
  return { updated: touched.size, unmatched };
}

async function readFeed(url: string, encryptedKey: string | null) {
  const headers = new Headers({ accept: "application/json" });
  if (encryptedKey) headers.set("authorization", `Bearer ${decryptSecret(encryptedKey)}`);
  const response = await fetch(publicUrl(url), { headers, redirect: "manual", signal: AbortSignal.timeout(20000) });
  if (response.status >= 300 && response.status < 400) throw new AppError("The supplier feed must not redirect.");
  if (!response.ok) throw new AppError(`The supplier feed returned ${response.status}.`);
  return parseSupplierStockBody(await response.json());
}

async function wooProductId(baseUrl: string, key: string, secret: string, sku: string) {
  const url = new URL("/wp-json/wc/v3/products", publicUrl(baseUrl));
  url.searchParams.set("sku", sku);
  const response = await wooFetch(url, key, secret);
  const body = await response.json() as { id?: number }[];
  return Array.isArray(body) ? body.find((item) => item.id)?.id ?? null : null;
}

async function wooUpdate(baseUrl: string, key: string, secret: string, productId: number, stockOnHand: number, unitPriceCents: number) {
  const url = new URL(`/wp-json/wc/v3/products/${productId}`, publicUrl(baseUrl));
  await wooFetch(url, key, secret, {
    method: "PUT",
    body: JSON.stringify({
      manage_stock: true,
      stock_quantity: stockOnHand,
      stock_status: stockOnHand > 0 ? "instock" : "outofstock",
      regular_price: centsToInput(unitPriceCents),
    }),
  });
}

async function wooFetch(url: URL, key: string, secret: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
    },
  });
  if (response.status === 401 || response.status === 403) throw new AppError("The website rejected the WooCommerce API keys.");
  if (response.status >= 300 && response.status < 400) throw new AppError("The website address must not redirect.");
  if (!response.ok) throw new AppError(`The website returned ${response.status}.`);
  return response;
}

export async function storeGet(workspaceId: string, path: string, search: Record<string, string>) {
  const workspace = await getDb().workspace.findFirst({
    where: { id: workspaceId },
    select: { storeBaseUrl: true, storeKeyEncrypted: true, storeSecretEncrypted: true },
  });
  if (!workspace?.storeBaseUrl || !workspace.storeKeyEncrypted || !workspace.storeSecretEncrypted) {
    throw new AppError("Connect the website under Settings before syncing orders.");
  }
  const url = new URL(path, publicUrl(workspace.storeBaseUrl));
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, value);
  const response = await wooFetch(url, decryptSecret(workspace.storeKeyEncrypted), decryptSecret(workspace.storeSecretEncrypted));
  return response.json() as Promise<unknown>;
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
