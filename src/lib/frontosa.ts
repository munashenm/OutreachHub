import { parseMoneyToCents } from "./quote";
import type { SupplierOffer } from "./supplier-connector";

const HOST = "live.frontosa.co.za";

export function isFrontosaFeed(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname.toLowerCase() === HOST && /\/json\/stock(?:_info)?\.asp$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function frontosaTokenFromUrl(value: string) {
  try {
    return new URL(value.trim()).searchParams.get("token")?.trim() ?? "";
  } catch {
    return "";
  }
}

export function frontosaFeedUrls(token: string) {
  const catalogue = new URL("https://live.frontosa.co.za/json/stock_info.asp");
  const stock = new URL("https://live.frontosa.co.za/json/stock.asp");
  catalogue.searchParams.set("token", token);
  stock.searchParams.set("token", token);
  return { catalogue: catalogue.href, stock: stock.href };
}

export function redactSecrets(value: string, secret = "") {
  let text = value.replace(/([?&]token=)[^&\s]+/gi, "$1[redacted]");
  if (secret) text = text.split(secret).join("[redacted]");
  return text;
}

type Row = Record<string, unknown>;

export function joinFrontosaFeeds(catalogueText: string, stockText: string): { offers: SupplierOffer[]; skipped: number; error: string | null } {
  const catalogue = parsePayload(catalogueText);
  const stock = parsePayload(stockText);
  if (catalogue.error) return { offers: [], skipped: 0, error: catalogue.error };
  if (stock.error) return { offers: [], skipped: 0, error: stock.error };
  const stockByCode = new Map<string, Row>();
  let skipped = 0;
  for (const row of stock.rows) {
    const code = productCode(row);
    if (!code) {
      skipped += 1;
      continue;
    }
    stockByCode.set(code.toLowerCase(), row);
  }
  const seen = new Set<string>();
  const offers: SupplierOffer[] = [];
  for (const row of catalogue.rows) {
    const code = productCode(row);
    if (!code) {
      skipped += 1;
      continue;
    }
    const key = code.toLowerCase();
    seen.add(key);
    offers.push(toOffer(row, stockByCode.get(key) ?? null));
  }
  for (const [key, row] of stockByCode) {
    if (seen.has(key)) continue;
    offers.push(toOffer(null, row));
  }
  if (offers.length === 0 && (catalogue.rejectedToken || stock.rejectedToken)) {
    return { offers: [], skipped, error: "The Frontosa token was rejected." };
  }
  if (offers.length === 0 && (catalogue.rows.length > 0 || stock.rows.length > 0)) {
    const fields = Object.keys(catalogue.rows[0] ?? stock.rows[0] ?? {}).slice(0, 20).join(", ");
    return { offers: [], skipped, error: `Frontosa items did not include a product code. Fields: ${fields}` };
  }
  return { offers, skipped, error: null };
}

function parsePayload(text: string): { rows: Row[]; rejectedToken: boolean; error: string | null } {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { rows: [], rejectedToken: false, error: "The Frontosa feed was not JSON." };
  }
  const root = isRow(payload) ? payload : {};
  const notice = typeof root.notice === "string" ? root.notice : "";
  const rows = itemsOf(payload);
  return { rows, rejectedToken: /token/i.test(notice) && rows.length === 0, error: null };
}

function itemsOf(payload: unknown): Row[] {
  if (Array.isArray(payload)) return payload.filter(isRow);
  if (!isRow(payload)) return [];
  const items = payload.items ?? payload.products ?? payload.data;
  return Array.isArray(items) ? items.filter(isRow) : [];
}

function isRow(value: unknown): value is Row {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function productCode(row: Row) {
  return text(row, ["code", "product_code", "productcode", "stock_code", "sku", "item_code"]);
}

function text(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function centsFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return parseMoneyToCents(value.toFixed(2));
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/r/gi, "").replace(/\s/g, "").replace(/,(?=\d{3}\b)/g, "");
  const normalized = cleaned.includes(".") ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
  return parseMoneyToCents(normalized);
}

function priceCents(row: Row) {
  for (const key of ["price", "price_ex_vat", "priceExVat", "excl_price", "dealer_price", "cost"]) {
    const cents = centsFrom(row[key]);
    if (cents != null && cents > 0) return cents;
  }
  return null;
}

function imagesOf(row: Row) {
  const value = row.images ?? row.imageUrls ?? row.image ?? row.image_url ?? row.img;
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  const urls: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) continue;
    if (!urls.includes(item.trim())) urls.push(item.trim());
  }
  return urls.slice(0, 8);
}

function stockOf(row: Row | null) {
  if (!row) return { qty: null as number | null, additional: "" };
  const collection = row.branches ?? row.branch_stock ?? row.branchStock;
  let total = 0;
  let found = false;
  const add = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      total += value;
      found = true;
      return;
    }
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
      total += Number(value.trim());
      found = true;
    }
  };
  if (Array.isArray(collection)) {
    for (const branch of collection) {
      if (!isRow(branch)) continue;
      add(branch.qty ?? branch.quantity ?? branch.stock ?? branch.on_hand ?? branch.onHand);
    }
  } else if (isRow(collection)) {
    for (const value of Object.values(collection)) add(value);
  }
  if (!found) add(row.stock ?? row.qty ?? row.quantity ?? row.available ?? row.on_hand);
  const additionalRaw = row.additional_stock ?? row.additionalStock ?? row.additional;
  const additional = typeof additionalRaw === "boolean"
    ? (additionalRaw ? "yes" : "no")
    : typeof additionalRaw === "number" && Number.isFinite(additionalRaw)
      ? String(additionalRaw)
      : typeof additionalRaw === "string"
        ? additionalRaw.trim()
        : "";
  return { qty: found ? total : null, additional };
}

function toOffer(catalogue: Row | null, stock: Row | null): SupplierOffer {
  const row = catalogue ?? stock ?? {};
  const code = productCode(row) || (stock ? productCode(stock) : "");
  const description = text(row, ["description", "desc", "name", "title"]);
  const specifications = text(row, ["specifications", "specs", "specification"]);
  const barcode = text(row, ["barcode", "ean"]);
  const warranty = text(row, ["warranty"]);
  const counted = stockOf(stock);
  const detail = [
    specifications,
    barcode ? `Barcode: ${barcode}` : "",
    warranty ? `Warranty: ${warranty}` : "",
    counted.additional ? `Additional stock: ${counted.additional}` : "",
  ].filter(Boolean).join("\n");
  return {
    supplierSku: code,
    manufacturerPartNumber: barcode,
    name: description || code,
    brand: text(row, ["brand"]),
    costCents: catalogue ? priceCents(catalogue) : null,
    stockQty: counted.qty,
    description,
    specifications: detail,
    imageUrls: catalogue ? imagesOf(catalogue) : [],
    category: text(row, ["category", "cat"]),
    leadTimeDays: null,
    matchSkus: [code, barcode].filter(Boolean),
  };
}
