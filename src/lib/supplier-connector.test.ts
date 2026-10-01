import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseSupplierOffer,
  exclusiveCostCents,
  matchCatalogueOffer,
  offersFromCsvRecords,
  parseCsvOffers,
  parseJsonOffers,
  parseXmlOffers,
  priceChangeNeedsApproval,
  type SupplierChoice,
  type SupplierOffer,
} from "./supplier-connector";

const now = new Date("2026-09-30T12:00:00.000Z");

function choice(overrides: Partial<SupplierChoice>): SupplierChoice {
  return {
    supplierId: "supplier-a",
    costCents: 10000,
    costKnown: true,
    stockQty: 5,
    stockKnown: true,
    updatedAt: now,
    preference: 0,
    leadTimeDays: 3,
    priceFreshMs: 60 * 60 * 1000,
    ...overrides,
  };
}

test("reads a JSON list, an items object, and a products object", () => {
  const list = parseJsonOffers([{ sku: "SW-24", cost: 10, stock: 4, mpn: "MPN-24" }]);
  assert.equal(list.error, null);
  assert.equal(list.offers[0]?.supplierSku, "SW-24");
  assert.equal(list.offers[0]?.manufacturerPartNumber, "MPN-24");
  assert.equal(list.offers[0]?.costCents, 1000);
  assert.equal(list.offers[0]?.stockQty, 4);

  const items = parseJsonOffers({ items: [{ supplier_sku: "SW-25", price: "12.50", qty: 1 }] });
  assert.equal(items.offers[0]?.costCents, 1250);

  const products = parseJsonOffers({ products: [{ code: "SW-26", unit_cost: "8", available: 0 }] });
  assert.equal(products.offers[0]?.supplierSku, "SW-26");
  assert.equal(products.offers[0]?.stockQty, 0);
});

test("keeps a JSON row when cost or stock is missing and skips an invalid cost", () => {
  const parsed = parseJsonOffers([
    { sku: "SW-24", stock: 2 },
    { sku: "SW-25", cost: "soon", stock: 1 },
  ]);
  assert.equal(parsed.offers.length, 1);
  assert.equal(parsed.offers[0]?.costCents, null);
  assert.equal(parsed.offers[0]?.stockQty, 2);
  assert.equal(parsed.skipped, 1);
});

test("reads mapped XML product elements", () => {
  const xml = `<?xml version="1.0"?><catalogue><goods sku="SW-24"><part>MPN-24</part><price>100.00</price><qty>6</qty><title>Switch</title><picture>https://cdn.example.com/sw.jpg</picture></goods></catalogue>`;
  const parsed = parseXmlOffers(xml, {
    productElement: "goods",
    sku: "sku",
    manufacturerPartNumber: "part",
    cost: "price",
    stock: "qty",
    name: "title",
    imageUrls: "picture",
  });
  assert.equal(parsed.error, null);
  assert.equal(parsed.offers.length, 1);
  assert.equal(parsed.offers[0]?.supplierSku, "SW-24");
  assert.equal(parsed.offers[0]?.manufacturerPartNumber, "MPN-24");
  assert.equal(parsed.offers[0]?.costCents, 10000);
  assert.equal(parsed.offers[0]?.stockQty, 6);
  assert.equal(parsed.offers[0]?.name, "Switch");
  assert.deepEqual(parsed.offers[0]?.imageUrls, ["https://cdn.example.com/sw.jpg"]);
});

test("reads a CSV feed from headers", () => {
  const parsed = parseCsvOffers("sku,manufacturerPartNumber,cost,stock,brand\nSW-24,MPN-24,15.00,3,Focus\n");
  assert.equal(parsed.error, null);
  assert.equal(parsed.offers[0]?.supplierSku, "SW-24");
  assert.equal(parsed.offers[0]?.manufacturerPartNumber, "MPN-24");
  assert.equal(parsed.offers[0]?.costCents, 1500);
  assert.equal(parsed.offers[0]?.stockQty, 3);
  assert.equal(parsed.offers[0]?.brand, "Focus");
});

