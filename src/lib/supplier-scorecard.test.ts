import assert from "node:assert/strict";
import test from "node:test";
import { classifySupplier, emptyScores, type SupplierScores } from "./supplier-scorecard";

function scores(value: number, patch: Partial<SupplierScores> = {}): SupplierScores {
  return {
    grossMargin: value,
    moq: value,
    feedAvailability: value,
    deliveryToSouthAfrica: value,
    warrantyRma: value,
    certifications: value,
    resellerProtection: value,
    productUniqueness: value,
    localCompetition: value,
    ...patch,
  };
}

test("a scorecard stays unscored until every criterion has a score", () => {
  const result = classifySupplier({ ...emptyScores(), grossMargin: 5 });
  assert.equal(result.supplierClass, "UNSCORED");
  assert.equal(result.points, null);
});

test("a strong scorecard is a preferred supplier", () => {
  const result = classifySupplier(scores(4));
  assert.equal(result.supplierClass, "PREFERRED");
  assert.equal(result.points, 80);
});

test("an even mid score is a backup supplier", () => {
  const result = classifySupplier(scores(3));
  assert.equal(result.supplierClass, "BACKUP");
  assert.equal(result.points, 60);
});

test("a weak margin, warranty, or feed is rejected even when the rest is strong", () => {
  assert.equal(classifySupplier(scores(5, { grossMargin: 1 })).supplierClass, "REJECT");
  assert.equal(classifySupplier(scores(5, { warrantyRma: 1 })).supplierClass, "REJECT");
  assert.equal(classifySupplier(scores(5, { feedAvailability: 1 })).supplierClass, "REJECT");
});

test("a distinctive range with a weak feed is project only", () => {
  const result = classifySupplier(scores(4, { productUniqueness: 5, feedAvailability: 2 }));
  assert.equal(result.supplierClass, "PROJECT_ONLY");
  assert.match(result.reason, /distinctive/);
});

test("a score between a reject and a backup is project only", () => {
  const result = classifySupplier(scores(3, { grossMargin: 2 }));
  assert.equal(result.supplierClass, "PROJECT_ONLY");
  assert.match(result.reason, /standing backup/);
});

test("a low overall score is rejected", () => {
  const result = classifySupplier(scores(2));
  assert.equal(result.supplierClass, "REJECT");
  assert.equal(result.points, 40);
});
