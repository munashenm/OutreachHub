import assert from "node:assert/strict";
import test from "node:test";
import { emptyRequirement, type SourcingCandidate } from "./sourcing";
import {
  buildEnquiryJson,
  composeFollowUp,
  composeSalesReply,
  decideSalesResponse,
  quoteFollowUpAction,
  rankProductMatches,
  funnelRowsFromRfqs,
  salesFunnelMetrics,
  unpricedCatalogueNote,
} from "./sales-response";

function candidate(patch: Partial<SourcingCandidate>): SourcingCandidate {
  return {
    sourceKind: "URBAN_FOCUS_CATALOGUE",
    sourceName: "Urban Focus",
    sourceUrl: "",
    sourceType: "INTERNAL",
    productId: "p1",
    name: "Lenovo ThinkPad E14",
    brand: "Lenovo",
    model: "ThinkPad E14",
    sku: "LNV-E14",
    mpn: "20RA",
    specifications: "Core i5, 16GB RAM, 512GB SSD",
    costExVatCents: 1000000,
    listedPriceCents: null,
    vatIncluded: false,
    shippingCents: 0,
    procurementCents: 0,
    importCents: 0,
    riskPercent: 0,
    markupPercent: 20,
    stockQty: 4,
    stockKnown: true,
    fresh: true,
    checkedAt: null,
    reputable: true,
    ...patch,
  };
}

test("enquiry JSON records the request and does not invent commercial figures", () => {
  const requirement = emptyRequirement("2 x Lenovo ThinkPad E14");
  requirement.quantity = 2;
  requirement.model = "ThinkPad E14";
  const enquiry = buildEnquiryJson({
    intent: "RFQ",
    customerName: "Munashe",
    companyName: "Urban Focus",
    email: "buyer@example.com",
    reference: "RFQ-1",
    requirements: [requirement],
  });
  const encoded = JSON.stringify(enquiry);
  assert.equal(enquiry.requirements[0]?.quantity, 2);
  assert.equal(encoded.includes("unitPrice"), false);
  assert.equal(encoded.includes("margin"), false);
  assert.equal(encoded.includes("vat"), false);
  assert.equal(encoded.includes("stock"), false);
});

test("ranks an exact SKU ahead of a semantic neighbour", () => {
  const requirement = emptyRequirement("2 x cable SKU: RB-WES");
  requirement.sku = "RB-WES";
  requirement.quantity = 2;
  const ranked = rankProductMatches(requirement, [
    candidate({ name: "Wireless access point", sku: "AP-1", model: "", specifications: "ceiling mount radio" }),
    candidate({ name: "0.5M RPSMA cable", sku: "RB-WES", model: "RB-WES" }),
  ]);
  assert.equal(ranked[0]?.sku, "RB-WES");
  assert.equal(ranked[0]?.method, "EXACT");
});

test("asks a clarification when confidence is low and opens sourcing when nothing matches", () => {
  const vague = decideSalesResponse({ vague: true, requestedExact: false, requestedQuantity: 1, matches: [], marginAllowed: true, autoSendAllowed: false });
  assert.equal(vague.action, "CLARIFY");
  assert.match(vague.message, /brand, model or SKU/);
  const missing = decideSalesResponse({ vague: false, requestedExact: true, requestedQuantity: 2, matches: [], marginAllowed: true, autoSendAllowed: false });
  assert.equal(missing.action, "EXTERNAL_TASK");
});

test("offers a verified alternative when the exact product is out of stock", () => {
  const decision = decideSalesResponse({
    vague: false,
    requestedExact: true,
    requestedQuantity: 2,
    marginAllowed: true,
    autoSendAllowed: false,
    matches: [{
      productId: "p2",
      name: "ThinkPad E16",
      sku: "LNV-E16",
      method: "FUZZY",
      similarity: 0.6,
      stockQty: 3,
      unitPriceCents: 1200000,
      marginPercent: 20,
    }],
  });
  assert.equal(decision.action, "ALTERNATIVES");
  assert.match(decision.message, /ZAR 12000.00/);
  assert.match(decision.message, /excluding VAT/);
  assert.match(decision.message, /3 available/);
  assert.equal(decision.message.includes("lead time"), false);
});

test("follow-up waits, sends once, and stops when the customer replies, rejects, or orders", () => {
  const sentAt = new Date("2026-10-01T00:00:00Z");
  const base = { sentAt, followUpCount: 0, followUpLimit: 2, afterDays: 3, customerReplied: false, rejected: false, ordered: false };
  assert.equal(quoteFollowUpAction({ ...base, now: new Date("2026-10-02T00:00:00Z") }), "wait");
  assert.equal(quoteFollowUpAction({ ...base, now: new Date("2026-10-04T00:00:00Z") }), "send");
  assert.equal(quoteFollowUpAction({ ...base, now: new Date("2026-10-04T00:00:00Z"), customerReplied: true }), "stop");
  assert.equal(quoteFollowUpAction({ ...base, now: new Date("2026-10-04T00:00:00Z"), rejected: true }), "stop");
  assert.equal(quoteFollowUpAction({ ...base, now: new Date("2026-10-04T00:00:00Z"), ordered: true }), "stop");
  assert.equal(quoteFollowUpAction({ ...base, now: new Date("2026-10-10T00:00:00Z"), followUpCount: 2 }), "stop");
  assert.match(composeFollowUp({ quoteNumber: "UF2026-14", validUntil: "17 October 2026" }), /UF2026-14/);
});

