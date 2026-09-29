import assert from "node:assert/strict";
import test from "node:test";
import { readUnsubscribeToken, signUnsubscribeToken, withUnsubscribeFooter } from "./unsubscribe";

test("appends an unsubscribe link without dropping the message", () => {
  const body = withUnsubscribeFooter("Hello Ada", "https://app.example/unsubscribe?token=abc");
  assert.match(body, /^Hello Ada/);
  assert.match(body, /https:\/\/app\.example\/unsubscribe\?token=abc/);
});

test("round-trips an unsubscribe token", async () => {
  process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-chars";
  const token = await signUnsubscribeToken({
    workspaceId: "ws_1",
    prospectId: "pr_1",
    campaignId: "ca_1",
  });
  const parsed = await readUnsubscribeToken(token);
  assert.deepEqual(parsed, { workspaceId: "ws_1", prospectId: "pr_1", campaignId: "ca_1" });
  assert.equal(await readUnsubscribeToken("not-a-token"), null);
});
