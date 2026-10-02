export type ParsedStoreProduct = {
  storeProductId: string;
  sku: string;
  skuKey: string;
  manufacturerPartNumber: string;
  mpnKey: string;
  barcode: string;
  barcodeKey: string;
  name: string;
  brand: string;
  brandModelKey: string;
  category: string;
  unitPriceCents: number;
  salePriceCents: number | null;
  currency: string;
  stockQuantity: number;
  stockStatus: string;
  description: string;
  specifications: string;
  imageUrls: string[];
  published: boolean;
  slug: string;
  url: string;
  storeUpdatedAt: string | null;
};

export type ParsedCataloguePage = {
  page: number;
  perPage: number;
  total: number;
  lastPage: number;
  products: ParsedStoreProduct[];
};

export type CatalogueRecord = {
  id: string;
  storeProductId: string;
  sku: string;
  skuKey: string;
  mpnKey: string;
  barcodeKey: string;
  brandModelKey: string;
  name: string;
  unitPriceCents: number;
  stockQuantity: number;
  imageCount: number;
  published: boolean;
  productId: string | null;
  reviewStatus: string;
};

export type CatalogueStats = {
  total: number;
  withSku: number;
  withoutSku: number;
  withMpn: number;
  missingMpn: number;
  withBarcode: number;
  missingBarcode: number;
  withImages: number;
  missingImages: number;
  zeroStock: number;
  withoutPrice: number;
  duplicateSkuProducts: number;
  duplicateSkuGroups: number;
  duplicateMpnProducts: number;
  duplicateMpnGroups: number;
  duplicateBarcodeProducts: number;
  duplicateBarcodeGroups: number;
  duplicateBrandModelProducts: number;
  duplicateBrandModelGroups: number;
  readyForSupplierMatching: number;
  matchedToCatalogue: number;
  needsReview: number;
  published: number;
  unpublished: number;
};

export type StoreIdentity = {
  storeProductId: string;
  sku: string;
  skuKey: string;
  mpnKey: string;
  barcodeKey: string;
  brandModelKey: string;
  name: string;
};

export type MatchDecision =
  | { outcome: "MATCHED"; storeProductId: string; sku: string; by: "storeProductId" | "mpn" | "sku" | "barcode" | "supplierSku" | "brandModel" }
  | { outcome: "MATCH_REVIEW_REQUIRED"; storeProductId: string | null; reason: string }
  | { outcome: "HIGH_CONFIDENCE_NEW" };

const PLACEHOLDER = ["product-placeholder", "image-coming-soon", "coming-soon", "placeholder", "no-image", "noimage", "default-product", "missing-image"];

export function skuKey(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function mpnKey(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function barcodeKey(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 ? digits : "";
}

export function brandModelKey(brand: string, model: string) {
  const brandKey = mpnKey(brand);
  const modelKey = mpnKey(model);
  if (brandKey.length < 2 || modelKey.length < 3) return "";
  return `${brandKey}|${modelKey}`;
}

export function parseStoreCataloguePage(body: unknown): ParsedCataloguePage | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "The store catalogue page was not a product list." };
  const record = body as Record<string, unknown>;
  const page = positiveInt(record.page);
  const perPage = positiveInt(record.perPage);
  const total = nonNegativeInt(record.total);
  const lastPage = positiveInt(record.lastPage);
  if (page === null || perPage === null || total === null || lastPage === null || !Array.isArray(record.products)) {
    return { error: "The store catalogue page did not include products." };
  }
  const products: ParsedStoreProduct[] = [];
  for (const entry of record.products) {
    const parsed = parseStoreProduct(entry);
    if ("error" in parsed) return parsed;
    products.push(parsed);
  }
  return { page, perPage, total, lastPage, products };
}

