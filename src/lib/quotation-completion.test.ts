import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import test from "node:test";
import PDFDocument from "pdfkit";
import { Workbook } from "exceljs";
import { analyseDocumentText } from "./document-analysis";
import { readDocumentFile } from "./document-files";
import { withClientSignature } from "./email-signature";
import { autoRfqRepliesEnabled, determineInitialResponse, memoryProcessingStore, sendResponseOnce } from "./inbound-response";
import { buildQuotationDocument, defaultQuoteCompanySettings, quoteCoverEmail, quotationTotals } from "./quotation-document";
import { renderQuotationPdf } from "./quotation-pdf";
import { extractProductRequirements, planSourcing, type SourcingCandidate, type SourcingPools } from "./sourcing";

const margins = { minimumMarginPercent: 20, autoQuoteMarginPercent: 20, autoSendMarginPercent: 25 };
const now = new Date("2026-10-13T06:00:00.000Z");
const issuedAt = new Date("2026-10-13T06:00:00.000Z");
const validUntil = new Date("2026-10-27T00:00:00.000Z");

function candidate(overrides: Partial<SourcingCandidate>): SourcingCandidate {
  return {
    sourceKind: "URBAN_FOCUS_CATALOGUE",
    sourceName: "Urban Focus",
    sourceUrl: "https://catalogue.urbanfocus.example/desk",
    sourceType: "INTERNAL",
    productId: "desk-1400",
    name: "Office desk 1400mm",
    brand: "",
    model: "",
    sku: "DESK-1400",
    mpn: "",
    specifications: "1400mm office desk",
    costExVatCents: 150_000,
    listedPriceCents: null,
    vatIncluded: false,
    shippingCents: 0,
    procurementCents: 0,
    importCents: 0,
    riskPercent: 0,
    markupPercent: 40,
    stockQty: 12,
    stockKnown: true,
    fresh: true,
    checkedAt: now.toISOString(),
    reputable: true,
    ...overrides,
  };
}

function emptyPools(): SourcingPools {
  return { catalogue: [], supplierFeeds: [], supplierApis: [], external: [] };
}