test("maps a manual CSV row into the same offer", () => {
  const parsed = offersFromCsvRecords([{ sku: "SW-24", suppliersku: "SUP-24", cost: "899.00" }]);
  assert.equal(parsed.offers[0]?.supplierSku, "SUP-24");
  assert.equal(parsed.offers[0]?.costCents, 89900);
  assert.equal(parsed.offers[0]?.stockQty, null);
});

test("converts VAT inclusive cost to exclusive cents", () => {
  assert.equal(exclusiveCostCents(11500, "INCLUSIVE"), 10000);
  assert.equal(exclusiveCostCents(10000, "EXCLUSIVE"), 10000);
  assert.equal(exclusiveCostCents(null, "INCLUSIVE"), null);
});

test("matches a manufacturer part number before the supplier SKU", () => {
  const offer: SupplierOffer = {
    supplierSku: "OTHER",
    manufacturerPartNumber: "MPN-24",
    name: "",
    brand: "",
    costCents: 1000,
    stockQty: 1,
    description: "",
    specifications: "",
    imageUrls: [],
    category: "",
    leadTimeDays: null,
    matchSkus: ["OTHER"],
  };
  const productId = matchCatalogueOffer(
    offer,
    new Map([["other", "sku-product"], ["mpn-24", "catalogue-product"]]),
    new Map([["mpn-24", "linked-product"]]),
  );
  assert.equal(productId, "linked-product");
  assert.equal(matchCatalogueOffer({ ...offer, manufacturerPartNumber: "" }, new Map([["other", "sku-product"]]), new Map()), "sku-product");
  assert.equal(matchCatalogueOffer({ ...offer, manufacturerPartNumber: "", supplierSku: "missing", matchSkus: ["missing"] }, new Map(), new Map()), null);
});

test("selects a supplier by stock, quantity, cost, freshness, preference, and lead time", () => {
  const cheapOut = choice({ supplierId: "cheap-out", costCents: 5000, stockQty: 0 });
  const cheapShort = choice({ supplierId: "cheap-short", costCents: 7000, stockQty: 1 });
  const dear = choice({ supplierId: "dear", costCents: 9000, stockQty: 8, preference: 1, leadTimeDays: 2 });
  const stale = choice({ supplierId: "stale", costCents: 1000, stockQty: 20, updatedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000) });
  const missingCost = choice({ supplierId: "missing", costCents: null, costKnown: false, stockQty: 20 });
  assert.equal(chooseSupplierOffer([cheapOut, cheapShort, dear, stale, missingCost], 4, now)?.supplierId, "dear");

  const tiedLow = choice({ supplierId: "low", costCents: 9000, preference: 1, leadTimeDays: 5 });
  const tiedHigh = choice({ supplierId: "high", costCents: 9000, preference: 5, leadTimeDays: 9 });
  assert.equal(chooseSupplierOffer([tiedLow, tiedHigh], 1, now)?.supplierId, "high");

  const slow = choice({ supplierId: "slow", costCents: 9000, preference: 5, leadTimeDays: 9 });
  const fast = choice({ supplierId: "fast", costCents: 9000, preference: 5, leadTimeDays: 2 });
  const unknownLead = choice({ supplierId: "unknown", costCents: 9000, preference: 5, leadTimeDays: null });
  assert.equal(chooseSupplierOffer([slow, unknownLead, fast], 1, now)?.supplierId, "fast");
  assert.equal(chooseSupplierOffer([stale, missingCost, cheapOut], 1, now), null);
});

test("flags a sell-price move of 15 percent or more", () => {
  assert.equal(priceChangeNeedsApproval(10000, 11500), true);
  assert.equal(priceChangeNeedsApproval(10000, 11400), false);
  assert.equal(priceChangeNeedsApproval(0, 11500), false);
});
