import assert from "node:assert/strict";
import test from "node:test";
import {
  SEARCH_PROVIDER_DEPENDENCY,
  configuredSearchProvider,
  externalSearchQuery,
  listingRejection,
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
  assert.equal(configuredSearchProvider({}), null);
  assert.equal(configuredSearchProvider({ BRAVE_SEARCH_API_KEY: "present" }), "brave");
  assert.match(SEARCH_PROVIDER_DEPENDENCY, /BRAVE_SEARCH_API_KEY/);
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
