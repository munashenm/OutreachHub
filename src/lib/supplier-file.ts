import ExcelJS from "exceljs";
import { parseCsv } from "./csv";
import { distributorKey } from "./distributors";
import { isScoopFeedUrl, isScoopPriceList, parseScoopPriceList } from "./scoop";
import { offersFromCsvRecords, readFieldMapping, xmlProductRecords, type SupplierFieldMapping, type SupplierOffer } from "./supplier-connector";

export const MAX_SUPPLIER_FILE_BYTES = 5_000_000;
export const PREVIEW_ROWS = 10;
export const MAX_SUPPLIER_ROWS = 5000;

export const IMPORT_COLUMNS = [
  { key: "sku", label: "Supplier SKU" },
  { key: "name", label: "Product name / description" },
  { key: "brand", label: "Brand" },
  { key: "manufacturerPartNumber", label: "Manufacturer part number" },
  { key: "barcode", label: "Barcode / EAN" },
  { key: "category", label: "Category" },
  { key: "cost", label: "Cost excl VAT" },
  { key: "costInclusive", label: "Cost incl VAT" },
  { key: "stock", label: "Stock quantity" },
  { key: "imageUrls", label: "Image URL" },
  { key: "productUrl", label: "Product URL" },
  { key: "leadTimeDays", label: "Lead time" },
] as const;

export type ImportColumnKey = (typeof IMPORT_COLUMNS)[number]["key"];

const HINTS: Record<ImportColumnKey, string[]> = {
  sku: ["sku", "supplier sku", "supplier_sku", "item code", "code", "product code"],
  name: ["name", "product name", "description", "title"],
  brand: ["brand", "manufacturer"],
  manufacturerPartNumber: ["mpn", "manufacturer part number", "part number", "part_number"],
  barcode: ["barcode", "ean", "gtin", "upc"],
  category: ["category"],
  cost: ["cost excl vat", "cost excl", "dealer price", "cost", "price excl"],
  costInclusive: ["cost incl vat", "cost incl", "price incl", "retail price"],
  stock: ["stock", "qty", "quantity", "available", "total stock"],
  imageUrls: ["image", "image url", "image_url"],
  productUrl: ["product url", "url", "link"],
  leadTimeDays: ["lead time", "lead_time", "lead time days"],
};

export type SupplierIdentity = {
  id: string;
  supplierSku: string;
  manufacturerPartNumber: string;
  barcode: string;
};

export type ImportRejection = {
  row: number;
  reason: string;
  cells: Record<string, string>;
};

export function parserForSupplier(name: string, feedUrl = "") {
  return distributorKey(name) === "scoop" || isScoopFeedUrl(feedUrl) ? "scoop" as const : "generic" as const;
}

export function suggestMapping(headers: string[]): SupplierFieldMapping {
  const mapping: SupplierFieldMapping = {};
  for (const column of IMPORT_COLUMNS) {
    const header = headers.find((item) => HINTS[column.key].includes(item.trim().toLowerCase()));
    if (header) mapping[column.key] = header;
  }
  return mapping;
}

export function findSupplierItem<T extends SupplierIdentity>(items: readonly T[], offer: { supplierSku: string; manufacturerPartNumber: string; barcode?: string }) {
  const sku = offer.supplierSku.trim().toLowerCase();
  const barcode = (offer.barcode ?? "").trim().toLowerCase();
  const part = offer.manufacturerPartNumber.trim().toLowerCase();
  return items.find((item) => sku && item.supplierSku.toLowerCase() === sku)
    ?? items.find((item) => barcode && item.barcode.toLowerCase() === barcode)
    ?? items.find((item) => part && item.manufacturerPartNumber.toLowerCase() === part)
    ?? null;
}

export function previewRows<T>(rows: readonly T[], limit = PREVIEW_ROWS) {
  return rows.slice(0, limit);
}

export function fileFormat(filename: string, sample = "") {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx")) return "xlsx" as const;
  if (lower.endsWith(".xml") || sample.trim().startsWith("<")) return "xml" as const;
  return "csv" as const;
}

export function tableFromCsv(text: string) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  return tableFromRows(rows);
}

export function tableFromXml(text: string) {
  return xmlProductRecords(text);
}

