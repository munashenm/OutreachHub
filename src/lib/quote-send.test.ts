import assert from "node:assert/strict";
import test from "node:test";
import { classifySendFailure, quoteSendKey, retryDelayMs } from "./quote-send";

test("a Gmail timeout stays unknown and a definite rejection can be retried", () => {
  assert.equal(classifySendFailure(Object.assign(new Error("The request timed out"), { status: 408 })), "UNKNOWN");
  assert.equal(classifySendFailure(Object.assign(new Error("upstream"), { status: 503 })), "UNKNOWN");
  assert.equal(classifySendFailure(new Error("fetch failed")), "UNKNOWN");
  assert.equal(classifySendFailure(Object.assign(new Error("Invalid recipient"), { status: 400 })), "FAILED_CONFIRMED");
});

test("quote send retries use the existing delay schedule and then stop", () => {
  assert.equal(retryDelayMs(1), 60_000);
  assert.equal(retryDelayMs(2), 5 * 60_000);
  assert.equal(retryDelayMs(3), 15 * 60_000);
  assert.equal(retryDelayMs(4), 60 * 60_000);
  assert.equal(retryDelayMs(5), 4 * 60 * 60_000);
  assert.equal(retryDelayMs(6), null);
  assert.equal(quoteSendKey("quote-1", 1), "QUOTE_SEND:quote-1:1");
});
