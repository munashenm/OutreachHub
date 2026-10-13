import assert from "node:assert/strict";
import test from "node:test";
import { analyzeInboundEmail } from "./rfq-analyzer";
import { requirementsForSourcing } from "./rfq-requirements";
import { applyModelSelection, assistProductSelection, candidateFromObservation } from "./product-evidence";
import { observeProductPage } from "../external-search";
import { autoRfqRepliesEnabled, determineInitialResponse, memoryProcessingStore, sendResponseOnce } from "../inbound-response";
import { withClientSignature } from "../email-signature";
import { buildQuotationDocument, defaultQuoteCompanySettings, quoteCoverEmail } from "../quotation-document";
import { renderQuotationPdf } from "../quotation-pdf";
import { planSourcing, type SourcingCandidate, type SourcingPools } from "../sourcing";

const margins = { minimumMarginPercent: 20, autoQuoteMarginPercent: 20, autoSendMarginPercent: 25 };
const now = new Date("2026-10-12T12:00:00.000Z");
const LIVE_ADAPTER_URL = "https://www.incredible.co.za/lenovo-usb-c-65w-ac-adapter";

function modelJson(payload: unknown) {
  return new Response(JSON.stringify({ output: [{ content: [{ text: JSON.stringify(payload) }] }] }));
}

function analysisPayload(items: unknown[]) {
  return {
    classification: "RFQ",
    customerIntent: "Quote the requested products",
    items,
    missingInformation: [],
    uncertainties: [],
    sufficientToQuote: true,
    recommendedAction: "QUOTE",
    confidence: 0.95,
    responseDraft: "",
  };
}

function item(overrides: Record<string, unknown>) {
  return {
    quantity: 1,
    category: "",
    brand: "",
    model: "",
    specifications: [],
    mandatorySpecifications: [],
    preferences: [],
    uncertainties: [],
    sku: "",
    mpn: "",
    ...overrides,
  };
}

