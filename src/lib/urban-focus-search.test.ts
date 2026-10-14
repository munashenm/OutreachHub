import assert from "node:assert/strict";
import test from "node:test";
import { determineInitialResponse, memoryProcessingStore, sendResponseOnce } from "./inbound-response";
import { emptyRequirement } from "./sourcing";
import { createUrbanFocusStore } from "../services/store/urban-focus-store";
import { parseUrbanFocusSearch, readStoreCatalogueQuery, relevantStoreProducts, urbanFocusCandidate, urbanFocusCatalogueHold, urbanFocusSearchQueries, urbanFocusSupplies } from "./urban-focus-search";

const emptyCatalogue = { page: 1, perPage: 40, total: 0, lastPage: 1, products: [] };

function catalogueStore(fetchImpl: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const store = createUrbanFocusStore({ apiBaseUrl: "https://www.urbanfocus.co.za/api/store/", token: "test-token" });
  return {
    store,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function jsonResponse(status: number, body: string) {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

test("catalogue API failures stay in review and an empty catalogue can be sourced online", async () => {
  const cases = [
    { name: "401", fetchImpl: async () => jsonResponse(401, "{\"error\":\"Invalid API key.\"}") },
    { name: "500", fetchImpl: async () => jsonResponse(500, "{\"error\":\"unavailable\"}") },
    { name: "timeout", fetchImpl: async () => { throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); } },
    { name: "invalid-json", fetchImpl: async () => jsonResponse(200, "{") },
    { name: "missing-body", fetchImpl: async () => jsonResponse(404, "") },
  ];
  for (const item of cases) {
    const setup = catalogueStore(item.fetchImpl as typeof fetch);
    let externalSearches = 0;
    try {
      const read = await readStoreCatalogueQuery(() => setup.store.searchCatalogue({ sku: "400702" }));
      assert.equal(typeof read.hold, "string", item.name);
      assert.match(read.hold ?? "", /held/);
      assert.equal(read.products, null);
      if (read.hold == null) externalSearches += 1;
      const response = determineInitialResponse({
        quotationRequest: true,
        tenderPackage: false,
        planKind: "STAFF_REVIEW",
        planSend: false,
        planMessage: "",
        salesAction: "",
        salesMessage: "",
        catalogueProductNamed: false,
        awaitingQuantity: false,
        documentBlocksAutoSend: false,
        notify: true,
      });
      const delivery = await sendResponseOnce({
        gmailMessageId: `catalogue-${item.name}`,
        threadId: "thread-catalogue",
        response,
        store: memoryProcessingStore(),
        repliesEnabled: true,
        send: async () => { throw new Error("Customer email must not be sent."); },
      });
      assert.equal(delivery.sent, false, item.name);
      assert.equal(externalSearches, 0, item.name);
    } finally {
      setup.restore();
    }
  }
  const setup = catalogueStore(async () => jsonResponse(200, JSON.stringify(emptyCatalogue)));
  let externalSearches = 0;
  try {
    const read = await readStoreCatalogueQuery(() => setup.store.searchCatalogue({ sku: "missing-sku" }));
    assert.equal(read.hold, null);
    assert.deepEqual(read.products, []);
    if (read.hold == null) externalSearches += 1;
    assert.equal(externalSearches, 1);
  } finally {
    setup.restore();
  }
});

test("a catalogue failure is held instead of being treated as no stock", () => {
  const rejected = urbanFocusCatalogueHold({ error: new Error("The store rejected the API key.") });
  const unavailable = urbanFocusCatalogueHold({ error: new Error("The store returned 500.") });
  const timedOut = urbanFocusCatalogueHold({ error: new Error("The operation was aborted due to timeout") });
  const invalid = urbanFocusCatalogueHold({ body: { error: "not a catalogue" } });
  const missing = urbanFocusCatalogueHold({ body: null });
  const empty = urbanFocusCatalogueHold({
    body: { page: 1, perPage: 40, total: 0, lastPage: 1, products: [] },
  });
  for (const held of [rejected, unavailable, timedOut, invalid, missing]) {
    assert.equal(typeof held, "string");
    assert.match(held ?? "", /held/);
    assert.doesNotMatch(held ?? "", /does not stock|not found/i);
  }
  assert.equal(empty, null);
});

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
