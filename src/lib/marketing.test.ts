import assert from "node:assert/strict";
import test from "node:test";
import { marketingBlockReason, requiresSuppression } from "./marketing";

test("blocks opted out, blocked, and bounced prospects", () => {
  assert.match(marketingBlockReason("OPTED_OUT", false) ?? "", /opted out/i);
  assert.match(marketingBlockReason("BLOCKED", false) ?? "", /blocked/i);
  assert.match(marketingBlockReason("BOUNCED", false) ?? "", /bounced/i);
});

test("blocks a consented address that is on the suppression list", () => {
  assert.match(marketingBlockReason("CONSENTED", true) ?? "", /suppression list/i);
});

test("allows consented prospects who are not suppressed", () => {
  assert.equal(marketingBlockReason("CONSENTED", false), null);
  assert.equal(marketingBlockReason("EXISTING_CUSTOMER", false), null);
  assert.equal(marketingBlockReason("UNKNOWN", false), null);
});

test("only opt-out and blocked statuses create suppression records", () => {
  assert.equal(requiresSuppression("OPTED_OUT"), true);
  assert.equal(requiresSuppression("BLOCKED"), true);
  assert.equal(requiresSuppression("BOUNCED"), false);
  assert.equal(requiresSuppression("CONSENTED"), false);
});
