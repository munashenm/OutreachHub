import { parseCsv, rowsToRecords } from "./csv";
import { parseMoneyToCents } from "./quote";
import { assertPublicHttpsUrl } from "./stock";

export type SupplierOffer = {
  supplierSku: string;
  manufacturerPartNumber: string;
  name: string;
  brand: string;
  costCents: number | null;
  stockQty: number | null;
  description: string;
  specifications: string;
  imageUrls: string[];
  category: string;
  leadTimeDays: number | null;
  matchSkus: string[];
  barcode?: string;
  productUrl?: string;
};

export type SupplierFieldMapping = {
  productElement?: string;
  sku?: string;
  manufacturerPartNumber?: string;
  name?: string;
  brand?: string;
  cost?: string;
  stock?: string;
  description?: string;
  specifications?: string;
  imageUrls?: string;
  category?: string;
  leadTimeDays?: string;
  barcode?: string;
  productUrl?: string;
  costInclusive?: string;
};

export type ParsedSupplierFeed = {
  offers: SupplierOffer[];
  skipped: number;
  error: string | null;
  costsAreExclusive?: boolean;
};

const FIELD_KEYS = [
  "productElement",
  "sku",
  "manufacturerPartNumber",
  "name",
  "brand",
  "cost",
  "stock",
  "description",
  "specifications",
  "imageUrls",
  "category",
  "leadTimeDays",
  "barcode",
  "productUrl",
  "costInclusive",
] as const;

const MPN_FIELDS = ["manufacturerPartNumber", "manufacturer_part_number", "mpn", "partNumber", "part_number"];
const NAME_FIELDS = ["name", "title"];
const BRAND_FIELDS = ["brand", "manufacturer"];
const COST_FIELDS = ["cost", "price", "unitCost", "unit_cost"];
const STOCK_FIELDS = ["stock", "quantity", "qty", "available", "stockQty", "stock_qty"];
const DESCRIPTION_FIELDS = ["description"];
const SPEC_FIELDS = ["specifications", "specs"];
const IMAGE_FIELDS = ["imageUrls", "images", "image", "imageUrl", "image_url"];
const CATEGORY_FIELDS = ["category"];
const LEAD_FIELDS = ["leadTimeDays", "lead_time_days", "leadTime", "lead_time"];
const BARCODE_FIELDS = ["barcode", "ean", "gtin", "upc"];
const PRODUCT_URL_FIELDS = ["productUrl", "product_url", "url", "link"];
const COST_INCLUSIVE_FIELDS = ["costInclusive", "costIncl", "priceIncl", "cost_incl_vat", "price_incl_vat"];
const PRODUCT_TAGS = ["product", "item", "offer"];
const TAG_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

export function readFieldMapping(value: unknown): SupplierFieldMapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const mapping: SupplierFieldMapping = {};
  for (const key of FIELD_KEYS) {
    const raw = source[key];
    if (typeof raw === "string" && raw.trim()) mapping[key] = raw.trim();
  }
  return mapping;
}

export function exclusiveCostCents(costCents: number | null, vatMode: "INCLUSIVE" | "EXCLUSIVE") {
  if (costCents === null) return null;
  if (vatMode === "EXCLUSIVE") return costCents;
  return Math.round((costCents * 100) / 115);
}

export function priceChangeNeedsApproval(currentCents: number, nextCents: number) {
  if (!Number.isInteger(currentCents) || currentCents <= 0) return false;
  if (!Number.isInteger(nextCents) || nextCents < 0) return false;
  return Math.abs(nextCents - currentCents) * 100 >= currentCents * 15;
}

export type SupplierChoice = {
  supplierId: string;
  costCents: number | null;
  costKnown: boolean;
  stockQty: number | null;
  stockKnown: boolean;
  updatedAt: Date;
  preference: number;
  leadTimeDays: number | null;
  priceFreshMs: number;
};