function feed(overrides: Partial<SourcingCandidate>): SourcingCandidate {
  return {
    sourceKind: "SUPPLIER_FEED",
    sourceName: "Supplier feed",
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
    vatKnown: true,
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

async function preparedPdf(lines: Array<{ description: string; quantity: number; unitPriceCents: number; specifications: string }>) {
  const document = buildQuotationDocument({
    mode: "STANDARD",
    exportQuote: false,
    sequence: 1,
    issuedAt: now,
    validUntil: new Date("2026-10-26T00:00:00.000Z"),
    currency: "ZAR",
    customerCompany: "Northwind",
    contactName: "Amina Naidoo",
    email: "amina@northwind.example",
    customerReference: "RFQ-AI",
    deliveryLocation: "Centurion",
    subject: "Quotation",
    company: defaultQuoteCompanySettings(),
    lines: lines.map((line) => ({
      ...line,
      sku: "",
      modelName: line.description,
      manufacturerPartNumber: "",
      availability: "In stock",
      leadTime: "Ex stock",
      warranty: "12-month warranty",
      requirementText: line.specifications,
      matchGrade: "MEETS_REQUIREMENT",
      costStatus: "VERIFIED",
    })),
    references: [],
  });
  const pdf = await renderQuotationPdf(document);
  const raw = pdf.toString("latin1");
  const decoded = [...raw.matchAll(/<([0-9A-Fa-f]+)>/g)].map((match) => Buffer.from(match[1], "hex").toString("latin1")).join("");
  return { document, text: `${raw}\n${decoded}` };
}

async function liveAdapter() {
  const response = await fetch(LIVE_ADAPTER_URL, { headers: { accept: "text/html", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20_000) });
  assert.equal(response.ok, true);
  const html = await response.text();
  const observed = observeProductPage(html, LIVE_ADAPTER_URL);
  assert.ok(observed.product, observed.reason);
  const product = observed.product;
  assert.equal(product.currency, "ZAR");
  assert.equal(product.listedPriceCents > 0, true);
  assert.match(product.name, /65W/i);
  assert.match(product.availability, /stock/i);
  return candidateFromObservation(product, LIVE_ADAPTER_URL);
}

test("scenario A prices catalogue products from the OpenAI extraction", async () => {
  const email = "Please quote 5 Lenovo ThinkPad E14 laptops with Core i5, 16GB RAM, 512GB SSD and Windows 11 Pro.";
  let called = 0;
  const analysis = await analyzeInboundEmail({ subject: "RFQ", body: email }, {
    apiKey: "test-key",
    fetchImpl: async () => {
      called += 1;
      return modelJson(analysisPayload([
        item({ quantity: 5, category: "Laptop", brand: "Lenovo", model: "ThinkPad E14", specifications: ["Core i5", "16GB RAM", "512GB SSD", "Windows 11 Pro"], mandatorySpecifications: ["16GB RAM", "512GB SSD", "Windows 11 Pro"] }),
      ]));
    },
  });
  assert.equal(called, 1);
  const requirements = requirementsForSourcing(email, analysis);
  assert.equal(requirements[0]?.quantity, 5);
  assert.equal(requirements[0]?.model, "ThinkPad E14");
  assert.equal(requirements[0]?.ramGb, 16);
  const plan = planSourcing({ requirements, pools: { ...emptyPools(), supplierFeeds: [feed({})] }, ...margins, now });
  assert.equal(plan.kind, "QUOTE");
  if (plan.kind !== "QUOTE") return;
  assert.equal(plan.send, true);
  assert.equal(plan.options[0]?.costStatus, "VERIFIED");
  assert.equal(plan.options[0]?.sourceName, "Supplier feed");
  const pdf = await preparedPdf(plan.options.map((option) => ({
    description: option.name,
    quantity: option.quantity,
    unitPriceCents: option.unitPriceCents,
    specifications: option.specifications,
  })));
  assert.equal(pdf.text.includes("QUOTATION"), true);
  assert.equal(pdf.text.includes("ThinkPad E14"), true);
  assert.equal(pdf.document.lines[0]?.quantity, 5);
  const signed = withClientSignature(quoteCoverEmail({ customerName: "Amina Naidoo", quoteNumber: pdf.document.numberLabel, validUntil: new Date("2026-10-26T00:00:00.000Z") }));
  assert.match(signed.body, /sales@urbanfocus.co.za/);
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
  const held = await sendResponseOnce({
    gmailMessageId: "scenario-a",
    threadId: "thread-a",
    response,
    store: memoryProcessingStore(),
    repliesEnabled: autoRfqRepliesEnabled({}),
    send: async () => { throw new Error("Customer email must not be sent."); },
  });
  assert.equal(held.sent, false);
});

test("scenario B uses a live retailer page and does not invent its selling price", async () => {
  const email = "Please quote 1 Lenovo USB-C 65W AC adapter.";
  const live = await liveAdapter();
  const seenQueries: string[] = [];
  const analysis = await analyzeInboundEmail({ subject: "RFQ", body: email }, {
    apiKey: "test-key",
    fetchImpl: async () => modelJson(analysisPayload([
      item({ quantity: 1, category: "Adapter", specifications: ["USB-C", "65W"], mandatorySpecifications: ["65W", "USB-C"] }),
    ])),
  });
  const requirements = requirementsForSourcing(email, analysis);
  assert.equal(requirements[0]?.quantity, 1);
  assert.equal(requirements[0]?.productType, "Adapter");
  let selectionCall = 0;
  const assisted = await assistProductSelection({
    requirements,
    evidence: [],
    searchOnline: async (query) => {
      seenQueries.push(query);
      return [live];
    },
  }, {
    apiKey: "test-key",
    fetchImpl: async () => {
      selectionCall += 1;
      if (selectionCall === 1) return modelJson({ searches: [{ query: "Lenovo USB-C 65W AC adapter" }], selections: [] });
      return modelJson({ searches: [], selections: [{ requirementIndex: 0, evidenceId: "e0", meetsMandatory: true, reason: "The retrieved adapter states 65W and USB-C." }] });
    },
  });
  assert.equal(assisted.ok, true);
  assert.deepEqual(seenQueries, ["Lenovo USB-C 65W AC adapter"]);
  assert.equal(assisted.accepted[0]?.sourceUrl, LIVE_ADAPTER_URL);
  assert.equal(assisted.accepted[0]?.listedPriceCents, live.listedPriceCents);
  assert.equal(assisted.accepted[0]?.vatKnown, false);
  assert.equal(assisted.accepted[0]?.name, live.name);
  const plan = planSourcing({
    requirements,
    pools: { ...emptyPools(), external: assisted.accepted.filter((candidate) => candidate.vatKnown !== false) },
    ...margins,
    now,
  });
  assert.equal(plan.kind, "SOURCING");
  const invented = applyModelSelection(requirements, [live], [{ requirementIndex: 0, evidenceId: "missing", meetsMandatory: true, reason: "Invented product at R1" }]);
  assert.equal(invented.length, 0);
});

test("scenario C prices the stocked product and holds the live online product", async () => {
  const email = "Please quote 3 Lenovo ThinkPad E14 laptops with Core i5, 16GB RAM, 512GB SSD and Windows 11 Pro, and 1 Lenovo USB-C 65W AC adapter.";
  const live = await liveAdapter();
  const analysis = await analyzeInboundEmail({ subject: "RFQ", body: email }, {
    apiKey: "test-key",
    fetchImpl: async () => modelJson(analysisPayload([
      item({ quantity: 3, category: "Laptop", brand: "Lenovo", model: "ThinkPad E14", specifications: ["Core i5", "16GB RAM", "512GB SSD", "Windows 11 Pro"], mandatorySpecifications: ["16GB RAM", "512GB SSD"] }),
      item({ quantity: 1, category: "Adapter", specifications: ["USB-C", "65W"], mandatorySpecifications: ["65W"] }),
    ])),
  });
  const requirements = requirementsForSourcing(email, analysis);
  assert.equal(requirements.find((item) => item.productType === "Laptop")?.quantity, 3);
  assert.equal(requirements.find((item) => item.productType === "Adapter")?.quantity, 1);
  let selectionCall = 0;
  const assisted = await assistProductSelection({
    requirements,
    evidence: [feed({})],
    searchOnline: async () => [live],
  }, {
    apiKey: "test-key",
    fetchImpl: async () => {
      selectionCall += 1;
      if (selectionCall === 1) return modelJson({ searches: [{ query: "Lenovo USB-C 65W AC adapter" }], selections: [] });
      return modelJson({
        searches: [],
        selections: [
          { requirementIndex: 0, evidenceId: "e0", meetsMandatory: true, reason: "Catalogue laptop meets the specification." },
          { requirementIndex: 1, evidenceId: "e1", meetsMandatory: true, reason: "Retrieved adapter matches 65W." },
        ],
      });
    },
  });
  assert.equal(assisted.ok, true);
  const laptop = assisted.accepted.find((candidate) => candidate.sourceKind === "SUPPLIER_FEED");
  const adapter = assisted.accepted.find((candidate) => candidate.sourceKind === "EXTERNAL_SOURCE");
  assert.equal(laptop?.costExVatCents, 800_000);
  assert.equal(adapter?.listedPriceCents, live.listedPriceCents);
  assert.equal(adapter?.vatKnown, false);
  const plan = planSourcing({
    requirements,
    pools: { ...emptyPools(), supplierFeeds: assisted.accepted.filter((candidate) => candidate.vatKnown !== false) },
    ...margins,
    now,
  });
  assert.equal(plan.kind, "QUOTE");
  if (plan.kind !== "QUOTE") return;
  assert.equal(plan.send, false);
  assert.equal(plan.options.some((option) => option.name.includes("ThinkPad")), true);
  assert.equal(plan.options.some((option) => /adapter/i.test(option.name)), false);
  assert.equal(plan.outstanding.some((item) => /adapter/i.test(item.label)), true);
  const pdf = await preparedPdf(plan.options.map((option) => ({
    description: option.name,
    quantity: option.quantity,
    unitPriceCents: option.unitPriceCents,
    specifications: option.specifications,
  })));
  assert.equal(pdf.document.lines[0]?.quantity, 3);
  assert.equal(pdf.text.includes("ThinkPad E14"), true);
  assert.equal(pdf.text.includes(String(live.listedPriceCents)), false);
});

test("a model cannot accept a retrieved product that misses a mandatory specification", () => {
  const [requirement] = requirementsForSourcing("Please quote 2 laptops with 16GB RAM.", null);
  const weak = feed({ specifications: "Core i3, 8GB RAM, 256GB SSD", name: "Small laptop", model: "Small laptop" });
  const accepted = applyModelSelection(
    [{ ...requirement, ramGb: 16, productType: "Laptop", quantity: 2 }],
    [weak],
    [{ requirementIndex: 0, evidenceId: "e0", meetsMandatory: true, reason: "Close enough" }],
  );
  assert.equal(accepted.length, 0);
});