export function analyseCatalogue(records: readonly CatalogueRecord[]) {
  const flags = new Map<string, string[]>();
  const add = (ids: string[], kind: string) => {
    for (const id of ids) {
      const current = flags.get(id) ?? [];
      if (!current.includes(kind)) current.push(kind);
      flags.set(id, current);
    }
  };
  const skuGroups = grouped(records, (record) => record.skuKey);
  const mpnGroups = grouped(records, (record) => record.mpnKey);
  const barcodeGroups = grouped(records, (record) => record.barcodeKey);
  const brandGroups = grouped(records, (record) => record.brandModelKey);
  for (const group of skuGroups) add(group, "sku");
  for (const group of mpnGroups) add(group, "mpn");
  for (const group of barcodeGroups) add(group, "barcode");
  for (const group of brandGroups) add(group, "brandModel");

  const duplicateIds = new Set(flags.keys());
  let ready = 0;
  for (const record of records) {
    const identified = record.skuKey !== "" || record.mpnKey !== "" || record.barcodeKey !== "";
    if (identified && !duplicateIds.has(record.id)) ready += 1;
  }
  const stats: CatalogueStats = {
    total: records.length,
    withSku: records.filter((record) => record.skuKey !== "").length,
    withoutSku: records.filter((record) => record.skuKey === "").length,
    withMpn: records.filter((record) => record.mpnKey !== "").length,
    missingMpn: records.filter((record) => record.mpnKey === "").length,
    withBarcode: records.filter((record) => record.barcodeKey !== "").length,
    missingBarcode: records.filter((record) => record.barcodeKey === "").length,
    withImages: records.filter((record) => record.imageCount > 0).length,
    missingImages: records.filter((record) => record.imageCount === 0).length,
    zeroStock: records.filter((record) => record.stockQuantity <= 0).length,
    withoutPrice: records.filter((record) => record.unitPriceCents <= 0).length,
    duplicateSkuProducts: new Set(skuGroups.flat()).size,
    duplicateSkuGroups: skuGroups.length,
    duplicateMpnProducts: new Set(mpnGroups.flat()).size,
    duplicateMpnGroups: mpnGroups.length,
    duplicateBarcodeProducts: new Set(barcodeGroups.flat()).size,
    duplicateBarcodeGroups: barcodeGroups.length,
    duplicateBrandModelProducts: new Set(brandGroups.flat()).size,
    duplicateBrandModelGroups: brandGroups.length,
    readyForSupplierMatching: ready,
    matchedToCatalogue: records.filter((record) => record.productId).length,
    needsReview: records.filter((record) => duplicateIds.has(record.id) || record.reviewStatus === "MATCH_REVIEW_REQUIRED" || record.reviewStatus === "IMAGE_REVIEW_REQUIRED").length,
    published: records.filter((record) => record.published).length,
    unpublished: records.filter((record) => !record.published).length,
  };
  return { stats, flags };
}

export function recommendedCatalogueAction(item: { duplicateKinds: string; skuKey: string; mpnKey: string; imageCount: number; unitPriceCents: number }) {
  if (item.duplicateKinds !== "") return "Review this duplicate. Do not create another website product.";
  if (item.skuKey === "" && item.mpnKey === "") return "Add a SKU or manufacturer part number before a supplier item can match it.";
  if (item.unitPriceCents <= 0) return "The website price is missing. Leave the product in place until the price is confirmed.";
  if (item.imageCount === 0) return "Keep the existing product. An image is added only when the model is verified.";
  return "Ready for supplier matching. The website product stays as it is.";
}

export type CatalogueOfferView = {
  supplierName: string;
  costCents: number | null;
  stockQty: number | null;
  sellCents: number | null;
};

export function catalogueDifference(
  store: { stockQuantity: number; unitPriceCents: number },
  offer: CatalogueOfferView | null,
) {
  if (!offer) return { compared: false, stockDiffers: false, priceDiffers: false };
  const hasStock = offer.stockQty != null;
  const hasSell = offer.sellCents != null && offer.sellCents > 0;
  if (!hasStock && !hasSell) return { compared: false, stockDiffers: false, priceDiffers: false };
  return {
    compared: true,
    stockDiffers: hasStock && offer.stockQty !== Math.max(0, Math.floor(store.stockQuantity)),
    priceDiffers: hasSell && offer.sellCents !== store.unitPriceCents,
  };
}

