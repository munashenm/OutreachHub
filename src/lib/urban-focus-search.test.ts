import assert from "node:assert/strict";
import test from "node:test";
import { emptyRequirement } from "./sourcing";
import { parseUrbanFocusSearch, relevantStoreProducts, urbanFocusCandidate, urbanFocusSearchQueries, urbanFocusSupplies } from "./urban-focus-search";

test("builds an Urban Focus search from the requested identity and product", () => {
  const queries = urbanFocusSearchQueries([
    { ...emptyRequirement(), sku: "SW-24", mpn: "MPN-24", model: "ThinkBook 16", productType: "Laptop", requestedText: "Please quote 2 laptops" },
  ]);
  assert.deepEqual(queries[0], { sku: "SW-24" });
  assert.deepEqual(queries[1], { mpn: "MPN-24" });
  assert.equal(queries.some((query) => query.q?.includes("ThinkBook 16")), true);
});

test("keeps only store products that match the search and carries the verified cost", () => {
  const products = parseUrbanFocusSearch({
    page: 1,
    perPage: 40,
    total: 2,
    lastPage: 1,
    products: [
      {
        storeProductId: "41",
        sku: "SW-24",
        name: "24 port switch",
        brand: "Focus",
        manufacturerPartNumber: "MPN-24",
        unitPriceCents: 250000,
        costExVatCents: 180000,
        stockQuantity: 4,
        published: true,
        description: "Gigabit switch",
        specifications: "24 ports",
        imageUrls: ["https://www.urbanfocus.co.za/storage/switch.jpg"],
        url: "https://www.urbanfocus.co.za/product/switch",
      },
      {
        storeProductId: "9",
        sku: "OTHER",
        name: "Unrelated cable",
        unitPriceCents: 1000,
        stockQuantity: 1,
        published: true,
        description: "",
        specifications: "",
        imageUrls: [],
      },
    ],
  });
  assert.equal("error" in products, false);
  if ("error" in products) return;
  const relevant = relevantStoreProducts(products, { q: "24 port switch" });
  assert.equal(relevant.length, 1);
  assert.equal(relevantStoreProducts(products, { sku: "SW-24" }).length, 1);
  assert.equal(relevantStoreProducts(products, { sku: "OTHER" })[0]?.sku, "OTHER");
  const candidate = urbanFocusCandidate(relevant[0], "2026-10-13T00:00:00.000Z");
  assert.equal(candidate.sourceName, "Urban Focus");
  assert.equal(candidate.productId, null);
  assert.equal(candidate.costExVatCents, 180000);
  assert.equal(candidate.listedPriceCents, 250000);
  assert.equal(candidate.imageUrls?.[0], "https://www.urbanfocus.co.za/storage/switch.jpg");
  const requirement = { ...emptyRequirement("Please quote 2 switches"), sku: "SW-24", quantity: 2, productType: "Switch" };
  assert.equal(urbanFocusSupplies(requirement, [candidate]), true);
  assert.equal(urbanFocusSupplies({ ...requirement, quantity: 20 }, [candidate]), false);
});
