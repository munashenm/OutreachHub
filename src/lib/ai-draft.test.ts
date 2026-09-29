import assert from "node:assert/strict";
import test from "node:test";
import { parseDraft } from "./ai-draft";

test("reads a JSON draft", () => {
  const draft = parseDraft('{"subject":"Quick question","body":"Hello {{firstName}}"}');
  assert.deepEqual(draft, { subject: "Quick question", body: "Hello {{firstName}}" });
});

test("reads a fenced JSON draft", () => {
  const draft = parseDraft('```json\n{"subject":"Hello","body":"Line one"}\n```');
  assert.equal(draft?.subject, "Hello");
  assert.equal(draft?.body, "Line one");
});

test("rejects a draft without a subject or body", () => {
  assert.equal(parseDraft('{"subject":"","body":"Hello"}'), null);
  assert.equal(parseDraft("not json"), null);
});
