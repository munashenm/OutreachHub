import assert from "node:assert/strict";
import test from "node:test";
import { planProspectImport } from "./import-plan";

const valid = {
  firstname: "Ada",
  lastname: "Lovelace",
  email: "Ada@Example.com",
  leadstatus: "NEW",
  marketingstatus: "CONSENTED",
};

test("normalises email and accepts a new prospect", () => {
  const plan = planProspectImport([valid], new Set());
  assert.equal(plan.ready.length, 1);
  assert.equal(plan.ready[0].prospect.email, "ada@example.com");
  assert.equal(plan.rejected.length, 0);
});

test("rejects emails that already exist or repeat in the file", () => {
  const plan = planProspectImport(
    [valid, { ...valid, firstname: "Augusta" }, { ...valid, email: "ada@example.com" }],
    new Set(["ada@example.com"]),
  );
  assert.equal(plan.ready.length, 0);
  assert.equal(plan.rejected.length, 3);
  assert.match(plan.rejected[0].reason, /already exists/i);
  assert.match(plan.rejected[1].reason, /duplicated/i);
});

test("rejects an invalid row without importing it", () => {
  const plan = planProspectImport([{ ...valid, email: "not-an-email" }], new Set());
  assert.equal(plan.ready.length, 0);
  assert.match(plan.rejected[0].reason, /email/i);
});
