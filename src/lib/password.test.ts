import assert from "node:assert/strict";
import test from "node:test";
import { passwordIssue, safeNextPath, slugify } from "./password";

test("requires a letter, a number, and 10 characters", () => {
  assert.match(passwordIssue("short1") ?? "", /10 characters/);
  assert.match(passwordIssue("longpassword") ?? "", /letter and one number/);
  assert.equal(passwordIssue("longpassword1"), null);
});

test("rejects open redirects", () => {
  assert.equal(safeNextPath("https://evil.example"), "/dashboard");
  assert.equal(safeNextPath("//evil.example"), "/dashboard");
  assert.equal(safeNextPath("/prospects?q=ada"), "/prospects?q=ada");
});

test("slugifies workspace names", () => {
  assert.equal(slugify("Urban Focus"), "urban-focus");
  assert.equal(slugify("***"), "workspace");
});
