import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { parseCsv } from "./csv";
import { pageIsScanned, supportedAttachment, type DocumentPage } from "./document-analysis";

export async function readDocumentFile(filename: string, contentType: string, bytes: Buffer): Promise<{ pages: DocumentPage[]; warnings: string[] }> {
  const kind = supportedAttachment(filename, contentType);
  if (!kind) return { pages: [], warnings: [`${filename} is not a supported quotation document.`] };
  if (kind === "csv") return { pages: [{ page: 1, text: csvText(bytes.toString("utf8")) }], warnings: [] };
  if (kind === "xlsx") return readXlsx(bytes);
  if (kind === "docx") return readDocx(bytes);
  if (kind === "image") return { pages: [{ page: 1, text: "" }], warnings: [`${filename} is an image. Document vision is required before its text can be read.`] };
  return readPdf(filename, bytes);
}

function csvText(text: string) {
  return parseCsv(text).map((row) => row.join("\t")).join("\n");
}

async function readXlsx(bytes: Buffer) {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  await workbook.xlsx.load(bytes as never);
  const pages: DocumentPage[] = [];
  workbook.eachSheet((sheet, index) => {
    const lines: string[] = [];
    sheet.eachRow((row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1).map((value) => cellText(value)) : [];
      if (values.some(Boolean)) lines.push(values.join("\t"));
    });
    pages.push({ page: index, text: lines.join("\n") });
  });
  return { pages: pages.length > 0 ? pages : [{ page: 1, text: "" }], warnings: [] };
}

async function readDocx(bytes: Buffer) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: bytes });
  return { pages: [{ page: 1, text: result.value ?? "" }], warnings: [] };
}

async function readPdf(filename: string, bytes: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(import.meta.url);
  const fontDir = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep;
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, standardFontDataUrl: pathToFileURL(fontDir).href, disableWorker: true } as Parameters<typeof pdfjs.getDocument>[0]).promise;
  const pages: DocumentPage[] = [];
  const warnings: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " ").trim();
    pages.push({ page: pageNumber, text });
    if (pageIsScanned(text)) warnings.push(`Page ${pageNumber} of ${filename} has no readable text.`);
  }
  return { pages, warnings };
}

function cellText(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text;
  return "";
}
