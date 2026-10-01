import assert from "node:assert/strict";
import test from "node:test";
import {
  ACKNOWLEDGEMENT,
  acceptProductImage,
  canAutoSend,
  classifyCustomerReply,
  classifyInbound,
  extractRfqRequest,
  factualReply,
  groundAiRfqExtraction,
  imagesFromProductPage,
  matchRfqLine,
  mergeRfqExtraction,
  PUBLIC_PRICE_NOTE,
  nameKey,
  newProductDecision,
  priceQuotation,
  seoFromProduct,
  storeStockInstruction,
  type CatalogueHit,
} from "./automation";

const hit = (overrides: Partial<CatalogueHit>): CatalogueHit => ({
  id: "store-1",
  productId: "prod-1",
  sku: "SW-24",
  skuKey: "SW-24",
  mpnKey: "D11G8ET",
  barcodeKey: "6001234567890",
  brandModelKey: "HP|D11G8ET",
  nameKey: nameKey("HP D11G8ET Laptop"),
  name: "HP D11G8ET Laptop",
  ...overrides,
});

test("classifies a quotation request and ignores an outbound campaign reply", () => {
  const body = "Please quote on 2 x HP laptop model D11G8ET";
  assert.equal(classifyInbound({ subject: "Quotation", body, campaignReply: false }), "RFQ");
  assert.equal(classifyInbound({ subject: "Re: newsletter", body: "Thanks", campaignReply: true }), "CAMPAIGN_REPLY");
  assert.equal(classifyCustomerReply("We accept the quotation"), "QUOTE_ACCEPTED");
  assert.equal(classifyCustomerReply("Can you do a better price?"), "PRICE_NEGOTIATION");
});

test("keeps a stated quantity phrase and does not invent a prose product", () => {
  const stated = extractRfqRequest("Please quote 2 x Lenovo ThinkPad E14 business laptops.");
  assert.equal(stated.lines.length, 1);
  assert.equal(stated.lines[0]?.quantity, 2);
  assert.match(stated.lines[0]?.description ?? "", /ThinkPad E14/);
  assert.equal(stated.lines[0]?.sku, "");
  const prose = [
    "Please quote 5 Lenovo ThinkPad E14 laptops.",
    "Kindly provide pricing for 20 units of D11G8ET.",
  ];
  for (const body of prose) assert.deepEqual(extractRfqRequest(body).lines, []);
  const specified = extractRfqRequest("We need 10 HP laptops with Core i5, 16GB RAM and 512GB SSD.");
  assert.equal(specified.lines.length, 1);
  assert.equal(specified.lines[0]?.quantity, 10);
  assert.match(specified.lines[0]?.specifications ?? "", /Core i5/);
  assert.match(specified.lines[0]?.specifications ?? "", /16GB RAM/);
  assert.match(specified.lines[0]?.specifications ?? "", /512GB SSD/);
  const wordedSpec = extractRfqRequest("Please send a quote for five laptops, Core i5, 16GB RAM, 512GB SSD and Windows 11 Pro.");
  assert.equal(wordedSpec.lines[0]?.quantity, 5);
  assert.match(wordedSpec.lines[0]?.specifications ?? "", /Windows 11 Pro/);
});

test("uses grounded AI lines only when the deterministic extract is empty", () => {
  const source = "Please quote 5 Lenovo ThinkPad E14 laptops.";
  const grounded = groundAiRfqExtraction({
    customerName: "Invented Person",
    lines: [{
      description: "5 Lenovo ThinkPad E14 laptops",
      quantity: 5,
      manufacturer: "Lenovo",
      model: "ThinkPad E14",
      sku: "INVENTED-SKU",
      manufacturerPartNumber: "",
      specifications: "16GB RAM",
    }],
  }, source);
  assert.equal(grounded.customerName, "");
  assert.equal(grounded.lines[0]?.quantity, 5);
  assert.equal(grounded.lines[0]?.manufacturer, "Lenovo");
  assert.equal(grounded.lines[0]?.sku, "");
  assert.equal(grounded.lines[0]?.specifications, "");
  const deterministic = extractRfqRequest("2 x HP laptop model D11G8ET");
  const merged = mergeRfqExtraction(deterministic, grounded);
  assert.equal(merged.lines[0]?.manufacturerPartNumber, "D11G8ET");
  const words = "Please send a quote for five laptops, Core i5, 16GB RAM, 512GB SSD and Windows 11 Pro.";
  const worded = groundAiRfqExtraction({ lines: [{ description: "five laptops, Core i5, 16GB RAM, 512GB SSD and Windows 11 Pro", quantity: 5, specifications: "Core i5, 16GB RAM, 512GB SSD and Windows 11 Pro" }] }, words);
  assert.equal(worded.lines[0]?.quantity, 5);
  assert.match(worded.lines[0]?.specifications ?? "", /Windows 11 Pro/);
});

