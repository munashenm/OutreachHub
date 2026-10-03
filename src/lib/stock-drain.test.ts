import assert from "node:assert/strict";
import test from "node:test";
import {
  stockDrainTimedOut,
  stockPushTotals,
  stockPushWritesContent,
  stockRunShouldContinue,
  stockWebsiteAction,
} from "./stock-drain";

test("updates an existing website product and holds a supplier product that is not on the website", () => {
  assert.equal(stockWebsiteAction(true, ""), "update-stock");
  assert.equal(stockWebsiteAction(true, "PUBLISH"), "update-stock");
  assert.equal(stockWebsiteAction(false, "PUBLISH"), "create");
  assert.equal(stockWebsiteAction(false, "NEW_PRODUCT_REVIEW_REQUIRED"), "hold");
  assert.equal(stockWebsiteAction(false, ""), "hold");
});

test("stock sync does not replace website catalogue content for a product that already exists", () => {
  assert.equal(stockPushWritesContent("update-stock"), false);
  assert.equal(stockPushWritesContent("hold"), false);
  assert.equal(stockPushWritesContent("create"), true);
});

test("counts a drained batch and leaves the unfinished remainder queued", () => {
  const totals = stockPushTotals({ pending: 100, succeeded: 38, failed: 1, heldLocally: 2, pricesHeld: 0, remaining: 59 });
  assert.deepEqual(totals, {
    pending: 100,
    processed: 41,
    succeeded: 38,
    failed: 1,
    heldLocally: 2,
    pricesHeld: 0,
    remaining: 59,
  });
  assert.equal(stockDrainTimedOut(1_000, 1_000), true);
  assert.equal(stockDrainTimedOut(999, 1_000), false);
  assert.equal(stockRunShouldContinue({ remaining: 59, stopReason: "budget", error: null }), true);
  assert.equal(stockRunShouldContinue({ remaining: 59, stopReason: "website-unreachable", error: "timed out" }), false);
  assert.equal(stockRunShouldContinue({ remaining: 0, stopReason: null, error: null }), false);
});
