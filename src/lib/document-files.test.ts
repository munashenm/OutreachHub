import assert from "node:assert/strict";
import test from "node:test";
import PDFDocument from "pdfkit";
import { readDocumentFile, renderScannedPdfPages } from "./document-files";

function pdfBytes(text: string) {
  const pdf = new PDFDocument({ compress: false });
  const chunks: Buffer[] = [];
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });
  pdf.text(text);
  pdf.end();
  return done;
}

test("a pdf page keeps its text and a csv keeps table columns", async () => {
  const pdf = await readDocumentFile("rfq.pdf", "application/pdf", await pdfBytes("Tender No: ABC-1\n2 x laptop"));
  assert.match(pdf.pages[0]?.text ?? "", /Tender No: ABC-1/);
  const csv = await readDocumentFile("lines.csv", "text/csv", Buffer.from("Description,Qty\nLaptop,2\n"));
  assert.match(csv.pages[0]?.text ?? "", /Description\tQty/);
  assert.match(csv.pages[0]?.text ?? "", /Laptop\t2/);
  const table = new PDFDocument({ compress: false });
  const tableChunks: Buffer[] = [];
  table.on("data", (chunk: Buffer) => tableChunks.push(chunk));
  const tableDone = new Promise<Buffer>((resolve, reject) => {
    table.on("end", () => resolve(Buffer.concat(tableChunks)));
    table.on("error", reject);
  });
  table.text("Description", 40, 80);
  table.text("Qty", 320, 80);
  table.text("Laptop", 40, 100);
  table.text("2", 320, 100);
  table.end();
  const tableBytes = await tableDone;
  const read = await readDocumentFile("table.pdf", "application/pdf", tableBytes);
  assert.match(read.pages[0]?.text ?? "", /Description\tQty/);
  assert.match(read.pages[0]?.text ?? "", /Laptop\t2/);
  const rendered = await renderScannedPdfPages(tableBytes, [1]);
  assert.ok(rendered.length === 0 || rendered[0]?.png.length > 8);
});