export function matchStoreProduct(
  candidate: { storeProductId?: string; sku?: string; manufacturerPartNumber?: string; barcode?: string; brand?: string; name?: string; supplierSku?: string },
  items: readonly StoreIdentity[],
  confirmedSupplierSkus: ReadonlyMap<string, string> = new Map(),
): MatchDecision {
  const storeProductId = candidate.storeProductId?.trim() ?? "";
  if (storeProductId) {
    const found = unique(items.filter((item) => item.storeProductId === storeProductId));
    if (found.length === 1) return matched(found[0], "storeProductId");
    if (found.length > 1) return review(found[0]?.storeProductId ?? null, "More than one store product uses this id.");
  }

  const part = mpnKey(candidate.manufacturerPartNumber ?? "");
  if (part.length >= 3) {
    const found = unique(items.filter((item) => item.mpnKey === part));
    if (found.length === 1) return matched(found[0], "mpn");
    if (found.length > 1) return review(found[0]?.storeProductId ?? null, "More than one store product uses this manufacturer part number.");
  }

  const sku = skuKey(candidate.sku ?? "");
  if (sku) {
    const found = unique(items.filter((item) => item.skuKey === sku));
    if (found.length === 1) return matched(found[0], "sku");
    if (found.length > 1) return review(found[0]?.storeProductId ?? null, "More than one store product uses this SKU.");
  }

  const barcode = barcodeKey(candidate.barcode ?? "");
  if (barcode) {
    const found = unique(items.filter((item) => item.barcodeKey === barcode));
    if (found.length === 1) return matched(found[0], "barcode");
    if (found.length > 1) return review(found[0]?.storeProductId ?? null, "More than one store product uses this barcode.");
  }

  const supplierKey = skuKey(candidate.supplierSku ?? "");
  if (supplierKey && confirmedSupplierSkus.has(supplierKey)) {
    const confirmedId = confirmedSupplierSkus.get(supplierKey) ?? "";
    const found = items.find((item) => item.storeProductId === confirmedId);
    if (found) return matched(found, "supplierSku");
    return review(null, "The confirmed supplier SKU does not match a store product.");
  }

  const brandModel = brandModelKey(candidate.brand ?? "", candidate.manufacturerPartNumber ?? "");
  if (brandModel) {
    const found = unique(items.filter((item) => item.brandModelKey === brandModel));
    if (found.length === 1) return matched(found[0], "brandModel");
    if (found.length > 1) return review(found[0]?.storeProductId ?? null, "More than one store product uses this brand and model.");
    return review(null, "This brand and model are not on the store. Review it before creating a product.");
  }

  const suggestion = fuzzySuggestion(candidate.name ?? "", items);
  if (suggestion) return review(suggestion.storeProductId, "The name is similar to an existing store product. Confirm the match before anything is created.");
  if (part.length >= 3 || barcode) return { outcome: "HIGH_CONFIDENCE_NEW" };
  return review(null, "This item needs a manufacturer part number or barcode before it can be added.");
}

export function sharesDuplicateKey(
  left: { skuKey: string; mpnKey: string; barcodeKey: string; brandModelKey: string },
  right: { skuKey: string; mpnKey: string; barcodeKey: string; brandModelKey: string },
) {
  return (left.skuKey !== "" && left.skuKey === right.skuKey)
    || (left.mpnKey !== "" && left.mpnKey === right.mpnKey)
    || (left.barcodeKey !== "" && left.barcodeKey === right.barcodeKey)
    || (left.brandModelKey !== "" && left.brandModelKey === right.brandModelKey);
}

function parseStoreProduct(entry: unknown): ParsedStoreProduct | { error: string } {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { error: "The store catalogue page included a product that could not be read." };
  const record = entry as Record<string, unknown>;
  const storeProductId = clip(record.storeProductId, 40);
  const name = clip(record.name, 300);
  if (!storeProductId || !name) return { error: "A store product is missing its id or name." };
  const sku = clip(record.sku, 80);
  const manufacturerPartNumber = clip(record.manufacturerPartNumber, 80);
  const barcode = clip(record.barcode, 40);
  const brand = clip(record.brand, 80);
  const unitPriceCents = nonNegativeInt(record.unitPriceCents);
  const stockQuantity = nonNegativeInt(record.stockQuantity);
  if (unitPriceCents === null || stockQuantity === null || typeof record.published !== "boolean") {
    return { error: "A store product is missing its price, stock, or publish status." };
  }
  const salePriceCents = record.salePriceCents === null || record.salePriceCents === undefined ? null : nonNegativeInt(record.salePriceCents);
  if (salePriceCents === null && record.salePriceCents !== null && record.salePriceCents !== undefined) {
    return { error: "A store product has a sale price that could not be read." };
  }
  const updatedAt = typeof record.updatedAt === "string" && !Number.isNaN(Date.parse(record.updatedAt)) ? new Date(record.updatedAt).toISOString() : null;
  return {
    storeProductId,
    sku,
    skuKey: skuKey(sku),
    manufacturerPartNumber,
    mpnKey: mpnKey(manufacturerPartNumber),
    barcode,
    barcodeKey: barcodeKey(barcode),
    name,
    brand,
    brandModelKey: brandModelKey(brand, manufacturerPartNumber),
    category: clip(record.category, 160),
    unitPriceCents,
    salePriceCents,
    currency: clip(record.currency, 3) || "ZAR",
    stockQuantity,
    stockStatus: clip(record.stockStatus, 40),
    description: clip(record.description, 8000),
    specifications: clip(record.specifications, 8000),
    imageUrls: imageList(record.imageUrls),
    published: record.published,
    slug: clip(record.slug, 200),
    url: httpsUrl(record.url),
    storeUpdatedAt: updatedAt,
  };
}

