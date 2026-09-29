import assert from "node:assert/strict";
import test from "node:test";
import { lowestCostCents, planSupplierPriceImport, sellPriceAfterSupplierFeed } from "./supplier-feed";

const catalogue = new Map([["sw-24", "product-1"]]);

test("matches a supplier row to an existing catalogue SKU", () => {
  const plan = planSupplierPriceImport(
    [{ sku: "SW-24", suppliersku: "SUP-24", cost: "899.00" }],
    catalogue,
  );
  assert.equal(plan.rejected.length, 0);
  assert.deepEqual(plan.ready[0], {
    row: 2,
    sku: "SW-24",
    productId: "product-1",
    supplierSku: "SUP-24",
    costCents: 89900,
  });
});

test("does not create a product for an unknown supplier SKU", () => {
  const plan = planSupplierPriceImport([{ sku: "MISSING", cost: "10" }], catalogue);
  assert.equal(plan.ready.length, 0);
  assert.match(plan.rejected[0]?.reason ?? "", /not added/);
});

test("rejects a duplicate SKU in one supplier file", () => {
  const plan = planSupplierPriceImport(
    [{ sku: "SW-24", cost: "10" }, { sku: "sw-24", cost: "12" }],
    catalogue,
  );
  assert.equal(plan.ready.length, 1);
  assert.match(plan.rejected[0]?.reason ?? "", /duplicated/);
});

test("keeps the catalogue sell price when a supplier cost arrives", () => {
  assert.equal(sellPriceAfterSupplierFeed(250000), 250000);
  assert.equal(lowestCostCents([120000, 99000]), 99000);
  assert.equal(lowestCostCents([]), null);
});
