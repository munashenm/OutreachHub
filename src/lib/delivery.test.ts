import assert from "node:assert/strict";
import test from "node:test";
import { addDeliveryRow, emptyDelivery, replyRate } from "./delivery";

test("counts sent, failed, skipped, and replies separately", () => {
  const counts = emptyDelivery();
  addDeliveryRow(counts, { direction: "OUTBOUND", status: "SENT", count: 4 });
  addDeliveryRow(counts, { direction: "OUTBOUND", status: "FAILED", count: 1 });
  addDeliveryRow(counts, { direction: "OUTBOUND", status: "SKIPPED", count: 2 });
  addDeliveryRow(counts, { direction: "INBOUND", status: "SENT", count: 1 });
  assert.deepEqual(counts, { sent: 4, failed: 1, skipped: 2, replies: 1 });
  assert.equal(replyRate(counts), 0.25);
});

test("omits a reply rate when nothing has been sent", () => {
  assert.equal(replyRate(emptyDelivery()), null);
});