function crc32(data: Buffer) {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function storedZip(files: Record<string, string>) {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const compressed = deflateRawSync(data);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const record = Buffer.concat([local, nameBytes, compressed]);
    locals.push(record);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(crc32(data), 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(nameBytes.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([directory, nameBytes]));
    offset += record.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function wordAttachment(text: string) {
  const paragraph = text.split("\n").map((line) => `<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`).join("");
  return storedZip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraph}</w:body></w:document>`,
  });
}

function pdfAttachment(text: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    document.fontSize(12).text(text);
    document.end();
  });
}

test("excel, word and pdf attachments keep each requested product", async () => {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("RFQ");
  sheet.addRow(["Description", "Qty"]);
  sheet.addRow(["A3 duplex printer, 30 ppm", 3]);
  sheet.addRow(["Office desk, 1400mm", 4]);
  const excel = await readDocumentFile("schedule.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Buffer.from(await workbook.xlsx.writeBuffer()));
  const excelRecord = analyseDocumentText({ filename: "schedule.xlsx", pages: excel.pages });
  assert.match(excelRecord.sourceText, /A3 duplex printer/);
  assert.match(excelRecord.sourceText, /1400mm/);
  const fromExcel = extractProductRequirements(excelRecord.sourceText);
  assert.equal(fromExcel.find((item) => item.productType === "Printer")?.quantity, 3);
  assert.equal(fromExcel.find((item) => item.productType === "Desk")?.quantity, 4);

  const word = await readDocumentFile("request.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", wordAttachment("Please quote 6 office chairs."));
  const fromWord = extractProductRequirements(word.pages.map((page) => page.text).join("\n"));
  assert.equal(fromWord[0]?.productType, "Chair");
  assert.equal(fromWord[0]?.quantity, 6);

  const pdf = await readDocumentFile("request.pdf", "application/pdf", await pdfAttachment("Please quote 2 monitors, 27 inch."));
  const fromPdf = extractProductRequirements(pdf.pages.map((page) => page.text).join("\n"));
  assert.equal(fromPdf.find((item) => item.productType === "Monitor")?.quantity, 2);
  assert.match(fromPdf.find((item) => item.productType === "Monitor")?.requestedText ?? "", /27/);
});

test("catalogue and supplier products are priced together, and an unsourced line is not emailed", async () => {
  const rfq = `Please quote the attached schedule and 6 office chairs.
Also quote 2 barcode scanners.`;
  const attachment = "Description\tQty\nA3 duplex printer, 30 ppm\t3\nOffice desk, 1400mm\t4";
  const requirements = extractProductRequirements(`${rfq}\n${attachment}`);
  const printer = requirements.find((item) => item.productType === "Printer");
  const desk = requirements.find((item) => item.productType === "Desk");
  const chair = requirements.find((item) => item.productType === "Chair");
  assert.equal(printer?.quantity, 3);
  assert.equal(desk?.quantity, 4);
  assert.equal(chair?.quantity, 6);
  assert.equal(requirements.some((item) => /scanner/i.test(item.requestedText)), true);

  const pools = {
    ...emptyPools(),
    catalogue: [
      candidate({}),
      candidate({ productId: "desk-1600", name: "Office desk 1600mm", sku: "DESK-1600", specifications: "1600mm office desk", costExVatCents: 90_000, sourceUrl: "https://catalogue.urbanfocus.example/desk-1600" }),
      candidate({ productId: "chair", name: "Office chair", sku: "CHAIR-1", specifications: "task chair", costExVatCents: 80_000, stockQty: 20, sourceUrl: "https://catalogue.urbanfocus.example/chair" }),
    ],
    supplierFeeds: [
      candidate({
        sourceKind: "SUPPLIER_FEED",
        sourceName: "Rectron",
        sourceUrl: "https://supplier.example/rectron/printer",
        sourceType: "DISTRIBUTOR",
        productId: "printer",
        name: "A3 duplex printer 30 ppm",
        sku: "PRT-30",
        specifications: "A3 duplex printer, 30 ppm",
        costExVatCents: 400_000,
        stockQty: 5,
      }),
    ],
  };
  const plan = planSourcing({ requirements, pools, ...margins, now });
  assert.equal(plan.kind, "QUOTE");
  if (plan.kind !== "QUOTE") return;
  assert.equal(plan.send, false);
  assert.match(plan.note, /scanner/i);
  const printerOption = plan.options.find((option) => /printer/i.test(option.name));
  const deskOption = plan.options.find((option) => /1400mm/.test(option.name));
  const chairOption = plan.options.find((option) => /chair/i.test(option.name));
  assert.equal(printerOption?.sourceName, "Rectron");
  assert.equal(printerOption?.quantity, 3);
  assert.equal(printerOption?.unitPriceCents, 560_000);
  assert.equal(printerOption?.costStatus, "VERIFIED");
  assert.equal(deskOption?.sourceName, "Urban Focus");
  assert.equal(deskOption?.quantity, 4);
  assert.equal(deskOption?.unitPriceCents, 210_000);
  assert.equal(plan.options.some((option) => /1600mm/.test(option.name)), false);
  assert.equal(chairOption?.quantity, 6);
  assert.equal(chairOption?.unitPriceCents, 112_000);
  assert.equal(plan.options.some((option) => /scanner/i.test(option.name)), false);

  const lines = plan.options.map((option) => ({
    description: option.name,
    quantity: option.quantity,
    unitPriceCents: option.unitPriceCents,
    specifications: option.specifications,
    sku: "",
    modelName: option.name,
    manufacturerPartNumber: "",
    availability: `${option.stockQty} available`,
    leadTime: "Ex stock",
    warranty: "12-month warranty",
    requirementText: option.specifications,
    matchGrade: option.match,
    costStatus: option.costStatus,
  }));
  const totals = quotationTotals(lines);
  const subtotal = (560_000 * 3) + (210_000 * 4) + (112_000 * 6);
  assert.equal(totals?.subtotalExclCents, subtotal);
  assert.equal(totals?.vatCents, Math.round((subtotal * 15) / 100));
  const document = buildQuotationDocument({
    mode: "STANDARD",
    exportQuote: false,
    sequence: 2,
    issuedAt,
    validUntil,
    currency: "ZAR",
    customerCompany: "Harbour Office",
    contactName: "Lerato Dlamini",
    email: "lerato@harbour.example",
    customerReference: "OFFICE-14",
    deliveryLocation: "Durban",
    subject: "Printer, desk and chairs",
    company: defaultQuoteCompanySettings(),
    lines,
    references: [],
  });
  const pdf = await renderQuotationPdf(document);
  const decoded = [...pdf.toString("latin1").matchAll(/<([0-9A-Fa-f]+)>/g)].map((match) => Buffer.from(match[1], "hex").toString("latin1")).join("");
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal(decoded.includes("QUOTATION"), true);
  assert.equal(decoded.includes("printer"), true);
  assert.equal(decoded.includes("1400mm"), true);
  assert.equal(decoded.includes("chair"), true);
  assert.equal(decoded.toLowerCase().includes("scanner"), false);
  const signed = withClientSignature(quoteCoverEmail({ customerName: "Lerato Dlamini", quoteNumber: document.numberLabel, validUntil }));
  assert.match(signed.body, /Urban Focus quotation/);
  assert.match(signed.body, /sales@urbanfocus.co.za/);
  const response = determineInitialResponse({
    quotationRequest: true,
    tenderPackage: false,
    planKind: plan.kind,
    planSend: plan.send,
    planMessage: "",
    salesAction: "AUTO_SEND",
    salesMessage: "",
    catalogueProductNamed: true,
    awaitingQuantity: false,
    documentBlocksAutoSend: false,
    notify: true,
  });
  assert.equal(response.decision, "NO_RESPONSE");
  assert.equal(autoRfqRepliesEnabled({}), false);
  const held = await sendResponseOnce({
    gmailMessageId: "office-rfq",
    threadId: "office-thread",
    response,
    store: memoryProcessingStore(),
    repliesEnabled: false,
    send: async () => {
      throw new Error("Customer email must not be sent.");
    },
  });
  assert.equal(held.sent, false);
});
