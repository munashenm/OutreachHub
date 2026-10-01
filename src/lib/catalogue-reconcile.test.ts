import assert from "node:assert/strict";
import test from "node:test";
import {
  analyseCatalogue,
  barcodeKey,
  brandModelKey,
  matchStoreProduct,
  mpnKey,
  parseStoreCataloguePage,
  recommendedCatalogueAction,
  sharesDuplicateKey,
  skuKey,
  type CatalogueRecord,
  type StoreIdentity,
} from "./catalogue-reconcile";
import { selectedSupplierStock, type SupplierChoice } from "./supplier-connector";

function record(overrides: Partial<CatalogueRecord> & Pick<CatalogueRecord, "id" | "storeProductId">): CatalogueRecord {
  return {
    sku: "",
    skuKey: "",
    mpnKey: "",
    barcodeKey: "",
    brandModelKey: "",
    name: "Product",
    unitPriceCents: 1000,
    stockQuantity: 2,
    imageCount: 1,
    productId: null,
    reviewStatus: "BASELINE",
    ...overrides,
  };
}

function identity(overrides: Partial<StoreIdentity> & Pick<StoreIdentity, "storeProductId" | "sku">): StoreIdentity {
  return {
    skuKey: skuKey(overrides.sku),
    mpnKey: "",
    barcodeKey: "",
    brandModelKey: "",
    name: "Product",
    ...overrides,
  };
}

test("normalises identity keys without treating blanks as the same product", () => {
  assert.equal(skuKey(" sw-24 "), "SW-24");
  assert.equal(mpnKey("D11-G8ET"), "D11G8ET");
  assert.equal(barcodeKey("6001 2345 67890"), "6001234567890");
  assert.equal(barcodeKey("123"), "");
  assert.equal(brandModelKey("HP", "D11G8ET"), "HP|D11G8ET");
  assert.equal(brandModelKey("HP", ""), "");
});

test("reads a store catalogue page and drops a placeholder image", () => {
  const parsed = parseStoreCataloguePage({
    page: 1,
    perPage: 50,
    total: 1,
    lastPage: 1,
    products: [{
      storeProductId: "41",
      sku: "SW-24",
      manufacturerPartNumber: "MPN-24",
      barcode: "6001234567890",
      name: "Switch",
      brand: "Focus",
      category: "Network",
      unitPriceCents: 250000,
      salePriceCents: null,
      currency: "ZAR",
      stockQuantity: 0,
      stockStatus: "out_of_stock",
      description: "Gigabit",
      specifications: "Ports: 24",
      imageUrls: ["https://cdn.example.com/placeholder.jpg", "https://www.urbanfocus.co.za/storage/switch.jpg"],
      published: true,
      slug: "switch",
      url: "https://www.urbanfocus.co.za/product/switch",
      updatedAt: "2026-10-01T10:00:00.000Z",
    }],
  });
  assert.equal("error" in parsed, false);
  if ("error" in parsed) return;
  assert.equal(parsed.products[0]?.imageUrls.length, 1);
  assert.equal(parsed.products[0]?.mpnKey, "MPN24");
  assert.equal(parsed.products[0]?.brandModelKey, "FOCUS|MPN24");
});

test("rejects a catalogue page that is not a product list", () => {
  const parsed = parseStoreCataloguePage({ status: "ok" });
  assert.equal("error" in parsed, true);
});

test("counts the baseline and keeps duplicate blanks out of the duplicate totals", () => {
  const { stats, flags } = analyseCatalogue([
    record({ id: "a", storeProductId: "1", sku: "SW-24", skuKey: "SW-24", mpnKey: "MPN24", barcodeKey: "6001234567890", brandModelKey: "HP|D11G8ET", imageCount: 0, unitPriceCents: 0, stockQuantity: 0 }),
    record({ id: "b", storeProductId: "2", sku: "SW-24", skuKey: "SW-24", mpnKey: "MPN24", barcodeKey: "6001234567890", brandModelKey: "HP|D11G8ET" }),
    record({ id: "c", storeProductId: "3", sku: "SW-25", skuKey: "SW-25", productId: "local-1" }),
    record({ id: "d", storeProductId: "4" }),
    record({ id: "e", storeProductId: "5" }),
  ]);
  assert.equal(stats.total, 5);
  assert.equal(stats.withSku, 3);
  assert.equal(stats.withoutSku, 2);
  assert.equal(stats.withMpn, 2);
  assert.equal(stats.withBarcode, 2);
  assert.equal(stats.missingImages, 1);
  assert.equal(stats.withImages, 4);
  assert.equal(stats.zeroStock, 1);
  assert.equal(stats.withoutPrice, 1);
  assert.equal(stats.duplicateSkuGroups, 1);
  assert.equal(stats.duplicateSkuProducts, 2);
  assert.equal(stats.duplicateMpnProducts, 2);
  assert.equal(stats.duplicateBarcodeProducts, 2);
  assert.equal(stats.duplicateBrandModelProducts, 2);
  assert.equal(stats.readyForSupplierMatching, 1);
  assert.equal(stats.matchedToCatalogue, 1);
  assert.equal(stats.needsReview, 2);
  assert.deepEqual(flags.get("a"), ["sku", "mpn", "barcode", "brandModel"]);
  assert.equal(flags.has("d"), false);
  assert.equal(flags.has("e"), false);
});

