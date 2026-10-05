import assert from "node:assert/strict";
import test from "node:test";
import {
  analyseDocumentText,
  analysisAsRequirementText,
  applyAnalysisEdit,
  shareDocumentContext,
  classifyDocument,
  decideResponseMode,
  groupAnalysisKey,
  matchRequestedSpecification,
  pageIsScanned,
  quoteCompletionBlock,
  readVatTreatment,
  requiresPhysicalSubmission,
  supportedAttachment,
} from "./document-analysis";
import type { SourcingCandidate } from "./sourcing";

const candidate = (overrides: Partial<SourcingCandidate>): SourcingCandidate => ({
  sourceKind: "SUPPLIER_FEED",
  sourceName: "Scoop",
  sourceUrl: "",
  sourceType: "DISTRIBUTOR",
  productId: "prod",
  name: "Lenovo ThinkPad E14",
  brand: "Lenovo",
  model: "ThinkPad E14",
  sku: "E14",
  mpn: "E14",
  specifications: "Core i5, 16GB RAM, 512GB SSD, Windows 11 Pro, 14 inch",
  costExVatCents: 1000000,
  listedPriceCents: null,
  vatIncluded: false,
  shippingCents: 0,
  procurementCents: 0,
  importCents: 0,
  riskPercent: 0,
  markupPercent: 25,
  stockQty: 4,
  stockKnown: true,
  fresh: true,
  checkedAt: "2026-10-03T12:00:00.000Z",
  reputable: true,
  ...overrides,
});

const tender = `Invitation to tender
Tender No: SCMU12-26/27-0003
Customer: Eastern Cape Provincial Treasury
Closing date: 23 October 2026
Closing time: 11:00
Validity: 90 days
Delivery location: Bhisho
Prices exclude VAT
Submit in a sealed envelope
Description | Qty | Unit
Laptop, Core i5, 16GB RAM, 512GB SSD, Windows 11 Pro, 14 inch | 10 | each
All lines must be priced`;

test("a tender pricing table is read from the document and missing fields stay empty", () => {
  const record = analyseDocumentText({ filename: "ecpt-tender.pdf", pages: [{ page: 2, text: tender }] });
  assert.equal(record.documentType, "TENDER");
  assert.equal(record.referenceNumber, "SCMU12-26/27-0003");
  assert.equal(record.customerName, "Eastern Cape Provincial Treasury");
  assert.equal(record.closingDate, "23 October 2026");
  assert.equal(record.closingTime, "11:00");
  assert.equal(record.vatTreatment, "EXCLUSIVE");
  assert.equal(record.currency, "");
  assert.equal(record.items.length, 1);
  assert.equal(record.items[0]?.quantity, 10);
  assert.equal(record.items[0]?.sourcePage, 2);
  assert.equal(record.items[0]?.sourceDocument, "ecpt-tender.pdf");
  assert.equal(record.responseMode, "TENDER_PACKAGE");
  assert.equal(requiresPhysicalSubmission(tender), true);
  assert.match(analysisAsRequirementText(record), /10 x Laptop/);
});

test("a price and a customer are not invented when the document does not state them", () => {
  const record = analyseDocumentText({
    filename: "note.pdf",
    pages: [{ page: 1, text: "Please quote\n2 x Lenovo ThinkPad E14" }],
  });
  assert.equal(record.customerName, "");
  assert.equal(record.currency, "");
  assert.equal(record.vatTreatment, "");
  assert.equal(readVatTreatment("Please quote the laptop"), "");
  assert.equal(record.items[0]?.quantity, 2);
  assert.equal(JSON.stringify(record).includes("40850"), false);
});

test("a scanned page is detected and a readable page is not", () => {
  assert.equal(pageIsScanned("   \n---"), true);
  assert.equal(pageIsScanned("Request for quotation for ten laptops"), false);
  const record = analyseDocumentText({ filename: "scan.pdf", pages: [{ page: 1, text: " " }, { page: 2, text: "Request for quotation\n2 x laptop" }] });
  assert.match(record.warnings.join(" "), /Page 1/);
});

test("document type follows the document, and files are recognised by type", () => {
  assert.equal(classifyDocument({ filename: "po.pdf", text: "Purchase order 100" }), "PURCHASE_ORDER");
  assert.equal(classifyDocument({ filename: "prices.xlsx", text: "Pricing schedule" }), "PRICING_SCHEDULE");
  assert.equal(classifyDocument({ filename: "pricing-schedule.csv", text: "Description Qty" }), "PRICING_SCHEDULE");
  assert.equal(classifyDocument({ filename: "spec.docx", text: "Technical specification" }), "TECHNICAL_SPECIFICATION");
  assert.equal(supportedAttachment("quote.csv", "application/octet-stream"), "csv");
  assert.equal(supportedAttachment("photo.jpg", "image/jpeg"), "image");
  assert.equal(supportedAttachment("notes.txt", "text/plain"), null);
});