test("funnel metrics count conversion, value, margin, response time, and lost reasons", () => {
  const metrics = salesFunnelMetrics([
    { stage: "QUOTED", valueCents: 50000, marginPercent: 20, responseMinutes: 30, lostReason: "" },
    { stage: "QUOTED", valueCents: 25000, marginPercent: 10, responseMinutes: 90, lostReason: "" },
    { stage: "ACCEPTED", valueCents: 50000, marginPercent: 20, responseMinutes: null, lostReason: "" },
    { stage: "LOST", valueCents: 25000, marginPercent: null, responseMinutes: null, lostReason: "Price" },
  ]);
  assert.equal(metrics.quoted, 2);
  assert.equal(metrics.accepted, 1);
  assert.equal(metrics.conversionPercent, 50);
  assert.equal(metrics.quotationValueCents, 75000);
  assert.equal(metrics.averageMarginPercent, 17);
  assert.equal(metrics.averageResponseMinutes, 60);
  assert.deepEqual(metrics.lostReasons, [{ reason: "Price", total: 1 }]);
});

test("existing quotation requests appear in the funnel before a quote is sent", () => {
  const metrics = salesFunnelMetrics(funnelRowsFromRfqs([
    { status: "REVIEWING", createdAt: "2026-10-02T04:00:00.000Z", respondedAt: null, lostReason: "", sentQuoteValueCents: 0 },
    { status: "LOST", createdAt: "2026-10-01T04:00:00.000Z", respondedAt: "2026-10-01T05:00:00.000Z", lostReason: "Customer declined", sentQuoteValueCents: 17500 },
  ]));
  assert.equal(metrics.enquiry, 2);
  assert.equal(metrics.rfq, 2);
  assert.equal(metrics.quoted, 1);
  assert.equal(metrics.quotationValueCents, 17500);
  assert.equal(metrics.replied, 1);
  assert.equal(metrics.lost, 1);
  assert.equal(metrics.accepted, 0);
});

test("a reply without a verified price does not state a price", () => {
  const text = composeSalesReply({ action: "PREPARE", customerName: "Ada", lines: [], validUntil: "" });
  assert.match(text, /brand, model or SKU/);
  assert.equal(text.includes("ZAR"), false);
});

test("a website ThinkPad without a supplier cost is named and not priced", () => {
  const requirement = emptyRequirement("2 x Lenovo ThinkPad E14");
  requirement.model = "ThinkPad E14";
  requirement.productType = "Laptop";
  const matches = rankProductMatches(requirement, [candidate({
    name: "Lenovo ThinkPad T14 Gen 6 Intel Core Ultra 7 16GB 512GB Win 11 Pro",
    sku: "21QC000YZA",
    model: "21QC000YZA",
    stockQty: 2,
    stockKnown: true,
    costExVatCents: null,
  })]);
  const note = unpricedCatalogueNote(requirement, matches);
  assert.match(note, /21QC000YZA/);
  assert.match(note, /No supplier cost is on file/);
  assert.equal(note.includes("ZAR"), false);
});

test("an exact website specification is named ahead of a higher one", () => {
  const requirement = emptyRequirement("laptop specification");
  requirement.productType = "Laptop";
  requirement.processor = "Core Ultra 7";
  requirement.ramGb = 16;
  requirement.storageGb = 512;
  requirement.storageType = "SSD";
  requirement.screenInches = 14;
  requirement.operatingSystem = "Windows 11 Pro";
  const matches = rankProductMatches(requirement, [
    candidate({
      name: "ASUS Zenbook Duo Intel Core Ultra 9 16GB 512GB SSD Windows 11 Pro 14 inch",
      sku: "UX8406",
      model: "",
      specifications: "Core Ultra 9, 16GB RAM, 512GB SSD, Windows 11 Pro, 14 inch",
      stockQty: 3,
      costExVatCents: null,
    }),
    candidate({
      name: "Lenovo ThinkPad T14 Gen 6 Intel Core Ultra 7 16GB 512GB Win 11 Pro",
      sku: "21QC000YZA",
      model: "21QC000YZA",
      specifications: "Core Ultra 7, 16GB RAM, 512GB SSD, Windows 11 Pro, 14 inch",
      stockQty: 2,
      costExVatCents: null,
    }),
  ]);
  assert.match(unpricedCatalogueNote(requirement, matches), /21QC000YZA/);
});
