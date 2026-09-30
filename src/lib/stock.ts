import { parseMoneyToCents } from "./quote";

export type SupplierStockRow = { sku: string; costCents: number | null; stockQty: number };

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal)$/i;

export function assertPublicHttpsUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter an https address.");
  }
  if (url.protocol !== "https:") throw new Error("The address must start with https://.");
  if (url.username || url.password) throw new Error("Put the API key in the key field, not in the address.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (PRIVATE_HOST.test(host) || host === "::1" || isPrivateIp(host)) {
    throw new Error("Use the supplier or website public address.");
  }
  return url;
}

export function parseProductImageUrls(value: string) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 8) throw new Error("Add up to 8 image addresses.");
  const urls: string[] = [];
  for (const line of lines) {
    const address = assertPublicHttpsUrl(line).href;
    if (!urls.includes(address)) urls.push(address);
  }
  return urls;
}

export function priceAllowedByMargin(costCents: number, sellCents: number, minimumMarginPercent: number) {
  if (!Number.isInteger(minimumMarginPercent) || minimumMarginPercent <= 0) return true;
  if (!Number.isInteger(costCents) || costCents <= 0) return true;
  if (!Number.isInteger(sellCents) || sellCents <= 0) return false;
  const margin = Math.floor(((sellCents - costCents) * 100) / sellCents);
  return margin >= minimumMarginPercent;
}

export function markedUpCents(costCents: number, markupPercent: number) {
  if (!Number.isInteger(costCents) || costCents < 0) return null;
  if (!Number.isInteger(markupPercent) || markupPercent < 0 || markupPercent > 300) return null;
  const price = Math.round((costCents * (100 + markupPercent)) / 100);
  if (!Number.isSafeInteger(price) || price > 100_000_000_00) return null;
  return price;
}

export function stockLevel(quantities: number[]) {
  return quantities.reduce((total, quantity) => total + Math.max(0, Math.floor(quantity) || 0), 0);
}

export function stockLeft(onHand: number, reserved: number) {
  const available = Math.floor(onHand) - Math.ceil(Math.max(0, reserved) || 0);
  return Math.max(0, available);
}

export function isShortStock(onHand: number, reserved: number, supplierTracked: boolean) {
  const holding = Math.max(0, reserved) || 0;
  return (supplierTracked || holding > 0) && stockLeft(onHand, reserved) === 0;
}

export function linesExceedingStock(
  lines: { productId: string | null; quantity: number }[],
  leftByProduct: ReadonlyMap<string, number>,
) {
  const asked = new Map<string, number>();
  for (const line of lines) {
    if (!line.productId || !Number.isFinite(line.quantity) || line.quantity <= 0) continue;
    asked.set(line.productId, (asked.get(line.productId) ?? 0) + line.quantity);
  }
  return [...asked.entries()]
    .filter(([productId, quantity]) => Math.ceil(quantity) > (leftByProduct.get(productId) ?? 0))
    .map(([productId]) => productId);
}

export function parseSupplierStockBody(body: unknown) {
  const source = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)
      ? (body as { items: unknown[] }).items
      : body && typeof body === "object" && Array.isArray((body as { products?: unknown }).products)
        ? (body as { products: unknown[] }).products
        : null;
  if (!source) return { items: [] as SupplierStockRow[], skipped: 0, error: "The feed must be a JSON list, or an object with items." };
  const bySku = new Map<string, SupplierStockRow>();
  let skipped = 0;
  for (const entry of source) {
    const row = stockRow(entry);
    if (!row) {
      skipped += 1;
      continue;
    }
    bySku.set(row.sku.toLowerCase(), row);
  }
  return { items: [...bySku.values()], skipped, error: null as string | null };
}

function stockRow(entry: unknown): SupplierStockRow | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const sku = text(record.sku ?? record.supplierSku ?? record.supplier_sku ?? record.code);
  if (!sku) return null;
  const stockValue = record.stock ?? record.quantity ?? record.qty ?? record.available ?? record.stockQty;
  const stockQty = typeof stockValue === "number" ? stockValue : Number(text(stockValue));
  if (!Number.isFinite(stockQty) || stockQty < 0 || stockQty > 1_000_000) return null;
  const costValue = record.cost ?? record.price ?? record.unitCost ?? record.unit_cost;
  const costCents = costValue == null || costValue === ""
    ? null
    : parseMoneyToCents(typeof costValue === "number" ? costValue.toFixed(2) : text(costValue));
  if (costValue != null && costValue !== "" && costCents === null) return null;
  return { sku, costCents, stockQty: Math.floor(stockQty) };
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function isPrivateIp(host: string) {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}