export async function tableFromXlsx(data: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(data) as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [] as string[], records: [] as Record<string, string>[] };
  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    rows.push(values.map((value) => cellText(value)));
  });
  return tableFromRows(rows);
}

export function classifyRecords(records: Record<string, string>[], mapping: SupplierFieldMapping = {}) {
  const offers: SupplierOffer[] = [];
  const rejections: ImportRejection[] = [];
  const limited = records.slice(0, MAX_SUPPLIER_ROWS);
  limited.forEach((record, index) => {
    const parsed = offersFromCsvRecords([record], mapping);
    const offer = parsed.offers[0];
    if (!offer) {
      rejections.push({ row: index + 2, reason: rejectionReason(record, mapping), cells: record });
      return;
    }
    offers.push(offer);
  });
  if (records.length > MAX_SUPPLIER_ROWS) {
    rejections.push({ row: MAX_SUPPLIER_ROWS + 2, reason: `Only the first ${MAX_SUPPLIER_ROWS} rows are imported.`, cells: {} });
  }
  return { offers, rejections };
}

export function rowsForSupplier(name: string, text: string, records: Record<string, string>[], mapping: SupplierFieldMapping = {}) {
  if (parserForSupplier(name) === "scoop" && isScoopPriceList(text)) {
    const parsed = parseScoopPriceList(text);
    if (parsed.error) return { parser: "scoop" as const, offers: [] as SupplierOffer[], rejections: [{ row: 1, reason: parsed.error, cells: {} }], rowsRead: 0 };
    const extra = parsed.skipped > 0 ? [{ row: 0, reason: `${parsed.skipped} Scoop rows had no SKU or a price that could not be read.`, cells: {} }] : [];
    return { parser: "scoop" as const, offers: parsed.offers, rejections: extra, rowsRead: parsed.offers.length + parsed.skipped };
  }
  const classified = classifyRecords(records, mapping);
  return { parser: "generic" as const, ...classified, rowsRead: records.length };
}

export function mappingFromForm(value: unknown) {
  return readFieldMapping(value);
}

export function rejectionsCsv(rejections: ImportRejection[]) {
  const headers = ["row", "reason", ...new Set(rejections.flatMap((item) => Object.keys(item.cells)))];
  const lines = [headers.map(csvCell).join(",")];
  for (const item of rejections) {
    lines.push(headers.map((header) => csvCell(header === "row" ? String(item.row) : header === "reason" ? item.reason : item.cells[header] ?? "")).join(","));
  }
  return lines.join("\r\n");
}

function tableFromRows(rows: string[][]) {
  const [header = [], ...body] = rows;
  const named = header.map((cell, index) => ({ name: cell.trim(), index })).filter((item) => item.name);
  const records = body.filter((row) => row.some((cell) => cell.trim())).map((row) => {
    const record: Record<string, string> = {};
    for (const item of named) record[item.name] = (row[item.index] ?? "").trim();
    return record;
  });
  return { headers: named.map((item) => item.name), records };
}

function rejectionReason(record: Record<string, string>, mapping: SupplierFieldMapping) {
  const sku = mapped(record, mapping.sku, ["sku", "code"]);
  const part = mapped(record, mapping.manufacturerPartNumber, ["mpn", "part number"]);
  if (!sku && !part) return "The row needs a supplier SKU or a manufacturer part number.";
  if (mapping.cost && record[mapping.cost] && !/\d/.test(record[mapping.cost])) return "The cost could not be read.";
  if (mapping.stock && record[mapping.stock] && !/\d/.test(record[mapping.stock])) return "The stock quantity could not be read.";
  return "The row could not be read.";
}

function mapped(record: Record<string, string>, chosen: string | undefined, defaults: string[]) {
  if (chosen && record[chosen]?.trim()) return record[chosen].trim();
  const found = Object.entries(record).find(([key, value]) => defaults.some((name) => name.toLowerCase() === key.toLowerCase()) && value.trim());
  return found?.[1]?.trim() ?? "";
}

function cellText(value: unknown) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text.trim();
  if (typeof value === "object" && "result" in value) return cellText(value.result);
  return String(value).trim();
}

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;
}
