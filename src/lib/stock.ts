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

export function storeRequestShouldRetry(error: unknown) {
  const cause = error && typeof error === "object" ? (error as { cause?: { code?: string; message?: string } }).cause : undefined;
  const text = `${error instanceof Error ? error.message : ""} ${cause?.code ?? ""} ${cause?.message ?? ""}`;
  return /UND_ERR_CONNECT_TIMEOUT|Connect Timeout|fetch failed/i.test(text);
}

export function storePushErrorMessage(error: unknown) {
  if (error && typeof error === "object" && (error as { name?: string }).name === "AppError" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  const cause = error && typeof error === "object" ? (error as { cause?: unknown }).cause : undefined;
  const causeMessage = cause && typeof cause === "object" && typeof (cause as { message?: unknown }).message === "string" ? (cause as { message: string }).message : "";
  const message = error instanceof Error ? `${error.message} ${causeMessage}` : "";
  if (/timeout|fetch failed|UND_ERR_CONNECT/i.test(message)) return "OutreachHub could not reach the Urban Focus website. The connection timed out.";
  return "The store did not accept the catalogue update.";
}

export function sellMarginPercent(costCents: number, sellCents: number) {
  if (!Number.isInteger(costCents) || costCents <= 0 || !Number.isInteger(sellCents) || sellCents <= 0) return null;
  return Math.floor(((sellCents - costCents) * 100) / sellCents);
}

export function priceAllowedByMargin(costCents: number, sellCents: number, minimumMarginPercent: number) {
  if (!Number.isInteger(minimumMarginPercent) || minimumMarginPercent <= 0) return true;
  if (!Number.isInteger(costCents) || costCents <= 0) return true;
  const margin = sellMarginPercent(costCents, sellCents);
  if (margin == null) return false;
  return margin >= minimumMarginPercent;
}

export function quoteMarginBlock(costCents: number | null, sellCents: number, minimumMarginPercent: number) {
  if (costCents == null || priceAllowedByMargin(costCents, sellCents, minimumMarginPercent)) return null;
  const margin = sellMarginPercent(costCents, sellCents);
  const shown = margin == null ? "unknown" : `${margin}%`;
  return `This price is a ${shown} margin. It stays off the quotation until it reaches the ${minimumMarginPercent}% minimum.`;
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
