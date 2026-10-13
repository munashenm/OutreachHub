import assert from "node:assert/strict";
import test from "node:test";
import {
  SEARCH_PROVIDER_DEPENDENCY,
  configuredSearchProvider,
  externalSearchQuery,
  listingRejection,
  openAiCitationHits,
  parseProductPage,
  rankExternalUrls,
} from "./external-search";
import { extractProductRequirements } from "./sourcing";

const requirement = extractProductRequirements("Please quote 5 business laptops.\n\nIntel Core i5\n16GB RAM\n512GB SSD\nWindows 11 Pro\n14 inch.")[0]!;

test("builds a specification query and keeps the search provider unset until a key exists", () => {
  assert.equal(requirement.quantity, 5);
  assert.equal(requirement.processor, "Core i5");
  assert.equal(requirement.ramGb, 16);
  assert.equal(externalSearchQuery(requirement), "Laptop Core i5 16GB RAM 512GB SSD Windows 11 Pro 14 inch South Africa");
  const scanner = extractProductRequirements("Also quote 2 barcode scanners.")[0];
  assert.match(externalSearchQuery(scanner!), /barcode scanners/i);
  assert.match(externalSearchQuery(scanner!), /South Africa/);
  assert.equal(configuredSearchProvider({}), null);
  assert.equal(configuredSearchProvider({ BRAVE_SEARCH_API_KEY: "present" }), "brave");
  assert.match(SEARCH_PROVIDER_DEPENDENCY, /BRAVE_SEARCH_API_KEY/);
});

test("OpenAI web search citations become page addresses and invented prices are ignored", () => {
  const hits = openAiCitationHits({
    output: [
      { type: "web_search_call", action: { sources: [{ url: "https://www.incredible.co.za/barcode-scanner", title: "Barcode scanner" }] } },
      { type: "message", content: [{ annotations: [{ url: "https://www.takealot.com/scanner", title: "Scanner" }, { url: "http://insecure.example/scanner", title: "Dropped" }] }] },
    ],
  });
  assert.deepEqual(hits.map((hit) => hit.url), ["https://www.incredible.co.za/barcode-scanner", "https://www.takealot.com/scanner"]);
  const ranked = rankExternalUrls(hits);
  assert.equal(ranked.every((page) => page.url.startsWith("https://")), true);
  assert.equal("price" in (hits[0] ?? {}), false);
});

test("ranks manufacturers, distributors, and South African retailers and drops marketplaces", () => {
  const ranked = rankExternalUrls([
    { url: "https://www.ebay.com/itm/1", title: "Laptop" },
    { url: "https://www.wootware.co.za/laptop", title: "Business laptop" },
    { url: "https://www.lenovo.com/za/en/p/laptops", title: "ThinkPad" },
    { url: "https://live.frontosa.co.za/product", title: "Notebook" },
    { url: "https://example.com/laptop", title: "Unknown seller" },
  ]);
  assert.deepEqual(ranked.map((page) => page.sourceType), ["MANUFACTURER", "DISTRIBUTOR", "RETAILER"]);
});

test("reads a product page and rejects a laptop below the specification", () => {
  const html = `<html><head><title>Lenovo ThinkPad E14</title>
    <script type="application/ld+json">{"@type":"Product","name":"Lenovo ThinkPad E14","brand":"Lenovo","sku":"E14G7","description":"Intel Core i5, 16GB RAM, 512GB SSD, Windows 11 Pro, 14 inch","offers":{"price":"12999.00","priceCurrency":"ZAR","availability":"https://schema.org/InStock","priceSpecification":{"valueAddedTaxIncluded":true}}}</script>
    </head><body>12 in stock</body></html>`;
  const parsed = parseProductPage(html, "https://www.wootware.co.za/laptop");
  assert.equal(parsed.reason, "");
  assert.equal(parsed.listing?.listedPriceCents, 1299900);
  assert.equal(parsed.listing?.vatIncluded, true);
  assert.equal(parsed.listing?.stockQty, 12);
  assert.equal(listingRejection(requirement, parsed.listing!, "https://www.wootware.co.za/laptop"), "");
  const low = parseProductPage(html.replace("16GB RAM", "8GB RAM").replace("Windows 11 Pro", "Windows 11 Home"), "https://www.wootware.co.za/laptop");
  assert.match(listingRejection(requirement, low.listing!, "https://www.wootware.co.za/laptop"), /does not meet/);
});

test("an A3 duplex printer at 35 ppm is accepted and a slower A4 printer is not", () => {
  const [printer] = extractProductRequirements("3 × A3 duplex multifunction printers, minimum print speed 30 ppm, network connectivity and automatic document feeder.");
  assert.equal(printer?.quantity, 3);
  assert.equal(printer?.productType, "Printer");
  const html = `<html><head><title>Brother MFC A3</title>
    <script type="application/ld+json">{"@type":"Product","name":"Brother MFC-J6940DW A3 duplex printer","brand":"Brother","sku":"MFCJ6940DW","description":"A3 duplex colour printer, 35 ppm, wireless network","offers":{"price":"18999.00","priceCurrency":"ZAR","availability":"https://schema.org/InStock","priceSpecification":{"valueAddedTaxIncluded":true}}}</script>
    </head><body>6 in stock</body></html>`;
  const parsed = parseProductPage(html, "https://www.incredible.co.za/brother-mfc");
  assert.equal(parsed.reason, "");
  assert.equal(listingRejection(printer!, parsed.listing!, "https://www.incredible.co.za/brother-mfc"), "");
  const slow = parseProductPage(html.replace("A3 duplex", "A4").replace("35 ppm", "22 ppm"), "https://www.incredible.co.za/a4-printer");
  assert.match(listingRejection(printer!, slow.listing!, "https://www.incredible.co.za/a4-printer"), /does not meet|hold:/);
  const uncounted = parseProductPage(html.replace("6 in stock", "available"), "https://www.incredible.co.za/brother-mfc");
  assert.match(listingRejection(printer!, uncounted.listing!, "https://www.incredible.co.za/brother-mfc"), /^hold:/);
});
