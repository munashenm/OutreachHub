import assert from "node:assert/strict";
import test from "node:test";
import { mailboxAddress, odataString } from "./microsoft";

test("prefers the mailbox mail address over the sign-in name", () => {
  assert.equal(mailboxAddress("Ada@Company.com", "ada@company.onmicrosoft.com"), "ada@company.com");
  assert.equal(mailboxAddress("", "ada@company.onmicrosoft.com"), "ada@company.onmicrosoft.com");
  assert.equal(mailboxAddress(null, "not-an-email"), null);
});

test("escapes quotes in an OData filter value", () => {
  assert.equal(odataString("AAQk'id"), "'AAQk''id'");
});