test("an exact supplier product matches and a different product does not", () => {
  const record = analyseDocumentText({
    filename: "rfq.pdf",
    pages: [{ page: 1, text: "Please quote\n1. Lenovo ThinkPad E14, Core i5, 16GB RAM, 512GB SSD, Windows 11 Pro, 14 inch" }],
  });
  const item = record.items[0];
  assert.ok(item);
  const matched = matchRequestedSpecification(item, candidate({}));
  assert.equal(matched.match, "MATCH");
  const panel = matchRequestedSpecification(item, candidate({
    name: "Linkbasic 19-inch Rack Mount 1U Blank Panel",
    brand: "",
    model: "",
    sku: "LB",
    specifications: "19 inch",
  }));
  assert.equal(panel.match, "NO MATCH");
});

test("response mode stays on approval unless the request is a simple fully priced match", () => {
  assert.equal(decideResponseMode({
    documentType: "RFQ",
    text: "Please quote by email",
    itemCount: 1,
    matches: ["MATCH"],
    pricedLines: 1,
    lowConfidence: false,
    usesMarketPrice: false,
    substitution: false,
    largeQuotation: false,
    unusualTerms: false,
  }), "AUTO_SEND");
  assert.equal(decideResponseMode({
    documentType: "RFQ",
    text: "Please quote by email",
    itemCount: 1,
    matches: ["MATCH"],
    pricedLines: 1,
    lowConfidence: false,
    usesMarketPrice: true,
    substitution: false,
    largeQuotation: false,
    unusualTerms: false,
  }), "APPROVAL_REQUIRED");
  assert.equal(decideResponseMode({
    documentType: "RFQ",
    text: "Please quote",
    itemCount: 1,
    matches: ["NO MATCH"],
    pricedLines: 0,
    lowConfidence: false,
    usesMarketPrice: false,
    substitution: false,
    largeQuotation: false,
    unusualTerms: false,
  }), "CANNOT_QUOTE");
  assert.equal(quoteCompletionBlock({ requireAllLines: true, requested: ["1", "2"], priced: ["1"], authorisedOverride: false }), "Lines 2 are not priced. The document requires every line to be priced.");
  assert.equal(quoteCompletionBlock({ requireAllLines: true, requested: ["1"], priced: ["1"], authorisedOverride: false }), "");
});

test("related documents share a tender number and a manual edit does not invent a quantity", () => {
  const left = analyseDocumentText({ filename: "a.pdf", pages: [{ page: 1, text: "Tender No: ABC-1\nCustomer: Acme" }] });
  const right = analyseDocumentText({ filename: "b.pdf", pages: [{ page: 1, text: "Reference: ABC-1\nPricing schedule" }] });
  assert.equal(groupAnalysisKey(left), groupAnalysisKey(right));
  const edited = applyAnalysisEdit(left, "items.0.quantity", "several");
  assert.equal(edited.items[0]?.quantity ?? null, null);
  const numbered = applyAnalysisEdit({ ...left, items: [{ ...left.items[0], lineNumber: "1", description: "Laptop", quantity: null, unit: "", requiredBrand: "", requiredModel: "", equivalentAllowed: false, mandatorySpecs: {}, optionalSpecs: {}, accessories: [], warrantyRequirements: "", serviceRequirements: "", sourceDocument: "a.pdf", sourcePage: 1, extractionConfidence: 80, specificationGroup: "" }] }, "items.0.quantity", "4");
  assert.equal(numbered.items[0]?.quantity, 4);
});

test("a pricing schedule inherits a tender number it cites", () => {
  const tender = { ...analyseDocumentText({ filename: "tender.pdf", pages: [{ page: 1, text: "Tender No: ABC-1\nCustomer: Acme\nClosing date: 20 October 2026" }] }), matches: [] };
  const schedule = { ...analyseDocumentText({ filename: "schedule.csv", pages: [{ page: 1, text: "Pricing schedule for ABC-1\nDescription | Qty\nLaptop | 2" }] }), matches: [] };
  const shared = shareDocumentContext([tender, schedule]);
  assert.equal(shared[1]?.referenceNumber, "ABC-1");
  assert.equal(shared[1]?.customerName, "Acme");
  assert.equal(shared[1]?.closingDate, "20 October 2026");
});

test("a missing hard specification is a partial match and unstated fields stay empty", () => {
  const record = analyseDocumentText({
    filename: "rfq.pdf",
    pages: [{ page: 1, text: "Please quote\n1. Lenovo ThinkPad E14, Core i5, 16GB RAM, 512GB SSD, Windows 11 Pro, 14 inch, HDMI, 3 year warranty, tracking software" }],
  });
  const item = record.items[0];
  assert.equal(item?.mandatorySpecs.ports, "HDMI");
  assert.match(item?.mandatorySpecs.warranty ?? "", /3 year warranty/i);
  assert.equal(item?.mandatorySpecs.trackingSoftware, "tracking software");
  assert.equal(item?.mandatorySpecs.lte, undefined);
  const partial = matchRequestedSpecification(item, candidate({ specifications: "Core i5, 16GB RAM, 512GB SSD, Windows 11 Pro, 14 inch, HDMI" }));
  assert.equal(partial.match, "PARTIAL MATCH");
});