test("extracts only details that are written in the email", () => {
  const extracted = extractRfqRequest([
    "Name: Jane Smith",
    "Company: Northwind",
    "Email: jane@northwind.example",
    "RFQ number: UF-100",
    "Deliver to: Johannesburg",
    "Required by: 20 October 2026",
    "2 x HP laptop model D11G8ET",
    "Switch SKU SW-24 qty 4",
  ].join("\n"));
  assert.equal(extracted.customerName, "Jane Smith");
  assert.equal(extracted.companyName, "Northwind");
  assert.equal(extracted.email, "jane@northwind.example");
  assert.equal(extracted.reference, "UF-100");
  assert.equal(extracted.deliveryLocation, "Johannesburg");
  assert.equal(extracted.requiredDate, "20 October 2026");
  assert.equal(extracted.lines.length, 2);
  assert.equal(extracted.lines[0]?.quantity, 2);
  assert.equal(extracted.lines[0]?.manufacturerPartNumber, "D11G8ET");
  assert.equal(extracted.lines[1]?.sku, "SW-24");
  assert.equal(extracted.lines[1]?.quantity, 4);
  assert.equal(extracted.notes, "");
});

test("matches a part number and refuses an ambiguous barcode", () => {
  const catalogue = [
    hit({}),
    hit({ id: "store-2", productId: "prod-2", sku: "SW-25", skuKey: "SW-25", mpnKey: "OTHER", barcodeKey: "6001234567890" }),
  ];
  const matched = matchRfqLine({ manufacturerPartNumber: "D11-G8ET" }, catalogue);
  assert.equal(matched.status, "MATCHED");
  assert.equal(matched.productId, "prod-1");
  const ambiguous = matchRfqLine({ barcode: "6001234567890" }, catalogue);
  assert.equal(ambiguous.status, "NEEDS_PRODUCT_REVIEW");
  assert.equal(ambiguous.productId, null);
});

test("quotes one product that meets the specification and holds a public price", () => {
  const laptop = hit({
    id: "store-e14",
    productId: "prod-e14",
    sku: "E14",
    skuKey: "E14",
    mpnKey: "E14G5",
    name: "Lenovo ThinkPad E14",
    nameKey: nameKey("Lenovo ThinkPad E14"),
    specifications: "Intel Core i5, 16 GB memory, 512 GB NVMe, 14-inch, Windows 11 Pro",
  });
  const other = hit({
    id: "store-other",
    productId: "prod-other",
    sku: "OTHER",
    skuKey: "OTHER",
    mpnKey: "OTHER1",
    name: "Other laptop",
    nameKey: nameKey("Other laptop"),
    specifications: "Intel Core i7, 32 GB memory, 1 TB SSD",
  });
  const request = { description: "laptops", specifications: "Core i5, 16GB RAM, 512GB SSD, Windows 11 Pro" };
  const matched = matchRfqLine(request, [laptop, other]);
  assert.equal(matched.status, "MATCHED");
  assert.equal(matched.productId, "prod-e14");
  assert.equal(matched.reason, "Matched the specification.");
  const duplicate = matchRfqLine(request, [laptop, { ...laptop, id: "store-e14b", productId: "prod-e14b", sku: "E14B" }]);
  assert.equal(duplicate.status, "NEEDS_PRODUCT_REVIEW");
  assert.equal(duplicate.productId, null);
  const missing = matchRfqLine(request, [other]);
  assert.equal(missing.reason, PUBLIC_PRICE_NOTE);
  assert.equal(missing.productId, null);
});

