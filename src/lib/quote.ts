export function parseMoneyToCents(value: string): number | null {
  const trimmed = value.trim().replaceAll(" ", "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_00) return null;
  return cents;
}

export function parseQuantity(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const quantity = Number(trimmed);
  if (quantity <= 0 || quantity > 100_000) return null;
  return quantity;
}

export function lineTotalCents(quantity: number, unitPriceCents: number): number | null {
  if (quantity <= 0 || !Number.isInteger(unitPriceCents) || unitPriceCents < 0) return null;
  const total = Math.round(quantity * unitPriceCents);
  if (!Number.isSafeInteger(total)) return null;
  return total;
}

export function quoteTotalCents(lines: { quantity: number; unitPriceCents: number }[]): number | null {
  let total = 0;
  for (const line of lines) {
    const amount = lineTotalCents(line.quantity, line.unitPriceCents);
    if (amount === null) return null;
    total += amount;
  }
  return total;
}

import { startOfDayInTimeZone } from "./sending-window";

export const QUOTE_TIME_ZONE = "Africa/Johannesburg";

export function zonedDateLabel(date: Date, timeZone = QUOTE_TIME_ZONE) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatQuoteNumber(sequence: number, issuedAt: Date) {
  const year = zonedDateLabel(issuedAt).slice(0, 4);
  return `Q-${year}-${String(sequence).padStart(4, "0")}`;
}

export function urbanFocusQuoteNumber(sequence: number, issuedAt: Date) {
  const [year, month, day] = zonedDateLabel(issuedAt).split("-");
  return `UF-Q-${year.slice(-2)}${month}${day}-${String(sequence).padStart(4, "0")}`;
}

export function displayedQuoteNumber(sequence: number, issuedAt: Date, storedFilename = "") {
  const stored = storedFilename.trim().replace(/\.pdf$/i, "");
  if (/^UF-Q-\d{8}-\d{4}$/.test(stored)) return stored;
  return urbanFocusQuoteNumber(sequence, issuedAt);
}

export function quoteValidUntil(issuedAt: Date, validDays: number) {
  const [year, month, day] = zonedDateLabel(issuedAt).split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1, day + validDays));
  return startOfDayInTimeZone(new Date(`${target.toISOString().slice(0, 10)}T12:00:00.000Z`), QUOTE_TIME_ZONE);
}

export function formatQuoteDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: QUOTE_TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatCents(cents: number, currency = "ZAR") {
  const whole = Math.floor(Math.abs(cents) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const fraction = String(Math.abs(cents) % 100).padStart(2, "0");
  return `${currency} ${whole}.${fraction}`;
}

export function formatCurrency(amount: number) {
  const sign = amount < 0 ? "-" : "";
  const [whole, fraction] = Math.abs(amount).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}R ${grouped}.${fraction}`;
}

export function snapshotQuoteLine(product: { specifications: string; imageUrls: string[] } | null) {
  return {
    specifications: product?.specifications ?? "",
    imageUrls: [...(product?.imageUrls ?? [])],
  };
}

export function formatQuoteEmail(input: {
  subject: string;
  currency: string;
  lines: { description: string; quantity: number; unitPriceCents: number; specifications?: string; imageUrls?: string[] }[];
  number?: number | null;
  issuedAt?: Date;
  storedFilename?: string;
  validDays?: number;
  validUntil?: Date | null;
  customerName?: string;
  companyName?: string;
  notes?: string;
}) {
  const issuedAt = input.issuedAt ?? new Date();
  const validUntil = input.validUntil ?? quoteValidUntil(issuedAt, input.validDays ?? 14);
  const heading = input.number == null
    ? "Quotation number is assigned when this quote is sent."
    : `Quotation No: ${displayedQuoteNumber(input.number, issuedAt, input.storedFilename ?? "")}`;
  const rows = input.lines.map((line) => {
    const total = lineTotalCents(line.quantity, line.unitPriceCents) ?? 0;
    const parts = [`${line.description} — qty ${line.quantity} — ${formatCents(line.unitPriceCents, input.currency)} — ${formatCents(total, input.currency)}`];
    const specifications = line.specifications?.trim();
    if (specifications) parts.push(specifications);
    if (line.imageUrls && line.imageUrls.length > 0) parts.push(line.imageUrls.join("\n"));
    return parts.join("\n");
  });
  const total = quoteTotalCents(input.lines) ?? 0;
  const body = [
    heading,
    `Issued ${formatQuoteDate(issuedAt)}`,
    `Valid until ${formatQuoteDate(validUntil)}`,
    "",
  ];
  if (input.customerName) body.push(`Customer: ${input.customerName}`);
  if (input.companyName) body.push(`Company: ${input.companyName}`);
  body.push(`Subject: ${input.subject}`, "", ...rows, "", `Total ${formatCents(total, input.currency)}`, "");
  if (input.notes?.trim()) body.push(input.notes.trim(), "");
  body.push("This is a quotation for the enquiry in this thread. It is not a promotional message.");
  return body.join("\n");
}
