import { readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { moneyLabel, VAT_RATE, type QuotationDocument } from "./quotation-document";

type Pdf = InstanceType<typeof PDFDocument>;

const NAVY = "#12315C";
const BLUE = "#1D4E89";
const MUTED = "#4B5563";

export function renderQuotationPdf(document: QuotationDocument, logo?: Buffer) {
  const pdf = new PDFDocument({ size: "A4", margin: 40, compress: false });
  const chunks: Buffer[] = [];
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });
  drawHeader(pdf, document, logo ?? readLogo());
  drawParties(pdf, document);
  drawSchedule(pdf, document);
  drawTotals(pdf, document);
  drawTerms(pdf, document);
  if (document.banking) drawBanking(pdf, document);
  if (document.mode === "FORMAL") drawCompliance(pdf, document);
  drawFooter(pdf, document);
  pdf.end();
  return done;
}

function readLogo() {
  try {
    return readFileSync(path.join(process.cwd(), "public", "brand", "urban-focus-logo.png"));
  } catch {
    return null;
  }
}

function drawHeader(pdf: Pdf, document: QuotationDocument, logo: Buffer | null) {
  if (logo) pdf.image(logo, 40, 32, { fit: [210, 40] });
  pdf.fillColor(NAVY).font("Helvetica-Bold").fontSize(16).text("QUOTATION", 280, 32, { width: 275, align: "right" });
  pdf.font("Helvetica").fontSize(9).fillColor(MUTED);
  const facts = [
    `Quotation No: ${document.numberLabel}`,
    `Date: ${document.issuedLabel}`,
    `Valid Until: ${document.validUntilLabel}`,
  ];
  facts.forEach((fact, index) => pdf.text(fact, 280, 54 + index * 12, { width: 275, align: "right" }));
  pdf.moveTo(40, 96).lineTo(555, 96).lineWidth(1.5).strokeColor(BLUE).stroke();
  pdf.y = 108;
}

function drawParties(pdf: Pdf, document: QuotationDocument) {
  const top = pdf.y;
  pdf.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text("PREPARED FOR", 40, top);
  pdf.font("Helvetica").fontSize(9).fillColor("#111827");
  const prepared = [document.customerCompany, document.contactName, document.email, document.customerPhone];
  writeLines(pdf, 40, top + 16, 250, prepared);
  pdf.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text("SUPPLIER", 320, top);
  pdf.font("Helvetica").fontSize(9).fillColor("#111827");
  const supplier = [
    document.company.legalName,
    ...document.company.addressLines,
    document.company.phone,
    document.company.email,
    document.company.website,
    document.company.showVatNumber ? `VAT ${document.company.vatNumber}` : "",
  ];
  writeLines(pdf, 320, top + 16, 230, supplier);
  pdf.y = top + 16 + Math.max(prepared.filter(Boolean).length, supplier.filter(Boolean).length) * 12 + 6;
  if (document.customerReference) {
    pdf.font("Helvetica").fontSize(9).fillColor("#111827").text(`Customer RFQ / Reference: ${document.customerReference}`, 40, pdf.y, { width: 515 });
    pdf.moveDown(0.4);
  }
}

function drawSchedule(pdf: Pdf, document: QuotationDocument) {
  ensureSpace(pdf, document, 80);
  const columns = [40, 64, 312, 354, 456];
  const widths = [22, 242, 38, 98, 99];
  drawRow(pdf, columns, widths, ["#", "DESCRIPTION", "QTY", "UNIT PRICE EXCL. VAT", "TOTAL EXCL. VAT"], true);
  document.lines.forEach((line, index) => {
    const body = [line.description, line.configuration, line.identity].filter(Boolean).join("\n");
    pdf.font("Helvetica").fontSize(8);
    const height = Math.max(36, pdf.heightOfString(body, { width: widths[1] - 8 }) + 12);
    ensureSpace(pdf, document, height + 8);
    const y = pdf.y;
    pdf.rect(40, y, 515, height).fillColor(index % 2 === 0 ? "#F7FAFC" : "#FFFFFF").fill();
    pdf.fillColor("#111827").font("Helvetica").fontSize(8);
    pdf.text(line.scheduleNumber || String(index + 1), columns[0] + 4, y + 6, { width: widths[0] });
    pdf.text(body, columns[1] + 4, y + 6, { width: widths[1] - 8 });
    pdf.text(String(line.quantity), columns[2] + 4, y + 6, { width: widths[2] - 8, align: "right" });
    pdf.text(moneyLabel(line.unitPriceCents), columns[3] + 4, y + 6, { width: widths[3] - 8, align: "right" });
    pdf.text(moneyLabel(line.lineTotalCents), columns[4] + 4, y + 6, { width: widths[4] - 8, align: "right" });
    pdf.y = y + height;
  });
}

