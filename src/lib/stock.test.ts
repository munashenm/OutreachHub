import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicHttpsUrl, isShortStock, linesExceedingStock, markedUpCents, parseProductImageUrls, parseSupplierStockBody, priceAllowedByMargin, quoteMarginBlock, sellMarginPercent, stockLeft, stockLevel, storePushErrorMessage, storeRequestShouldRetry } from "./stock";
import { AppError } from "./errors";

test("adds a percentage markup to a supplier cost", () => {
  assert.equal(markedUpCents(10000, 15), 11500);
  assert.equal(markedUpCents(89900, 0), 89900);
  assert.equal(markedUpCents(10000, -1), null);
});

test("retries a shop connection timeout and keeps a rejected key", () => {
  const timeout = new TypeError("fetch failed");
  timeout.cause = Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" });
  assert.equal(storeRequestShouldRetry(timeout), true);
  assert.equal(storeRequestShouldRetry(new AppError("The store rejected the API key.")), false);
});

test("names a website timeout instead of a catalogue rejection", () => {
  assert.equal(storePushErrorMessage(new AppError("The store returned 422.")), "The store returned 422.");
  const timeout = new TypeError("fetch failed");
  timeout.cause = new Error("Connect Timeout Error");
  assert.match(storePushErrorMessage(timeout), /could not reach the Urban Focus website/);
});

test("keeps a line under the minimum margin off the customer quotation", () => {
  assert.equal(sellMarginPercent(225, 281), 19);
  assert.equal(sellMarginPercent(51500, 64375), 20);
  assert.match(quoteMarginBlock(225, 281, 20) ?? "", /19% margin/);
  assert.equal(quoteMarginBlock(51500, 64375, 20), null);
  assert.equal(quoteMarginBlock(null, 281, 20), null);
  assert.equal(quoteMarginBlock(225, 281, 0), null);
});

test("keeps a supplier price that is below the minimum margin off the store", () => {
  assert.equal(priceAllowedByMargin(8000, 10000, 25), false);
  assert.equal(priceAllowedByMargin(8000, 10000, 20), true);
  assert.equal(priceAllowedByMargin(8000, 10000, 0), true);
});

test("sums supplier quantities into a stock level", () => {
  assert.equal(stockLevel([4, 2.9, 0]), 6);
  assert.equal(stockLevel([-3, 5]), 5);
});

test("subtracts quoted quantities from the stock level", () => {
  assert.equal(stockLeft(10, 4), 6);
  assert.equal(stockLeft(10, 1.2), 8);
  assert.equal(stockLeft(3, 5), 0);
});

test("marks a tracked product short only when nothing is left", () => {
  assert.equal(isShortStock(0, 0, false), false);
  assert.equal(isShortStock(0, 0, true), true);
  assert.equal(isShortStock(4, 4, false), true);
  assert.equal(isShortStock(4, 1, true), false);
});

test("flags a draft quotation that asks for more than is left", () => {
  const left = new Map([["sw", 2]]);
  assert.deepEqual(linesExceedingStock([
    { productId: "sw", quantity: 1 },
    { productId: "sw", quantity: 2 },
    { productId: null, quantity: 9 },
  ], left), ["sw"]);
  assert.deepEqual(linesExceedingStock([{ productId: "sw", quantity: 2 }], left), []);
});

test("reads supplier stock JSON and skips a row without a SKU", () => {
  const parsed = parseSupplierStockBody({
    items: [
      { sku: "SW-24", cost: "899.00", stock: 4 },
      { supplierSku: "SW-24", cost: 900, stock: 2 },
      { stock: 1 },
    ],
  });
  assert.equal(parsed.error, null);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0]?.stockQty, 2);
  assert.equal(parsed.items[0]?.costCents, 90000);
});

test("accepts a public https feed and rejects a private address", () => {
  assert.equal(assertPublicHttpsUrl("https://supplier.example/stock").hostname, "supplier.example");
  assert.throws(() => assertPublicHttpsUrl("http://supplier.example/stock"));
  assert.throws(() => assertPublicHttpsUrl("https://127.0.0.1/stock"));
  assert.throws(() => assertPublicHttpsUrl("https://10.0.0.5/stock"));
});

test("reads public product image addresses and skips blanks", () => {
  assert.deepEqual(parseProductImageUrls("https://cdn.example/a.jpg\n\nhttps://cdn.example/a.jpg\nhttps://cdn.example/b.jpg"), [
    "https://cdn.example/a.jpg",
    "https://cdn.example/b.jpg",
  ]);
  assert.throws(() => parseProductImageUrls("http://cdn.example/a.jpg"));
  assert.throws(() => parseProductImageUrls(Array.from({ length: 9 }, (_, index) => `https://cdn.example/${index}.jpg`).join("\n")));
});
