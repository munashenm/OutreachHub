import assert from "node:assert/strict";
import test from "node:test";
import { renderTemplate } from "./merge";

test("replaces known merge tags and keeps unknown ones", () => {
  const result = renderTemplate("Hello {{firstName}} at {{companyName}} {{unknown}}", {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    companyName: "Northwind",
    jobTitle: "Manager",
  });
  assert.equal(result, "Hello Ada at Northwind {{unknown}}");
});
