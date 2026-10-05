import PDFDocument from "pdfkit";
import type { StoredDocumentAnalysis } from "./document-analysis";

export function renderTenderPack(input: { subject: string; customer: string; documents: StoredDocumentAnalysis[] }) {
  const pdf = new PDFDocument({ size: "A4", margin: 40, compress: false });
  const chunks: Buffer[] = [];
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });
  pdf.font("Helvetica-Bold").fontSize(16).text("Urban Focus tender pack");
  pdf.moveDown(0.4);
  pdf.font("Helvetica").fontSize(10).text("This pack lists what the customer documents stated. It is not an emailed quotation and it does not add prices that are not in a supplier offer.");
  pdf.moveDown(0.6);
  pdf.font("Helvetica-Bold").text(input.subject || "Quotation request");
  if (input.customer) pdf.font("Helvetica").text(input.customer);
  for (const document of input.documents) {
    pdf.moveDown(0.8);
    pdf.font("Helvetica-Bold").fontSize(12).text(`${document.documentType}${document.referenceNumber ? ` ${document.referenceNumber}` : ""}`);
    pdf.font("Helvetica").fontSize(9);
    const facts = [
      document.closingDate ? `Closing date ${document.closingDate}` : "",
      document.closingTime ? `Closing time ${document.closingTime}` : "",
      document.deliveryLocation ? `Delivery ${document.deliveryLocation}` : "",
      document.vatTreatment ? `VAT ${document.vatTreatment}` : "",
      document.submissionMethod ? `Submission ${document.submissionMethod}` : "",
      `Response ${document.responseMode}`,
    ].filter(Boolean);
    for (const fact of facts) pdf.text(fact);
    pdf.moveDown(0.3);
    for (const item of document.items) {
      pdf.text(`${item.lineNumber || "-"}. ${item.quantity == null ? "" : `${item.quantity} ${item.unit} `.trim() + " "}${item.description}`.replace(/\s+/g, " ").trim());
      pdf.text(`Source ${item.sourceDocument}${item.sourcePage == null ? "" : ` page ${item.sourcePage}`}`, { indent: 12 });
    }
    for (const warning of document.warnings) pdf.text(warning);
  }
  pdf.end();
  return done;
}
