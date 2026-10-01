import assert from "node:assert/strict";
import test from "node:test";
import { SOUTH_AFRICAN_DISTRIBUTORS, distributorKey, missingDistributors } from "./distributors";

test("lists the South African distributors without feed addresses", () => {
  assert.deepEqual(
    SOUTH_AFRICAN_DISTRIBUTORS.map((distributor) => distributor.name),
    ["Miro", "Scoop", "Pinnacle", "Frontosa", "SMD Technologies", "Mustek", "Astrum", "DCC", "Axiz", "Rectron", "Tarsus", "Linkqage", "First Distribution", "Syntech"],
  );
  assert.equal(new Set(SOUTH_AFRICAN_DISTRIBUTORS.map((distributor) => distributor.country)).size, 1);
  assert.equal(SOUTH_AFRICAN_DISTRIBUTORS[0]?.country, "South Africa");
  assert.equal(SOUTH_AFRICAN_DISTRIBUTORS.some((distributor) => /https?:\/\//i.test(distributor.notes)), false);
});

test("treats common spellings as the same distributor", () => {
  assert.equal(distributorKey("Axis"), distributorKey("Axiz"));
  assert.equal(distributorKey("SMD Tecnologies"), distributorKey("SMD Technologies"));
  assert.equal(distributorKey("First Distrubution"), distributorKey("First Distribution"));
  const missing = missingDistributors(["Scoop", "Axis", "DCC Technologies"]);
  assert.equal(missing.some((distributor) => distributor.name === "Scoop"), false);
  assert.equal(missing.some((distributor) => distributor.name === "Axiz"), false);
  assert.equal(missing.some((distributor) => distributor.name === "DCC"), false);
  assert.equal(missing.some((distributor) => distributor.name === "Miro"), true);
});
