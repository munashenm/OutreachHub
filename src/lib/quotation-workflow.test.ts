import assert from "node:assert/strict";
import test from "node:test";
import { extractRfqRequest } from "./automation";
import { analyseDocumentText, analysisAsRequirementText } from "./document-analysis";
import { withClientSignature } from "./email-signature";
import { parseProductPage } from "./external-search";
import { autoRfqRepliesEnabled, determineInitialResponse, memoryProcessingStore, sendResponseOnce } from "./inbound-response";
import { buildQuotationDocument, defaultQuoteCompanySettings, quoteCoverEmail, quotationEmailSubject, quotationTotals } from "./quotation-document";
import { renderQuotationPdf } from "./quotation-pdf";
import { extractProductRequirements, planSourcing, requirementsFromSources, type SourcingCandidate, type SourcingPools } from "./sourcing";

const margins = { minimumMarginPercent: 20, autoQuoteMarginPercent: 20, autoSendMarginPercent: 25 };
const now = new Date("2026-10-12T12:00:00.000Z");
const issuedAt = new Date("2026-10-12T12:00:00.000Z");
const validUntil = new Date("2026-10-26T00:00:00.000Z");

const LAPTOP_RFQ = `Please quote for 25 laptops and 10 additional laptop power supplies.
Core i5
16GB RAM
512GB SSD
Windows 11 Pro`;

