import assert from "node:assert/strict";
import test from "node:test";
import { buildRawEmail } from "./email-mime";
import { defaultQuoteCompanySettings, buildQuotationDocument, documentContainsInternalPricing, quoteCoverEmail, quotePdfFilename, quotationEmailSubject, quotationTotals } from "./quotation-document";
import { renderQuotationPdf } from "./quotation-pdf";

const issuedAt = new Date("2026-10-01T10:00:00.000Z");
const validUntil = new Date("2026-10-15T00:00:00.000Z");

const laptop = {
  description: "Lenovo ThinkPad E14",
  quantity: 2,
  unitPriceCents: 1_000_000,
  specifications: "Intel Core i5, 16GB RAM, 512GB SSD, Windows 11 Pro, 14 inch, HDMI",
  sku: "E14-16",
  modelName: "Lenovo ThinkPad E14",
  manufacturerPartNumber: "21E3S12345",
  availability: "6 available",
  leadTime: "5 days",
  warranty: "1 year warranty",
  requirementText: "Core i5, 16GB RAM, 512GB SSD, Windows 11 Pro, 14 inch, HDMI",
  matchGrade: "MEETS_REQUIREMENT",
  costStatus: "VERIFIED",
};

const dock = {
  ...laptop,
  description: "USB-C dock",
  quantity: 1,
  unitPriceCents: 250_000,
  specifications: "USB-C dock, HDMI",
  sku: "DOCK-1",
  modelName: "USB-C dock",
  manufacturerPartNumber: "DK-1",
  requirementText: "USB-C dock with HDMI",
  matchGrade: "",
  costStatus: "",
};

function document(mode: "STANDARD" | "FORMAL", exportQuote = false) {
  return buildQuotationDocument({
    mode,
    exportQuote,
    sequence: 2,
    issuedAt,
    validUntil,
    currency: "ZAR",
    customerCompany: "Northwind Traders",
    contactName: "Munashe",
    email: "buyer@example.com",
    customerReference: "RFQ-44",
    deliveryLocation: "Centurion",
    subject: "5 business laptops",
    company: { ...defaultQuoteCompanySettings(), showBanking: true, bankName: "Example Bank", accountName: "Urban Focus", accountNumber: "1234567890", branchCode: "051001" },
    lines: [laptop, dock],
    references: ["https://www.lenovo.com/datasheet", "https://supplier.example/buy"],
    blockedReferenceUrls: ["https://supplier.example/buy"],
  });
}

test("prices a two-line quotation from the snapshot and keeps supplier data out", () => {
  const totals = quotationTotals([
    { quantity: 2, unitPriceCents: 1_000_000 },
    { quantity: 1, unitPriceCents: 250_000 },
  ]);
  assert.deepEqual(totals, { subtotalExclCents: 2_250_000, vatCents: 337_500, totalInclCents: 2_587_500 });
  const standard = document("STANDARD");
  assert.equal(standard.numberLabel, "UF-Q-20261001-0002");
  assert.equal(quotationEmailSubject(2, issuedAt), "Quotation UF-Q-20261001-0002");
  assert.equal(standard.filename, "UF-Q-20261001-0002.pdf");
  assert.equal(standard.filename, quotePdfFilename(2, issuedAt));
  assert.equal(standard.customerCompany, "Northwind Traders");
  assert.equal(standard.lines.length, 2);
  assert.equal(standard.subtotalExclCents, 2_250_000);
  assert.equal(standard.vatCents, 337_500);
  assert.equal(standard.totalInclCents, 2_587_500);
  assert.equal(standard.banking?.reference, "UF-Q-20261001-0002");
  assert.equal(standard.availability, "Subject to stock at time of order.");
  assert.match(standard.terms.map((term) => term.text).join(" "), /minimum 12-month warranty/);
  assert.equal(standard.terms.some((term) => term.label === "Returns & Exchanges"), true);
  assert.equal(standard.numberLabel.includes("Draft"), false);
  assert.equal(standard.compliance.length, 0);
  assert.equal(standard.terms.some((term) => /prepared for export/i.test(term.text)), false);
  assert.equal(documentContainsInternalPricing(standard), false);
  assert.match(quoteCoverEmail({ customerName: "Munashe", quoteNumber: standard.numberLabel, validUntil }), /Please find attached Urban Focus quotation UF-Q-20261001-0002/);
});