function imageList(value: unknown) {
  if (!Array.isArray(value)) return [];
  const urls: string[] = [];
  for (const entry of value) {
    const url = httpsUrl(entry);
    if (!url || PLACEHOLDER.some((needle) => url.toLowerCase().includes(needle))) continue;
    if (!urls.includes(url)) urls.push(url);
    if (urls.length === 8) break;
  }
  return urls;
}

function httpsUrl(value: unknown) {
  if (typeof value !== "string") return "";
  const url = value.trim();
  if (url.length > 2000 || /\s/.test(url)) return "";
  if (!url.startsWith("https://") && !url.startsWith("http://")) return "";
  return url;
}

function clip(value: unknown, max: number) {
  return typeof value === "string" ? value.replaceAll("\u0000", "").trim().slice(0, max) : "";
}

function positiveInt(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 1_000_000 ? value : null;
}

function nonNegativeInt(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return Math.min(value, 2_147_483_647);
}

function grouped(records: readonly CatalogueRecord[], key: (record: CatalogueRecord) => string) {
  const groups = new Map<string, string[]>();
  for (const record of records) {
    const value = key(record);
    if (!value) continue;
    const list = groups.get(value) ?? [];
    list.push(record.id);
    groups.set(value, list);
  }
  return [...groups.values()].filter((ids) => ids.length > 1);
}

function unique(items: StoreIdentity[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.storeProductId)) return false;
    seen.add(item.storeProductId);
    return true;
  });
}

function matched(item: StoreIdentity, by: "storeProductId" | "mpn" | "sku" | "barcode" | "supplierSku" | "brandModel"): MatchDecision {
  return { outcome: "MATCHED", storeProductId: item.storeProductId, sku: item.sku, by };
}

function review(storeProductId: string | null, reason: string): MatchDecision {
  return { outcome: "MATCH_REVIEW_REQUIRED", storeProductId, reason };
}

function fuzzySuggestion(name: string, items: readonly StoreIdentity[]) {
  const tokens = nameTokens(name);
  if (tokens.length < 2) return null;
  const hits = items.filter((item) => {
    const other = nameTokens(item.name);
    if (other.length < 2) return false;
    const shared = other.filter((token) => tokens.includes(token)).length;
    return shared >= 2 && shared / Math.min(tokens.length, other.length) >= 0.8;
  });
  return hits.length === 1 ? hits[0] : null;
}

function nameTokens(name: string) {
  return name.toUpperCase().split(/[^A-Z0-9]+/).filter((token) => token.length >= 4);
}

const SECRET_FIELD = /api[_-]?key|password|secret|token|cost[_-]?price|supplier[_-]?cost/i;

export function secretFieldPaths(value: unknown, path = ""): string[] {
  if (!value || typeof value !== "object") return [];
  const found: string[] = [];
  const entries = Array.isArray(value) ? value.map((entry, index) => [String(index), entry] as const) : Object.entries(value as Record<string, unknown>);
  for (const [key, child] of entries) {
    const next = path ? `${path}.${key}` : key;
    if (!Array.isArray(value) && SECRET_FIELD.test(key)) found.push(next);
    if (found.length < 20) found.push(...secretFieldPaths(child, next));
  }
  return found.slice(0, 20);
}