function drawTotals(pdf: Pdf, document: QuotationDocument) {
  if (document.alternatives) {
    drawAlternativeTotals(pdf, document);
    return;
  }
  ensureSpace(pdf, document, 62);
  const rows = [
    ["Subtotal Excl. VAT", moneyLabel(document.subtotalExclCents)],
    [`VAT @ ${VAT_RATE}%`, moneyLabel(document.vatCents)],
    ["TOTAL INCL. VAT", moneyLabel(document.totalInclCents)],
  ];
  for (const [index, row] of rows.entries()) {
    const y = pdf.y + 2;
    const total = index === rows.length - 1;
    pdf.font(total ? "Helvetica-Bold" : "Helvetica").fontSize(total ? 12 : 9).fillColor(NAVY);
    pdf.text(row[0], 300, y, { width: 140, lineBreak: false });
    pdf.text(row[1], 440, y, { width: 115, align: "right", lineBreak: false });
    pdf.y = y + (total ? 18 : 14);
  }
  pdf.moveDown(0.3);
}

function drawAlternativeTotals(pdf: Pdf, document: QuotationDocument) {
  ensureSpace(pdf, document, 36 + document.lines.length * 46);
  pdf.font("Helvetica").fontSize(8).fillColor("#111827").text("These options are alternatives. Choose one. The amounts below are not added together.", 40, pdf.y, { width: 515 });
  pdf.moveDown(0.4);
  for (const line of document.lines) {
    const label = (line.description.split("\n")[0] ?? "Option").replace(/:.*/, "").trim();
    const vat = Math.round((line.lineTotalCents * VAT_RATE) / 100);
    const rows = [
      [`${label} excl. VAT`, moneyLabel(line.lineTotalCents)],
      [`VAT @ ${VAT_RATE}%`, moneyLabel(vat)],
      [`${label} INCL. VAT`, moneyLabel(line.lineTotalCents + vat)],
    ];
    for (const [index, row] of rows.entries()) {
      const y = pdf.y + 2;
      const total = index === rows.length - 1;
      pdf.font(total ? "Helvetica-Bold" : "Helvetica").fontSize(total ? 11 : 9).fillColor(NAVY);
      pdf.text(row[0], 40, y, { width: 360, lineBreak: false });
      pdf.text(row[1], 440, y, { width: 115, align: "right", lineBreak: false });
      pdf.y = y + (total ? 16 : 13);
    }
    pdf.moveDown(0.2);
  }
}

function drawTerms(pdf: Pdf, document: QuotationDocument) {
  ensureSpace(pdf, document, 36);
  pdf.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text("COMMERCIAL TERMS", 40, pdf.y);
  pdf.moveDown(0.2);
  for (const term of document.terms) {
    const line = `${term.label}. ${term.text}`;
    pdf.font("Helvetica").fontSize(8);
    const height = pdf.heightOfString(line, { width: 515 }) + 3;
    ensureSpace(pdf, document, height);
    pdf.fillColor("#111827").text(line, 40, pdf.y, { width: 515 });
    pdf.moveDown(0.1);
  }
}