test("prices exclusive cost with markup and holds a low margin", () => {
  const priced = priceQuotation({
    costExVatCents: 10000,
    markupPercent: 25,
    minimumMarginPercent: 10,
    autoQuoteMarginPercent: 15,
    autoSendMarginPercent: 25,
    fresh: true,
    stockKnown: true,
    stockQty: 4,
    requestedQty: 2,
    abnormalPriceChange: false,
  });
  assert.equal(priced.sellExVatCents, 12500);
  assert.equal(priced.sellInclVatCents, 14375);
  assert.equal(priced.marginPercent, 20);
  assert.equal(priced.decision, "AUTO_QUOTE");
  assert.equal(canAutoSend({ decisions: ["AUTO_QUOTE"], matchesHighConfidence: true, specificationClear: true, autoSendMarginMet: false }), false);
  const blocked = priceQuotation({ ...{
    costExVatCents: 10000,
    markupPercent: 5,
    minimumMarginPercent: 10,
    autoQuoteMarginPercent: 15,
    autoSendMarginPercent: 25,
    fresh: true,
    stockKnown: true,
    stockQty: 4,
    requestedQty: 2,
    abnormalPriceChange: false,
  } });
  assert.equal(blocked.decision, "MARGIN_WARNING");
  assert.equal(priceQuotation({ ...blocked, costExVatCents: 10000, markupPercent: 25, minimumMarginPercent: 10, autoQuoteMarginPercent: 15, autoSendMarginPercent: 25, fresh: false, stockKnown: true, stockQty: 4, requestedQty: 2, abnormalPriceChange: false }).decision, "STALE");
});

test("does not invent a factual reply for a negotiation", () => {
  assert.equal(factualReply("PRICE_NEGOTIATION", { stockQty: 3, validUntil: "10 October 2026", specifications: "24 ports" }), null);
  assert.match(factualReply("STOCK_QUESTION", { stockQty: 3, validUntil: "", specifications: "" }) ?? "", /3 available/);
  assert.match(ACKNOWLEDGEMENT, /checking current pricing and availability/);
});

test("publishes a new product only when identity, price, content, and image are verified", () => {
  const base = {
    matchedExisting: false,
    duplicateBlocked: false,
    sku: "NEW-1",
    manufacturerPartNumber: "D11G8ET",
    name: "HP D11G8ET Laptop",
    brand: "HP",
    category: "Laptops",
    costCents: 10000,
    stockQty: 2,
    markupPercent: 25,
    minimumMarginPercent: 10,
    description: "HP D11G8ET business laptop with a verified specification list.",
    specifications: "Processor: listed by the supplier",
    imageUrls: ["https://cdn.supplier.example/D11G8ET.jpg"],
  };
  assert.equal(newProductDecision(base), "PUBLISH");
  assert.equal(newProductDecision({ ...base, matchedExisting: true }), "NEW_PRODUCT_REVIEW_REQUIRED");
  assert.equal(newProductDecision({ ...base, imageUrls: ["https://cdn.supplier.example/watermark-generic.jpg"] }), "IMAGE_REVIEW_REQUIRED");
  assert.equal(acceptProductImage("https://images.example/thumb/D11G8ET.jpg", base), false);
  const seo = seoFromProduct({ brand: "HP", model: "D11G8ET", productType: "Laptop", category: "Laptops", specifications: "16 GB memory" });
  assert.match(seo?.title ?? "", /HP D11G8ET Laptop \| Urban Focus South Africa/);
  assert.match(seo?.meta ?? "", /South Africa/);
  assert.equal(seo?.meta.includes("supplier cost"), false);
});

test("reads an official image only from a page that names the exact model", () => {
  const html = `<html><meta property="og:image" content="https://www.hp.com/D11G8ET/hero.jpg"><script type="application/ld+json">{"image":"https://www.hp.com/D11G8ET/front.jpg"}</script>HP D11G8ET</html>`;
  assert.equal(imagesFromProductPage(html, { brand: "HP", manufacturerPartNumber: "D11G8ET" }).length, 2);
  assert.deepEqual(imagesFromProductPage(html, { brand: "Dell", manufacturerPartNumber: "D11G8ET" }), []);
});

test("sets the website out of stock without deleting the product", () => {
  assert.deepEqual(storeStockInstruction(0), { stockQuantity: 0, inStock: false, deleteProduct: false });
  assert.equal(storeStockInstruction(3).inStock, true);
});