export function chooseSupplierOffer(offers: SupplierChoice[], requestedQty: number, now: Date) {
  const quantity = Math.max(1, Math.ceil(requestedQty) || 1);
  const eligible = offers.filter((offer) => {
    if (now.getTime() - offer.updatedAt.getTime() > offer.priceFreshMs) return false;
    if (!offer.stockKnown || offer.stockQty == null || offer.stockQty < quantity) return false;
    if (!offer.costKnown || offer.costCents == null || offer.costCents <= 0) return false;
    return true;
  });
  eligible.sort((left, right) => {
    const cost = (left.costCents ?? 0) - (right.costCents ?? 0);
    if (cost !== 0) return cost;
    if (left.preference !== right.preference) return right.preference - left.preference;
    const leftLead = left.leadTimeDays ?? Number.POSITIVE_INFINITY;
    const rightLead = right.leadTimeDays ?? Number.POSITIVE_INFINITY;
    if (leftLead !== rightLead) return leftLead - rightLead;
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  });
  return eligible[0] ?? null;
}

export function selectedSupplierStock(offers: SupplierChoice[], now: Date) {
  const chosen = chooseSupplierOffer(offers, 1, now);
  if (chosen?.stockQty != null) return Math.max(0, Math.floor(chosen.stockQty));
  const fresh = offers.filter((offer) => {
    if (now.getTime() - offer.updatedAt.getTime() > offer.priceFreshMs) return false;
    return offer.stockKnown && offer.stockQty != null;
  });
  if (fresh.length === 0) return null;
  fresh.sort((left, right) => {
    const leftQty = Math.max(0, Math.floor(left.stockQty ?? 0));
    const rightQty = Math.max(0, Math.floor(right.stockQty ?? 0));
    if ((leftQty > 0) !== (rightQty > 0)) return leftQty > 0 ? -1 : 1;
    if (left.preference !== right.preference) return right.preference - left.preference;
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  });
  return Math.max(0, Math.floor(fresh[0]?.stockQty ?? 0));
}

export function matchCatalogueOffer(
  offer: SupplierOffer,
  productBySku: ReadonlyMap<string, string>,
  productByMpn: ReadonlyMap<string, string>,
) {
  const partNumber = offer.manufacturerPartNumber.trim().toLowerCase();
  if (partNumber) {
    const byPart = productByMpn.get(partNumber) ?? productBySku.get(partNumber);
    if (byPart) return byPart;
  }
  const keys = offer.matchSkus.length > 0 ? offer.matchSkus : [offer.supplierSku];
  for (const key of keys) {
    const productId = productBySku.get(key.trim().toLowerCase());
    if (productId) return productId;
  }
  return null;
}

export function parseJsonOffers(body: unknown, mapping: SupplierFieldMapping = {}): ParsedSupplierFeed {
  const source = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)
      ? (body as { items: unknown[] }).items
      : body && typeof body === "object" && Array.isArray((body as { products?: unknown }).products)
        ? (body as { products: unknown[] }).products
        : null;
  if (!source) return { offers: [], skipped: 0, error: "The feed must be a JSON list, or an object with items or products." };
  return collectOffers(source.map((entry) => offerFromRecord(asRecord(entry), mapping)));
}

export function parseXmlOffers(xml: string, mapping: SupplierFieldMapping = {}): ParsedSupplierFeed {
  const table = xmlProductRecords(xml, mapping.productElement);
  if (table.error) return { offers: [], skipped: 0, error: table.error };
  return offersFromCsvRecords(table.records, mapping);
}

export function xmlProductRecords(xml: string, productElement = ""): { headers: string[]; records: Record<string, string>[]; error: string | null } {
  if (/<!DOCTYPE/i.test(xml)) return { headers: [], records: [], error: "The XML file cannot use a document type." };
  const cleaned = xml.replace(/^\uFEFF/, "").replace(/<!--[\s\S]*?-->/g, "");
  const tag = productElement.trim() || PRODUCT_TAGS.find((name) => elements(cleaned, name).length > 0) || "";
  if (!tag || !TAG_NAME.test(tag)) return { headers: [], records: [], error: "The XML file has no product element." };
  const blocks = elements(cleaned, tag);
  if (blocks.length === 0) return { headers: [], records: [], error: "The XML file has no product element." };
  const records = blocks.map((block) => {
    const source = xmlRecord(block, tag);
    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(source)) {
      if (Array.isArray(value)) record[key] = value.map((entry) => text(entry)).filter(Boolean).join("|");
      else record[key] = text(value);
    }
    return record;
  });
  const headers = [...new Set(records.flatMap((record) => Object.keys(record)))];
  return { headers, records, error: null };
}