function drawBanking(pdf: Pdf, document: QuotationDocument) {
  if (!document.banking) return;
  const lines = [
    `Bank: ${document.banking.bankName}`,
    `Account Number: ${document.banking.accountNumber}`,
    `Account Type: ${document.banking.accountType}`,
    `Branch Code: ${document.banking.branchCode}`,
    document.banking.reference ? `Payment Reference: ${document.banking.reference}` : "",
  ].filter(Boolean);
  ensureSpace(pdf, document, 18 + lines.length * 11);
  pdf.moveDown(0.3);
  pdf.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text("BANKING DETAILS", 40, pdf.y);
  pdf.font("Helvetica").fontSize(8).fillColor("#111827");
  for (const line of lines) pdf.text(line, 40, pdf.y, { width: 515 });
}

function drawCompliance(pdf: Pdf, document: QuotationDocument) {
  drawFooter(pdf, document);
  pdf.addPage();
  pdf.fillColor(NAVY).font("Helvetica-Bold").fontSize(13).text("TECHNICAL COMPLIANCE", 40, 40);
  pdf.font("Helvetica").fontSize(8).fillColor(MUTED).text("A status of COMPLIES is shown only where the proposed specification was verified.", 40, 60, { width: 515 });
  pdf.y = 80;
  drawRow(pdf, [40, 180, 340, 470], [130, 150, 120, 85], ["Requirement", "Proposed specification", "Status", ""], true);
  for (const row of document.compliance) {
    const text = `${row.item}\n${row.requirement}`;
    const height = Math.max(32, pdf.heightOfString(text, { width: 130 }) + 10);
    ensureSpace(pdf, document, height);
    const y = pdf.y;
    pdf.font("Helvetica").fontSize(8).fillColor("#111827");
    pdf.text(text, 44, y + 4, { width: 130 });
    pdf.text(row.proposed, 184, y + 4, { width: 146 });
    pdf.font("Helvetica-Bold").fillColor(NAVY).text(row.status, 344, y + 4, { width: 110 });
    pdf.y = y + height;
  }
  if (document.references.length > 0) {
    ensureSpace(pdf, document, 40);
    pdf.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text("MANUFACTURER / DATASHEET REFERENCES", 40, pdf.y + 8);
    pdf.font("Helvetica").fontSize(8).fillColor("#111827");
    for (const reference of document.references) pdf.text(reference, 40, pdf.y, { width: 515 });
  }
}

function drawFooter(pdf: Pdf, document: QuotationDocument) {
  const company = document.company;
  const footer = [company.legalName, company.website].filter(Boolean).join("  ·  ");
  const bottom = pdf.page.margins.bottom;
  pdf.page.margins.bottom = 0;
  pdf.font("Helvetica").fontSize(7).fillColor(MUTED);
  pdf.text(footer, 40, 808, { width: 515, align: "center", lineBreak: false, height: 12 });
  pdf.page.margins.bottom = bottom;
}

function drawRow(pdf: Pdf, columns: number[], widths: number[], labels: string[], header: boolean) {
  const y = pdf.y;
  const height = header ? 26 : 22;
  if (header) pdf.rect(40, y, 515, height).fill(NAVY);
  pdf.fillColor(header ? "#FFFFFF" : "#111827").font("Helvetica-Bold").fontSize(7);
  labels.forEach((label, index) => {
    if (!label) return;
    pdf.text(label, columns[index] + 3, y + 5, { width: widths[index] - 6, height: height - 6, lineBreak: header });
    pdf.y = y;
  });
  pdf.y = y + height;
  pdf.fillColor("#111827");
}

function writeLines(pdf: Pdf, x: number, y: number, width: number, lines: string[]) {
  let cursor = y;
  for (const line of lines) {
    if (!line) continue;
    pdf.text(line, x, cursor, { width, lineBreak: false });
    cursor += 12;
  }
}

function ensureSpace(pdf: Pdf, document: QuotationDocument, height: number) {
  if (pdf.y + height < 760) return;
  drawFooter(pdf, document);
  pdf.addPage();
  pdf.y = 40;
}
