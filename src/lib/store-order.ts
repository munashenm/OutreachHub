import { parseMoneyToCents } from "./quote";

export type ParsedOrderLine = { sku: string; quantity: number };

export type ParsedStoreOrder = {
  externalId: string;
  number: string;
  status: string;
  email: string;
  customerName: string;
  companyName: string;
  totalCents: number;
  currency: string;
  summary: string;
  placedAt: Date;
  lines: ParsedOrderLine[];
};

const OPEN_ORDER_STATUSES = new Set(["pending", "processing", "on-hold"]);

export function orderReservesStock(status: string) {
  return OPEN_ORDER_STATUSES.has(status);
}

export function parseStoreOrders(body: unknown) {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { orders?: unknown }).orders)
      ? (body as { orders: unknown[] }).orders
      : null;
  if (!list) return { orders: [] as ParsedStoreOrder[], skipped: 0, error: "The store did not return an order list." };
  const orders: ParsedStoreOrder[] = [];
  let skipped = 0;
  for (const entry of list) {
    const order = oneOrder(entry);
    if (!order) skipped += 1;
    else orders.push(order);
  }
  return { orders, skipped, error: null as string | null };
}

function oneOrder(entry: unknown): ParsedStoreOrder | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const externalId = text(record.id);
  const billing = record.billing && typeof record.billing === "object" ? record.billing as Record<string, unknown> : {};
  const email = (text(record.email) || text(billing.email)).toLowerCase();
  const placedAt = new Date(text(record.placedAt || record.date_created_gmt || record.date_created));
  const totalCents = integerCents(record.totalCents) ?? parseMoneyToCents(text(record.total));
  if (!externalId || !email || Number.isNaN(placedAt.getTime()) || totalCents === null) return null;
  const first = text(billing.first_name);
  const last = text(billing.last_name);
  const lines = orderLines(record.lines ?? record.line_items);
  const summary = lines.slice(0, 4).map((line) => `${line.quantity} x ${line.sku}`).join(", ");
  return {
    externalId,
    number: text(record.number) || externalId,
    status: text(record.status) || "unknown",
    email,
    customerName: text(record.customerName) || `${first} ${last}`.trim() || email,
    companyName: text(record.companyName) || text(billing.company),
    totalCents,
    currency: text(record.currency) || "ZAR",
    summary,
    placedAt,
    lines,
  };
}

function orderLines(value: unknown): ParsedOrderLine[] {
  if (!Array.isArray(value)) return [];
  const lines: ParsedOrderLine[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const sku = text(item.sku) || text(item.name);
    const quantity = Number(text(item.quantity) || "1");
    if (!sku || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) continue;
    lines.push({ sku, quantity: Math.ceil(quantity) });
  }
  return lines;
}

function integerCents(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