test("matches an existing store product by part number before creating one", () => {
  const items = [
    identity({ storeProductId: "41", sku: "SW-24", mpnKey: "D11G8ET", name: "HP Laptop" }),
    identity({ storeProductId: "42", sku: "SW-25", name: "Other" }),
  ];
  const matched = matchStoreProduct({ sku: "SUP-1", manufacturerPartNumber: "D11-G8ET", name: "Different title" }, items);
  assert.equal(matched.outcome, "MATCHED");
  if (matched.outcome === "MATCHED") assert.equal(matched.sku, "SW-24");

  const duplicate = matchStoreProduct({ sku: "SW-24" }, [
    identity({ storeProductId: "41", sku: "SW-24" }),
    identity({ storeProductId: "42", sku: "SW-24" }),
  ]);
  assert.equal(duplicate.outcome, "MATCH_REVIEW_REQUIRED");

  const fuzzy = matchStoreProduct({ name: "Lenovo ThinkBook 16" }, [
    identity({ storeProductId: "9", sku: "TB-16", name: "Lenovo ThinkBook 16 G9" }),
  ]);
  assert.equal(fuzzy.outcome, "MATCH_REVIEW_REQUIRED");

  const created = matchStoreProduct({ manufacturerPartNumber: "NEW-999", barcode: "6009999999999" }, items);
  assert.equal(created.outcome, "HIGH_CONFIDENCE_NEW");

  const unnamed = matchStoreProduct({ name: "Cable" }, items);
  assert.equal(unnamed.outcome, "MATCH_REVIEW_REQUIRED");
});

test("uses a confirmed supplier sku mapping and ignores a fuzzy name match for merging", () => {
  const items = [identity({ storeProductId: "41", sku: "SW-24", name: "Lenovo ThinkBook 16 G9" })];
  const confirmed = new Map([["FRONTOSA-1", "41"]]);
  const matched = matchStoreProduct({ supplierSku: "frontosa-1", name: "Something else" }, items, confirmed);
  assert.equal(matched.outcome, "MATCHED");
  if (matched.outcome === "MATCHED") assert.equal(matched.by, "supplierSku");
  assert.equal(sharesDuplicateKey(
    { skuKey: "SW-24", mpnKey: "", barcodeKey: "", brandModelKey: "" },
    { skuKey: "SW-24", mpnKey: "OTHER", barcodeKey: "", brandModelKey: "" },
  ), true);
});

test("recommends a review for duplicates and missing images", () => {
  assert.match(recommendedCatalogueAction({ duplicateKinds: "sku", skuKey: "SW-24", mpnKey: "", imageCount: 1, unitPriceCents: 100 }), /duplicate/i);
  assert.match(recommendedCatalogueAction({ duplicateKinds: "", skuKey: "SW-24", mpnKey: "MPN", imageCount: 0, unitPriceCents: 100 }), /image/i);
});

test("uses the selected supplier quantity instead of adding every supplier together", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");
  const offer = (overrides: Partial<SupplierChoice>): SupplierChoice => ({
    supplierId: "a",
    costCents: 1000,
    costKnown: true,
    stockQty: 4,
    stockKnown: true,
    updatedAt: now,
    preference: 0,
    leadTimeDays: 2,
    priceFreshMs: 60 * 60 * 1000,
    ...overrides,
  });
  const selected = selectedSupplierStock([
    offer({ supplierId: "cheap", costCents: 500, stockQty: 4 }),
    offer({ supplierId: "other", costCents: 900, stockQty: 9 }),
  ], now);
  assert.equal(selected, 4);
  assert.equal(selectedSupplierStock([
    offer({ stockQty: 0, costKnown: false, costCents: null }),
    offer({ supplierId: "b", stockQty: 0, costKnown: false, costCents: null, preference: 3 }),
  ], now), 0);
  assert.equal(selectedSupplierStock([
    offer({ updatedAt: new Date("2026-09-01T12:00:00.000Z"), stockQty: 8 }),
  ], now), null);
});