export function parseCsvOffers(text: string, mapping: SupplierFieldMapping = {}): ParsedSupplierFeed {
  let rows: string[][];
  try {
    rows = parseCsv(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    return { offers: [], skipped: 0, error: error instanceof Error ? error.message : "The CSV feed could not be read." };
  }
  return offersFromCsvRecords(rowsToRecords(rows), mapping);
}

export function offersFromCsvRecords(records: Record<string, string>[], mapping: SupplierFieldMapping = {}): ParsedSupplierFeed {
  return collectOffers(records.map((record) => offerFromRecord(record, mapping)));
}

function collectOffers(parsed: Array<SupplierOffer | null>): ParsedSupplierFeed {
  const byKey = new Map<string, SupplierOffer>();
  let skipped = 0;
  for (const offer of parsed) {
    if (!offer) {
      skipped += 1;
      continue;
    }
    const key = (offer.supplierSku || offer.manufacturerPartNumber).toLowerCase();
    byKey.set(key, offer);
  }
  const offers = [...byKey.values()].slice(0, 5000);
  skipped += Math.max(0, byKey.size - offers.length);
  return { offers, skipped, error: null };
}

function offerFromRecord(record: Record<string, unknown> | null, mapping: SupplierFieldMapping): SupplierOffer | null {
  if (!record) return null;
  const identified = identifiers(record, mapping);
  const manufacturerPartNumber = clip(text(valueFor(record, mapping, "manufacturerPartNumber", MPN_FIELDS)), 80);
  if (!identified.supplierSku && !manufacturerPartNumber) return null;
  const costValue = valueFor(record, mapping, "cost", COST_FIELDS);
  let costCents = money(costValue);
  if (present(costValue) && costCents === null) return null;
  if (!present(costValue)) {
    const inclusiveValue = valueFor(record, mapping, "costInclusive", COST_INCLUSIVE_FIELDS);
    const inclusiveCents = money(inclusiveValue);
    if (present(inclusiveValue) && inclusiveCents === null) return null;
    if (inclusiveCents !== null) costCents = exclusiveCostCents(inclusiveCents, "INCLUSIVE");
  }
  const stockValue = valueFor(record, mapping, "stock", STOCK_FIELDS);
  const stockQty = quantity(stockValue);
  if (present(stockValue) && stockQty === null) return null;
  const leadValue = valueFor(record, mapping, "leadTimeDays", LEAD_FIELDS);
  const leadTimeDays = leadDays(leadValue);
  if (present(leadValue) && leadTimeDays === null) return null;
  return {
    supplierSku: identified.supplierSku || manufacturerPartNumber,
    manufacturerPartNumber,
    name: clip(text(valueFor(record, mapping, "name", NAME_FIELDS)), 160),
    brand: clip(text(valueFor(record, mapping, "brand", BRAND_FIELDS)), 80),
    costCents,
    stockQty,
    description: clip(text(valueFor(record, mapping, "description", DESCRIPTION_FIELDS)), 4000),
    specifications: clip(text(valueFor(record, mapping, "specifications", SPEC_FIELDS)), 8000),
    imageUrls: imageList(valueFor(record, mapping, "imageUrls", IMAGE_FIELDS)),
    category: clip(text(valueFor(record, mapping, "category", CATEGORY_FIELDS)), 80),
    leadTimeDays,
    matchSkus: identified.matchSkus,
    barcode: clip(text(valueFor(record, mapping, "barcode", BARCODE_FIELDS)), 80),
    productUrl: productAddress(valueFor(record, mapping, "productUrl", PRODUCT_URL_FIELDS)),
  };
}

function identifiers(record: Record<string, unknown>, mapping: SupplierFieldMapping) {
  const custom = mapping.sku?.trim();
  if (custom) {
    const sku = clip(text(recordValue(record, [custom])), 80);
    return { supplierSku: sku, matchSkus: sku ? [sku] : [] };
  }
  const supplierCode = clip(text(recordValue(record, ["supplierSku", "supplier_sku"])), 80);
  const listedCode = clip(text(recordValue(record, ["sku", "code"])), 80);
  const supplierSku = supplierCode || listedCode;
  const matchSkus = [...new Set([listedCode, supplierSku].filter(Boolean))];
  return { supplierSku, matchSkus };
}

function valueFor(
  record: Record<string, unknown>,
  mapping: SupplierFieldMapping,
  key: Exclude<keyof SupplierFieldMapping, "productElement">,
  defaults: string[],
) {
  const custom = mapping[key];
  return recordValue(record, custom ? [custom] : defaults);
}

function recordValue(record: Record<string, unknown>, names: string[]) {
  const entries = Object.entries(record);
  for (const name of names) {
    const found = entries.find(([key, value]) => key.toLowerCase() === name.toLowerCase() && value != null && value !== "");
    if (found) return found[1];
  }
  return undefined;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function present(value: unknown) {
  return value != null && value !== "";
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function clip(value: string, max: number) {
  return value.slice(0, max);
}

function money(value: unknown) {
  if (!present(value)) return null;
  if (typeof value === "number" && Number.isFinite(value)) return parseMoneyToCents(value.toFixed(2));
  let raw = text(value).replace(/zar/gi, "").replace(/\s/g, "").replace(/^r/i, "");
  if (raw.includes(".") && raw.includes(",")) raw = raw.replace(/,/g, "");
  else if (/^\d{1,3}(,\d{3})+$/.test(raw)) raw = raw.replace(/,/g, "");
  else raw = raw.replace(",", ".");
  return parseMoneyToCents(raw);
}

function quantity(value: unknown) {
  if (!present(value)) return null;
  const parsed = typeof value === "number" ? value : Number(text(value));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) return null;
  return Math.floor(parsed);
}

function leadDays(value: unknown) {
  if (!present(value)) return null;
  const parsed = typeof value === "number" ? value : Number(text(value));
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) return null;
  return parsed;
}

function productAddress(value: unknown) {
  const line = text(value);
  if (!line) return "";
  try {
    return assertPublicHttpsUrl(line).href.slice(0, 500);
  } catch {
    return "";
  }
}

function imageList(value: unknown) {
  const raw = Array.isArray(value) ? value.flatMap((entry) => text(entry).split(/[\n,|]/)) : text(value).split(/[\n,|]/);
  const urls: string[] = [];
  for (const entry of raw) {
    const line = entry.trim();
    if (!line) continue;
    try {
      const address = assertPublicHttpsUrl(line).href;
      if (!urls.includes(address)) urls.push(address);
    } catch {
      continue;
    }
    if (urls.length === 8) break;
  }
  return urls;
}

function elements(xml: string, tag: string) {
  if (!TAG_NAME.test(tag)) return [];
  const name = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blocks: string[] = [];
  for (const match of xml.matchAll(new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi"))) blocks.push(match[0]);
  for (const match of xml.matchAll(new RegExp(`<${name}(\\s[^>]*?)/>`, "gi"))) blocks.push(match[0]);
  return blocks;
}

function xmlRecord(block: string, tag: string) {
  const open = new RegExp(`^<${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s[^>]*?)?/?>`, "i").exec(block);
  const record: Record<string, unknown> = {};
  if (open?.[1]) {
    for (const match of open[1].matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
      record[localName(match[1])] = decodeXml(match[2]);
    }
  }
  const inner = block.replace(/^<[^>]+>/, "").replace(/<\/[^>]+>$/, "");
  const child = /<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  const images: string[] = [];
  for (const match of inner.matchAll(child)) {
    const key = localName(match[1]);
    const content = decodeXml(match[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!content) continue;
    if (IMAGE_FIELDS.some((name) => name.toLowerCase() === key.toLowerCase())) images.push(content);
    else if (!(key in record)) record[key] = content;
  }
  if (images.length > 0) record.imageUrls = images;
  return record;
}

function localName(tag: string) {
  const parts = tag.split(":");
  return parts[parts.length - 1] ?? tag;
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
