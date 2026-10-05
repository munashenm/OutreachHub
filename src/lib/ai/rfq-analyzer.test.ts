import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  analyzeInboundEmail,
  clarificationFromAnalysis,
  customerDraftIsSafe,
  groundRfqAnalysis,
  parseRfqAnalysis,
  quotationSendPermission,
  rankSuppliedMatches,
} from "./rfq-analyzer";
import { requirementsForSourcing } from "./rfq-requirements";

const source = "Please quote 2 Lenovo ThinkPad E14 laptops with 16GB RAM.";

test("keeps the structured interpretation and drops financial fields", () => {
  const analysis = groundRfqAnalysis(parseRfqAnalysis({
    classification: "RFQ",
    customerIntent: "Wants a quotation",
    items: [{ quantity: 2, category: "laptop", brand: "Lenovo", model: "ThinkPad E14", specifications: ["16GB RAM"], sku: "E14-16", mpn: "", price: 40850, stock: 4 }],
    missingInformation: [],
    sufficientToQuote: true,
    recommendedAction: "QUOTE",
    confidence: 0.94,
    responseDraft: "Good day,\n\nPlease confirm the screen size.",
    vat: 15,
    quotationNumber: "UF-Q-20261005-0001",
  })!, source);
  assert.equal(analysis.classification, "RFQ");
  assert.equal(analysis.items[0]?.quantity, 2);
  assert.equal(analysis.items[0]?.brand, "Lenovo");
  assert.equal(analysis.items[0]?.sku, "");
  assert.equal("price" in analysis, false);
  assert.equal(analysis.confidence, 0.94);
});

test("does not auto-send unless the product, price, and stock are verified and confidence is high", () => {
  const ready = parseRfqAnalysis({
    classification: "RFQ",
    customerIntent: "Quote",
    items: [{ quantity: 2, category: "", brand: "Lenovo", model: "ThinkPad E14", specifications: ["16GB RAM"], sku: "", mpn: "" }],
    missingInformation: [],
    sufficientToQuote: true,
    recommendedAction: "QUOTE",
    confidence: 0.95,
    responseDraft: "",
  });
  assert.equal(quotationSendPermission({ verifiedAutoSend: true, analysis: ready }), "SEND");
  assert.equal(quotationSendPermission({ verifiedAutoSend: false, analysis: ready }), "MANUAL");
  assert.equal(quotationSendPermission({ verifiedAutoSend: true, analysis: { ...ready!, confidence: 0.8 } }), "REVIEW");
  assert.equal(quotationSendPermission({ verifiedAutoSend: true, analysis: { ...ready!, confidence: 0.4, missingInformation: ["quantity"] } }), "CLARIFY");
  assert.equal(quotationSendPermission({ verifiedAutoSend: true, analysis: null }), "EXISTING");
});

test("a customer draft cannot carry a price, stock figure, or quotation number", () => {
  assert.equal(customerDraftIsSafe("Please confirm the quantity."), true);
  assert.equal(customerDraftIsSafe("The price is R 1000 plus VAT."), false);
  const analysis = parseRfqAnalysis({
    classification: "RFQ",
    customerIntent: "Quote",
    items: [],
    missingInformation: ["the quantity"],
    sufficientToQuote: false,
    recommendedAction: "ASK_CLARIFICATION",
    confidence: 0.4,
    responseDraft: "The price is R 1000.",
  })!;
  assert.match(clarificationFromAnalysis(analysis), /Please confirm: the quantity/);
  assert.equal(clarificationFromAnalysis(analysis).includes("R 1000"), false);
});

test("ranks supplied catalogue matches without using a price", () => {
  const items = parseRfqAnalysis({
    classification: "RFQ",
    customerIntent: "Quote",
    items: [{ quantity: 2, category: "laptop", brand: "Lenovo", model: "ThinkPad E14", specifications: ["16GB RAM"], sku: "", mpn: "" }],
    missingInformation: [],
    sufficientToQuote: true,
    recommendedAction: "QUOTE",
    confidence: 0.91,
    responseDraft: "",
  })!.items;
  const ranked = rankSuppliedMatches(items, [
    { name: "Port sleeve", specifications: "14 inch" },
    { name: "Lenovo ThinkPad E14", specifications: "16GB RAM" },
  ]);
  assert.equal(ranked[0]?.name, "Lenovo ThinkPad E14");
});

test("the Responses API result is grounded in the email and ignores a failed call", async () => {
  let requestBody = "";
  const analysis = await analyzeInboundEmail({ subject: "Quote", body: source }, {
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({
        output: [{ content: [{ text: JSON.stringify({
          classification: "RFQ",
          customerIntent: "Quote",
          items: [{ quantity: 9, category: "laptop", brand: "Dell", model: "ThinkPad E14", specifications: ["16GB RAM"], sku: "INVENTED", mpn: "" }],
          missingInformation: [],
          sufficientToQuote: true,
          recommendedAction: "QUOTE",
          confidence: 0.99,
          responseDraft: "Please confirm the quantity.",
        }) }] }],
      }));
    },
  });
  assert.equal(analysis?.items[0]?.quantity, null);
  assert.equal(analysis?.items[0]?.brand, "");
  assert.equal(analysis?.items[0]?.model, "ThinkPad E14");
  assert.equal(analysis?.items[0]?.sku, "");
  const sent = JSON.parse(requestBody) as { instructions?: string; input?: string };
  assert.match(sent.instructions ?? "", /Do not invent a product price/);
  assert.match(sent.input ?? "", /ThinkPad E14/);
  const skipped = await analyzeInboundEmail({ subject: "Quote", body: source }, { apiKey: "" });
  assert.equal(skipped, null);
});

test("the analyser does not send mail or calculate a price", () => {
  const sourceText = readFileSync(new URL("./rfq-analyzer.ts", import.meta.url), "utf8");
  assert.equal(sourceText.includes("sendGmailMessage"), false);
  assert.equal(sourceText.includes("sendCustomerResponse"), false);
  assert.equal(sourceText.includes("priceQuotation"), false);
});

test("a parsed email keeps its requirement, and a grounded interpretation fills a blank parse", () => {
  const explicit = "Please quote 2 x Lenovo ThinkPad E14.";
  const kept = requirementsForSourcing(explicit, null);
  assert.equal(kept[0]?.model.toLowerCase().includes("thinkpad"), true);
  const informal = "Can you supply ThinkPad E14 notebooks for the team.";
  assert.equal(requirementsForSourcing(informal, null).length, 0);
  const analysis = groundRfqAnalysis(parseRfqAnalysis({
    classification: "RFQ",
    customerIntent: "Quote",
    items: [{ quantity: 2, category: "laptop", brand: "Lenovo", model: "ThinkPad E14", specifications: ["16GB RAM"], sku: "", mpn: "" }],
    missingInformation: [],
    sufficientToQuote: true,
    recommendedAction: "QUOTE",
    confidence: 0.93,
    responseDraft: "",
  })!, informal);
  const filled = requirementsForSourcing(informal, analysis);
  assert.equal(filled[0]?.model.toLowerCase().includes("thinkpad e14"), true);
  assert.equal(filled[0]?.quantity, null);
});