function candidate(overrides: Partial<SourcingCandidate>): SourcingCandidate {
  return {
    sourceKind: "SUPPLIER_FEED",
    sourceName: "Scoop",
    sourceUrl: "https://supplier.example/feed",
    sourceType: "DISTRIBUTOR",
    productId: "prod-laptop",
    name: "Lenovo ThinkPad E14",
    brand: "Lenovo",
    model: "ThinkPad E14",
    sku: "E14-16",
    mpn: "21E3000",
    specifications: "Core i5, 16GB RAM, 512GB SSD, Windows 11 Pro, 14 inch",
    costExVatCents: 800_000,
    listedPriceCents: null,
    vatIncluded: false,
    shippingCents: 0,
    procurementCents: 0,
    importCents: 0,
    riskPercent: 0,
    markupPercent: 40,
    stockQty: 40,
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

test("ordinary wording keeps both quantities and does not treat a charger as a laptop", () => {
  const requirements = extractProductRequirements(LAPTOP_RFQ);
  assert.equal(requirements.length, 2);
  const laptop = requirements.find((item) => item.productType === "Laptop");
  const supply = requirements.find((item) => item.productType === "Power supply");
  assert.equal(laptop?.quantity, 25);
  assert.equal(laptop?.processor, "Core i5");
  assert.equal(laptop?.ramGb, 16);
  assert.equal(laptop?.storageGb, 512);
  assert.equal(laptop?.operatingSystem, "Windows 11 Pro");
  assert.equal(supply?.quantity, 10);
  assert.equal(supply?.processor, "");
  assert.equal(supply?.ramGb, null);
  const stored = extractRfqRequest(LAPTOP_RFQ);
  assert.equal(stored.lines.length, 2);
  assert.deepEqual(stored.lines.map((line) => line.quantity).sort((left, right) => (left ?? 0) - (right ?? 0)), [10, 25]);
});

test("a numbered list is not the quantity, and a table keeps each quantity", () => {
  const numbered = analyseDocumentText({
    filename: "request.docx",
    pages: [{ page: 1, text: "1. 25 laptops, Core i5, 16GB RAM, 512GB SSD, Windows 11 Pro\n2. 10 laptop power supplies" }],
  });
  assert.equal(numbered.items[0]?.lineNumber, "1");
  assert.equal(numbered.items[0]?.quantity, 25);
  assert.equal(numbered.items[1]?.lineNumber, "2");
  assert.equal(numbered.items[1]?.quantity, 10);
  const fromAttachment = requirementsFromSources("Please quote the attached schedule.", analysisAsRequirementText(numbered));
  assert.equal(fromAttachment.find((item) => item.productType === "Laptop")?.quantity, 25);
  assert.equal(fromAttachment.find((item) => item.productType === "Power supply")?.quantity, 10);
  const table = extractProductRequirements("Description | Qty\nLaptop Core i5 16GB RAM 512GB SSD Windows 11 Pro | 25\nLaptop power supply | 10");
  assert.equal(table.find((item) => item.productType === "Laptop")?.quantity, 25);
  assert.equal(table.find((item) => item.productType === "Power supply")?.quantity, 10);
});

test("verified supplier costs become a branded PDF and an unsent email", async () => {
  const requirements = extractProductRequirements(LAPTOP_RFQ);
  const laptop = candidate({});
  const supply = candidate({
    productId: "prod-psu",
    name: "65W USB-C laptop power supply",
    brand: "",
    model: "",
    sku: "PSU-65",
    mpn: "PSU-65",
    specifications: "65W USB-C",
    costExVatCents: 35_000,
    stockQty: 30,
  });
  const plan = planSourcing({
    requirements,
    pools: { ...emptyPools(), supplierFeeds: [laptop, supply] },
    ...margins,
    now,
  });
  assert.equal(plan.kind, "QUOTE");
  if (plan.kind !== "QUOTE") return;
  assert.equal(plan.send, true);
  assert.equal(plan.options.every((option) => option.costStatus === "VERIFIED"), true);
  assert.deepEqual(plan.options.map((option) => option.quantity).sort((left, right) => left - right), [10, 25]);
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
  assert.equal(totals?.vatCents, Math.round(((totals?.subtotalExclCents ?? 0) * 15) / 100));
  const document = buildQuotationDocument({
    mode: "STANDARD",
    exportQuote: false,
    sequence: 1,
    issuedAt,
    validUntil,
    currency: "ZAR",
    customerCompany: "Northwind",
    contactName: "Amina Naidoo",
    email: "amina@northwind.example",
    customerReference: "RFQ-25",
    deliveryLocation: "Centurion",
    subject: "Laptops and power supplies",
    company: defaultQuoteCompanySettings(),
    lines,
    references: [],
  });
  assert.equal(document.lines.length, 2);
  assert.match(document.terms.map((term) => term.text).join(" "), /warranty/i);
  assert.match(document.terms.map((term) => term.text).join(" "), /Delivery charges are excluded/i);
  const pdf = await renderQuotationPdf(document);
  const raw = pdf.toString("latin1");
  const decoded = [...raw.matchAll(/<([0-9A-Fa-f]+)>/g)].map((match) => Buffer.from(match[1], "hex").toString("latin1")).join("");
  const text = `${raw}\n${decoded}`;
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal(document.lines.some((line) => line.quantity === 25), true);
  assert.equal(document.lines.some((line) => line.quantity === 10 && /power supply/i.test(line.description)), true);
  assert.equal(text.includes("QUOTATION"), true);
  assert.equal(text.includes("VAT @ 15%"), true);
  assert.equal(text.includes("power supply"), true);
  const signed = withClientSignature(quoteCoverEmail({ customerName: "Amina Naidoo", quoteNumber: document.numberLabel, validUntil }));
  assert.match(signed.body, /Urban Focus quotation/);
  assert.match(signed.body, /sales@urbanfocus.co.za/);
  assert.equal(quotationEmailSubject(1, issuedAt).includes(document.numberLabel), true);
  const response = determineInitialResponse({
    quotationRequest: true,
    tenderPackage: false,
    planKind: "QUOTE",
    planSend: plan.send,
    planMessage: "",
    salesAction: "AUTO_SEND",
    salesMessage: "",
    catalogueProductNamed: true,
    awaitingQuantity: false,
    documentBlocksAutoSend: false,
    notify: true,
  });
  assert.equal(response.decision, "QUOTE_READY");
  assert.equal(autoRfqRepliesEnabled({}), false);
  const held = await sendResponseOnce({
    gmailMessageId: "gmail-demo",
    threadId: "thread-demo",
    response,
    store: memoryProcessingStore(),
    repliesEnabled: false,
    send: async () => {
      throw new Error("Customer email must not be sent.");
    },
  });
  assert.equal(held.sent, false);
});

test("an indicative public price is prepared for approval and is not a binding quote", () => {
  const [requirement] = extractProductRequirements("Please quote 2 workstations.\nCore i7\n32GB RAM\n1TB SSD\nWindows 11 Pro");
  const html = `<script type="application/ld+json">{"@type":"Product","name":"HP Z2 G9 Workstation","brand":"HP","model":"Z2 G9","sku":"Z2G9","description":"Core i7, 32GB RAM, 1TB SSD, Windows 11 Pro","offers":{"price":"45000.00","priceCurrency":"ZAR","availability":"https://schema.org/InStock","priceSpecification":{"valueAddedTaxIncluded":true}}}</script> 12 in stock`;
  const parsed = parseProductPage(html, "https://www.wootware.co.za/hp-z2");
  assert.equal(parsed.listing?.currency, "ZAR");
  assert.equal(parsed.listing?.listedPriceCents, 4_500_000);
  assert.equal(parsed.reason, "");
  const retail = candidate({
    sourceKind: "EXTERNAL_SOURCE",
    sourceType: "RETAILER",
    sourceName: "wootware.co.za",
    sourceUrl: "https://www.wootware.co.za/hp-z2",
    productId: null,
    name: parsed.listing?.name ?? "",
    brand: parsed.listing?.brand ?? "",
    model: parsed.listing?.model ?? "",
    sku: parsed.listing?.sku ?? "",
    mpn: "",
    specifications: parsed.listing?.specifications ?? "",
    costExVatCents: null,
    listedPriceCents: parsed.listing?.listedPriceCents ?? null,
    vatIncluded: true,
    stockQty: parsed.listing?.stockQty ?? null,
  });
  const plan = planSourcing({
    requirements: requirement ? [requirement] : [],
    pools: { ...emptyPools(), external: [retail] },
    ...margins,
    now,
  });
  assert.equal(plan.kind, "QUOTE");
  if (plan.kind !== "QUOTE") return;
  assert.equal(plan.send, false);
  assert.equal(plan.options[0]?.costStatus, "NEEDS_REVIEW");
  assert.equal(plan.options[0]?.sourceUrl.startsWith("https://"), true);
  const response = determineInitialResponse({
    quotationRequest: true,
    tenderPackage: false,
    planKind: plan.kind,
    planSend: plan.send,
    planMessage: "",
    salesAction: "",
    salesMessage: "",
    catalogueProductNamed: false,
    awaitingQuantity: false,
    documentBlocksAutoSend: false,
    notify: true,
  });
  assert.equal(response.decision, "NO_RESPONSE");
});

test("a missing product or a missing quantity stays internal", () => {
  const requirements = extractProductRequirements(LAPTOP_RFQ);
  const onlyLaptop = planSourcing({
    requirements,
    pools: { ...emptyPools(), supplierFeeds: [candidate({})] },
    ...margins,
    now,
  });
  assert.equal(onlyLaptop.kind, "QUOTE");
  if (onlyLaptop.kind !== "QUOTE") return;
  assert.equal(onlyLaptop.send, false);
  assert.match(onlyLaptop.note, /power supply/i);
  assert.equal(onlyLaptop.options.some((option) => option.name.includes("power supply")), false);
  const unnamed = extractProductRequirements("Please quote the laptops when you can.");
  const held = planSourcing({ requirements: unnamed, pools: emptyPools(), ...margins, now });
  assert.equal(held.kind === "CLARIFICATION" || held.kind === "STAFF_REVIEW" || held.kind === "SOURCING", true);
  const response = determineInitialResponse({
    quotationRequest: true,
    tenderPackage: false,
    planKind: held.kind === "QUOTE" ? "QUOTE" : held.kind,
    planSend: false,
    planMessage: held.kind === "CLARIFICATION" || held.kind === "SOURCING" ? held.message : "",
    salesAction: "",
    salesMessage: "",
    catalogueProductNamed: false,
    awaitingQuantity: held.kind === "STAFF_REVIEW",
    documentBlocksAutoSend: false,
    notify: true,
  });
  assert.equal(response.decision, "NO_RESPONSE");
  assert.equal(response.message, "");
});