test("formal mode records a deviation and omits an internal source URL", () => {
  const formal = document("FORMAL");
  assert.equal(formal.references.length, 1);
  assert.equal(formal.references[0], "https://www.lenovo.com/datasheet");
  assert.equal(formal.compliance.some((row) => row.status === "COMPLIES"), true);
  const low = buildQuotationDocument({
    mode: "FORMAL",
    exportQuote: false,
    sequence: 2,
    issuedAt,
    validUntil,
    currency: "ZAR",
    customerCompany: "Northwind Traders",
    contactName: "Munashe",
    email: "buyer@example.com",
    customerReference: "",
    deliveryLocation: "",
    subject: "Laptops",
    company: defaultQuoteCompanySettings(),
    lines: [{ ...laptop, specifications: "Intel Core i5, 8GB RAM, 512GB SSD, Windows 11 Pro, 14 inch" }],
    references: [],
  });
  assert.equal(low.compliance.some((row) => row.requirement.includes("RAM") && row.status === "DEVIATION"), true);
  const exportQuote = buildQuotationDocument({
    ...{
      mode: "STANDARD" as const,
      exportQuote: true,
      sequence: 2,
      issuedAt,
      validUntil,
      currency: "ZAR",
      customerCompany: "Northwind Traders",
      contactName: "Munashe",
      email: "buyer@example.com",
      customerReference: "",
      deliveryLocation: "",
      subject: "Export laptops",
      company: defaultQuoteCompanySettings(),
      lines: [laptop],
      references: [],
    },
  });
  assert.match(exportQuote.terms.map((term) => term.text).join(" "), /prepared for export/i);
});

test("renders a branded PDF and a formal second page", async () => {
  const standardPdf = await renderQuotationPdf(document("STANDARD"));
  const text = pdfWords(standardPdf);
  assert.equal(standardPdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal(text.includes("FORMAL QUOTATION"), true);
  assert.equal(text.includes("PREPARED FOR"), true);
  assert.equal(text.includes("Northwind Traders"), true);
  assert.equal(text.includes("Quotation No: UF-Q-20261001-0002"), true);
  assert.equal(text.includes("Currency"), false);
  assert.equal(text.includes("Draft"), false);
  assert.equal(text.includes("Payment Reference: UF-Q-20261001-0002"), true);
  assert.equal(text.includes("Thank you for the opportunity to quote."), true);
  assert.equal(text.includes("Returns & Exchanges"), true);
  assert.equal(text.includes("minimum 12-month warranty"), true);
  assert.equal(text.includes("Subject to stock at time of order."), true);
  assert.equal(text.includes("Subtotal excl VAT"), true);
  assert.equal(text.includes("VAT @ 15%"), true);
  assert.equal(text.includes("TOTAL INCL VAT"), true);
  assert.equal(text.includes("COMMERCIAL TERMS"), true);
  assert.equal(standardPdf.toString("latin1").includes("/Subtype /Image"), true);
  assert.equal(/markup|supplier cost/.test(text), false);
  assert.ok(pageCount(standardPdf) >= 1);
  const formalPdf = await renderQuotationPdf(document("FORMAL"));
  const formalText = pdfWords(formalPdf);
  assert.equal(formalText.includes("TECHNICAL COMPLIANCE"), true);
  assert.equal(formalText.includes("COMPLIES"), true);
  assert.ok(pageCount(formalPdf) >= 2);
});

function pdfWords(buffer: Buffer) {
  const raw = buffer.toString("latin1");
  const hex = [...raw.matchAll(/<([0-9A-Fa-f]+)>/g)].map((match) => Buffer.from(match[1], "hex").toString("latin1"));
  return hex.join("");
}

function pageCount(buffer: Buffer) {
  return buffer.toString("latin1").match(/\/Type \/Page(?!s)/g)?.length ?? 0;
}

test("attaches the quotation PDF to the Gmail reply", () => {
  const raw = Buffer.from(buildRawEmail({
    from: "sales@urbanfocus.co.za",
    to: "buyer@example.com",
    subject: "Quotation UF-Q-20261001-0002",
    body: quoteCoverEmail({ customerName: "Munashe", quoteNumber: "UF-Q-20261001-0002", validUntil }),
    inReplyTo: "<original@mail.gmail.com>",
    attachments: [{ filename: "UF-Q-20261001-0002.pdf", contentType: "application/pdf", data: Buffer.from("%PDF-1.4") }],
  }), "base64url").toString("utf8");
  assert.match(raw, /In-Reply-To: <original@mail.gmail.com>/);
  const subjectHeader = raw.match(/Subject: (.+)/)?.[1] ?? "";
  const subject = subjectHeader.startsWith("=?UTF-8?B?")
    ? Buffer.from(subjectHeader.replace(/=\?UTF-8\?B\?|\?=/g, ""), "base64").toString("utf8")
    : subjectHeader;
  assert.equal(subject, "Quotation UF-Q-20261001-0002");
  assert.match(raw, /filename="UF-Q-20261001-0002.pdf"/);
  assert.match(raw, /application\/pdf/);
  assert.match(raw, /Good day Munashe,/);
  assert.equal(raw.includes("markup"), false);
});
