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
    const text = textWithColumns(content.items);
    pages.push({ page: pageNumber, text });
    if (pageIsScanned(text)) warnings.push(`Page ${pageNumber} of ${filename} has no readable text.`);
  }
  return { pages, warnings };
}

export async function renderScannedPdfPages(bytes: Buffer, pageNumbers: number[]) {
  if (pageNumbers.length === 0) return [];
  let createCanvas: ((width: number, height: number) => { getContext: (kind: "2d") => unknown; toBuffer: (type: "image/png") => Buffer }) | null = null;
  try {
    const canvas = await import("@napi-rs/canvas");
    createCanvas = canvas.createCanvas;
  } catch {
    return [];
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(import.meta.url);
  const fontDir = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep;
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, standardFontDataUrl: pathToFileURL(fontDir).href, disableWorker: true } as Parameters<typeof pdfjs.getDocument>[0]).promise;
  const images: Array<{ page: number; png: Buffer }> = [];
  for (const pageNumber of pageNumbers.slice(0, 8)) {
    try {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.25 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvasContext: context, viewport } as unknown as Parameters<typeof page.render>[0]).promise;
      const png = canvas.toBuffer("image/png");
      if (png.length > 0) images.push({ page: pageNumber, png });
    } catch {
      return images;
    }
  }
  return images;
}

function textWithColumns(items: unknown[]) {
  const positioned = items.flatMap((item) => {
    if (!item || typeof item !== "object" || !("str" in item) || typeof item.str !== "string" || !item.str.trim()) return [];
    const transform = "transform" in item && Array.isArray(item.transform) ? item.transform : [];
    const x = typeof transform[4] === "number" ? transform[4] : 0;
    const y = typeof transform[5] === "number" ? transform[5] : 0;
    const width = "width" in item && typeof item.width === "number" ? item.width : 0;
    return [{ str: item.str, x, y, width }];
  });
  const rows: Array<typeof positioned> = [];
  for (const item of [...positioned].sort((left, right) => right.y - left.y || left.x - right.x)) {
    const row = rows.find((entry) => Math.abs((entry[0]?.y ?? 0) - item.y) <= 2);
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) => {
    const ordered = [...row].sort((left, right) => left.x - right.x);
    const cells: string[] = [];
    let current = "";
    let end = 0;
    for (const cell of ordered) {
      if (current && cell.x - end > 12) {
        cells.push(current.trim());
        current = cell.str;
      } else current = `${current} ${cell.str}`.trim();
      end = cell.x + Math.max(cell.width, cell.str.length * 3);
    }
    if (current.trim()) cells.push(current.trim());
    return cells.join("\t");
  }).join("\n");
}

function cellText(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text;
  return "";
}
