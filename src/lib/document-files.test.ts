import assert from "node:assert/strict";
import test from "node:test";
import PDFDocument from "pdfkit";
import { readDocumentFile } from "./document-files";

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
});
