import { parseCsv, rowsToRecords } from "./csv";
import { parseMoneyToCents } from "./quote";
import { assertPublicHttpsUrl } from "./stock";
import type { ParsedSupplierFeed, SupplierOffer } from "./supplier-connector";

const BRANCHES = ["cpt", "jhb", "dbn"];

export function isScoopFeedUrl(value: string) {
  try {
    const host = new URL(value.trim()).hostname.toLowerCase();
    return host === "scoop.co.za" || host.endsWith(".scoop.co.za");
  } catch {
    return false;
  }
}

export function isScoopPriceList(text: string) {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  if (/<!doctype html/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) return false;
  const head = trimmed.slice(0, 2000).toLowerCase();
  return /\bsku\b/.test(head) && /dealer[\s_-]*price/.test(head);
}

export function parseScoopPriceList(text: string): ParsedSupplierFeed {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return failed("The Scoop price list was empty.");
  if (/<!doctype html/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) return failed("The Scoop price list was not a CSV or XML file.");
  if (/<!DOCTYPE/i.test(trimmed)) return failed("The Scoop price list cannot use a document type.");
  try {
    const records = trimmed.startsWith("<") ? recordsFromXml(trimmed) : recordsFromCsv(trimmed);
    return collect(records.map(offerFromScoop));
  } catch (error) {
    return failed(error instanceof Error ? error.message : "The Scoop price list could not be read.");
  }
}

function recordsFromCsv(text: string) {
  return rowsToRecords(parseCsv(text)).map(normalizeRecord);
}

function recordsFromXml(xml: string) {
  const records: Record<string, string>[] = [];
  collectXmlRows(xml, records);
  if (records.length === 0) throw new Error("The Scoop price list has no product rows.");
  return records;
}

function collectXmlRows(xml: string, records: Record<string, string>[]) {
  for (const match of xml.matchAll(/<([A-Za-z_][\w:.-]*)(\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
    const inner = match[3] ?? "";
    if (!hasChildElement(inner)) continue;
    if (onlyLeafChildren(inner)) {
      const record = normalizeRecord({ ...attributesOf(match[2] ?? ""), ...leaves(inner) });
      if (record.sku) records.push(record);
      continue;
    }
    collectXmlRows(inner, records);
  }
}

function hasChildElement(inner: string) {
  return /<[A-Za-z_]/.test(inner);
}

function onlyLeafChildren(inner: string) {
  const children = [...inner.matchAll(/<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)];
  return children.length > 0 && children.every((child) => !/<[A-Za-z_]/.test(child[2] ?? ""));
}

function leaves(inner: string) {
  const record: Record<string, string> = {};
  for (const match of inner.matchAll(/<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    if (/<[A-Za-z_]/.test(match[2] ?? "")) continue;
    const key = normalizeKey(localName(match[1] ?? ""));
    const content = decodeXml(match[2] ?? "").replace(/\s+/g, " ").trim();
    if (key && content && !record[key]) record[key] = content;
  }
  return record;
}

function attributesOf(opening: string) {
  const record: Record<string, string> = {};
  for (const match of opening.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
    const key = normalizeKey(localName(match[1] ?? ""));
    const value = decodeXml(match[2] ?? "").trim();
    if (key && value) record[key] = value;
  }
  return record;
}

function normalizeRecord(record: Record<string, string>) {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const name = normalizeKey(key);
    if (name && value.trim() && !normalized[name]) normalized[name] = value.trim();
  }
  return normalized;
}

function offerFromScoop(record: Record<string, string>): SupplierOffer | null {
  const supplierSku = clip(record.sku ?? "", 80);
  if (!supplierSku) return null;
  const dealer = record.dealerprice ?? "";
  const costCents = dealer ? scoopMoney(dealer) : null;
  if (dealer && costCents === null) return null;
  const stockQty = scoopStock(record);
  if (stockQty === undefined) return null;
  return {
    supplierSku,
    manufacturerPartNumber: "",
    name: clip(record.description ?? "", 160),
    brand: clip(record.manufacturer ?? "", 80),
    costCents,
    stockQty,
    description: clip(record.description ?? "", 4000),
    specifications: "",
    imageUrls: imageUrl(record.imageurl ?? ""),
    category: "",
    leadTimeDays: null,
    matchSkus: [supplierSku],
  };
}

function scoopStock(record: Record<string, string>) {
  if (record.totalstock) {
    const total = whole(record.totalstock);
    return total;
  }
  const branches = BRANCHES.map((name) => record[name]).filter((value) => value);
  if (branches.length === 0) return null;
  let total = 0;
  for (const branch of branches) {
    const qty = whole(branch);
    if (qty === null) return undefined;
    total += qty;
  }
  return total > 1_000_000 ? null : total;
}

function scoopMoney(value: string) {
  let raw = value.trim().replace(/zar/gi, "").replace(/^r/i, "").replace(/\s/g, "");
  if (!raw) return null;
  if (raw.includes(".") && raw.includes(",")) raw = raw.replace(/,/g, "");
  else if (/^\d{1,3}(,\d{3})+$/.test(raw)) raw = raw.replace(/,/g, "");
  else raw = raw.replace(",", ".");
  return parseMoneyToCents(raw);
}

function whole(value: string) {
  const parsed = Number(value.replace(/,/g, "").trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) return null;
  return Math.floor(parsed);
}

function imageUrl(value: string) {
  if (!value) return [];
  try {
    return [assertPublicHttpsUrl(value).href];
  } catch {
    return [];
  }
}

function collect(parsed: Array<SupplierOffer | null>): ParsedSupplierFeed {
  const byKey = new Map<string, SupplierOffer>();
  let skipped = 0;
  for (const offer of parsed) {
    if (!offer) {
      skipped += 1;
      continue;
    }
    byKey.set(offer.supplierSku.toLowerCase(), offer);
  }
  const offers = [...byKey.values()].slice(0, 5000);
  skipped += Math.max(0, byKey.size - offers.length);
  return { offers, skipped, error: null, costsAreExclusive: true };
}

function failed(error: string): ParsedSupplierFeed {
  return { offers: [], skipped: 0, error, costsAreExclusive: true };
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function localName(tag: string) {
  const parts = tag.split(":");
  return parts[parts.length - 1] ?? tag;
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function clip(value: string, max: number) {
  return value.slice(0, max);
}
