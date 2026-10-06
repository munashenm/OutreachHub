import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTACHMENT_CLARIFICATION,
  CLARIFICATION_REPLY,
  compareRequirement,
  exclusiveFromListed,
  extractProductRequirements,
  landedCostCents,
  planSourcing,
  requirementSummary,
  type SourcingCandidate,
  type SourcingPools,
} from "./sourcing";

const margins = { minimumMarginPercent: 20, autoQuoteMarginPercent: 20, autoSendMarginPercent: 25 };
const now = new Date("2026-10-01T18:00:00.000Z");

const candidate = (overrides: Partial<SourcingCandidate>): SourcingCandidate => ({
  sourceKind: "SUPPLIER_FEED",
  sourceName: "Supplier feed",
  sourceUrl: "",
  sourceType: "DISTRIBUTOR",
  productId: "prod-1",
  name: "Lenovo ThinkPad E14",
  brand: "Lenovo",
  model: "ThinkPad E14",
  sku: "E14",
  mpn: "E14G7",
  specifications: "Intel Core i5, 16GB RAM, 512GB SSD, Windows 11 Pro, 14 inch",
  costExVatCents: 1000000,
  listedPriceCents: null,
  vatIncluded: false,
  shippingCents: 0,
  procurementCents: 0,
  importCents: 0,
  riskPercent: 0,
  markupPercent: 25,
  stockQty: 20,
  stockKnown: true,
  fresh: true,
  checkedAt: now.toISOString(),
  reputable: true,
  ...overrides,
});

const emptyPools = (): SourcingPools => ({ catalogue: [], supplierFeeds: [], supplierApis: [], external: [] });

test("specification RFQ finds a model that meets the request", () => {
  const [requirement] = extractProductRequirements("Please quote 10 business laptops:\nCore i5\n16GB RAM\n512GB SSD\nWindows 11 Pro\n14 inch.");
  assert.equal(requirement?.quantity, 10);
  assert.equal(requirement?.processor, "Core i5");
  assert.equal(requirement?.ramGb, 16);
  assert.equal(requirement?.storageGb, 512);
  assert.equal(requirement?.storageType, "SSD");
  assert.equal(requirement?.operatingSystem, "Windows 11 Pro");
  assert.equal(requirement?.screenInches, 14);
  assert.equal(requirement?.sku, "");
  const below = candidate({
    name: "Basic laptop",
    model: "",
    specifications: "Core i5, 8GB RAM, 256GB SSD, Windows 11 Home",
    productId: "low",
  });
  const match = candidate({
    name: "Lenovo ThinkPad E14 Gen 7",
    model: "ThinkPad E14 Gen 7",
    specifications: "Intel Core i5-1335U, 16GB RAM, 512GB NVMe, Windows 11 Pro, 14 inch",
  });
  assert.equal(compareRequirement(requirement!, below), "DOES_NOT_MEET");
  assert.equal(compareRequirement(requirement!, match), "MEETS_REQUIREMENT");
  const upgrade = candidate({
    productId: "upgrade",
    name: "Lenovo ThinkPad E14 Core i7",
    model: "",
    specifications: "Core i7, 16GB RAM, 512GB SSD, Windows 11 Pro, 14 inch",
    costExVatCents: 1200000,
  });
  const plan = planSourcing({
    requirements: [requirement!],
    pools: { ...emptyPools(), supplierFeeds: [below, upgrade, match] },
    ...margins,
    now,
  });
  assert.equal(plan.kind, "QUOTE");
  if (plan.kind !== "QUOTE") return;
  assert.equal(plan.options[0]?.name, "Lenovo ThinkPad E14 Gen 7");
  assert.match(plan.options[0]?.specifications ?? "", /16GB RAM/);
  assert.equal(plan.options[0]?.quantity, 10);
  assert.equal(plan.options.some((option) => option.name === "Basic laptop"), false);
});

test("a named laptop is not quoted as a larger unrelated product", () => {
  const [requirement] = extractProductRequirements("Please quote 2 x Lenovo ThinkPad E14.");
  const panel = candidate({
    name: "Linkbasic 19-inch Rack Mount 1U Blank Panel",
    brand: "",
    model: "",
    sku: "LB-BLANK-19",
    mpn: "",
    specifications: "19 inch",
    costExVatCents: 8750,
    stockQty: 384,
    productId: "panel",
  });
  assert.equal(compareRequirement(requirement!, panel), "DOES_NOT_MEET");
  const plan = planSourcing({
    requirements: [requirement!],
    pools: { ...emptyPools(), catalogue: [panel] },
    ...margins,
    now,
  });
  assert.equal(plan.kind, "SOURCING");
});

test("existing named product is quoted from catalogue or supplier stock", () => {
  const [requirement] = extractProductRequirements("Please quote 2 x Lenovo ThinkPad E14.");
  assert.equal(requirement?.quantity, 2);
  assert.match(requirement?.model ?? "", /ThinkPad E14/i);
  const plan = planSourcing({
    requirements: [requirement!],
    pools: { ...emptyPools(), catalogue: [candidate({ sourceKind: "URBAN_FOCUS_CATALOGUE", sourceType: "INTERNAL", stockQty: 4 })] },
    ...margins,
    now,
  });
  assert.equal(plan.kind, "QUOTE");
  if (plan.kind !== "QUOTE") return;
  assert.match(plan.options[0]?.name ?? "", /ThinkPad E14/);
  assert.equal(plan.options[0]?.sourceKind, "URBAN_FOCUS_CATALOGUE");
});

test("out of stock continues to another supplier instead of stopping", () => {
  const [requirement] = extractProductRequirements("Please quote 2 x Lenovo ThinkPad E14.");
  const out = candidate({ sourceName: "Supplier A", stockQty: 0, productId: "a" });
  const other = candidate({ sourceName: "Supplier B", sourceKind: "SUPPLIER_API", stockQty: 6, productId: "b", costExVatCents: 980000 });
  const plan = planSourcing({
    requirements: [requirement!],
    pools: { ...emptyPools(), supplierFeeds: [out], supplierApis: [other] },
    ...margins,
    now,
  });
  assert.equal(plan.kind, "QUOTE");
  if (plan.kind !== "QUOTE") return;
  assert.equal(plan.options[0]?.sourceName, "Supplier B");
  assert.match(plan.options[0]?.name ?? "", /ThinkPad E14/);
  assert.equal(plan.options[0]?.stockQty, 6);
});

test("a preferred supplier is quoted ahead of a cheaper backup, and a rejected supplier is left out", () => {
  const [requirement] = extractProductRequirements("Please quote 2 x Lenovo ThinkPad E14.");
  const preferred = candidate({ sourceName: "Preferred", costExVatCents: 1100000, supplierClass: "PREFERRED", productId: "preferred" });
  const backup = candidate({ sourceName: "Backup", costExVatCents: 900000, supplierClass: "BACKUP", productId: "backup" });
  const rejected = candidate({ sourceName: "Rejected", costExVatCents: 700000, supplierClass: "REJECT", productId: "rejected" });
  const plan = planSourcing({
    requirements: [requirement!],
    pools: { ...emptyPools(), supplierFeeds: [rejected, backup, preferred] },
    ...margins,
    now,
  });
  assert.equal(plan.kind, "QUOTE");
  if (plan.kind !== "QUOTE") return;
  assert.equal(plan.options[0]?.sourceName, "Preferred");
  const onlyRejected = planSourcing({
    requirements: [requirement!],
    pools: { ...emptyPools(), supplierFeeds: [rejected] },
    ...margins,
    now,
  });
  assert.equal(onlyRejected.kind, "SOURCING");
});

test("a supplier row that is not an Urban Focus product can still be quoted", () => {
  const [requirement] = extractProductRequirements("Please quote 2 x Lenovo ThinkPad E14.");
  const plan = planSourcing({
    requirements: [requirement!],
    pools: {
      ...emptyPools(),
      supplierFeeds: [candidate({ productId: null, sourceName: "Distributor", sku: "SUP-E14" })],
    },
    ...margins,
    now,
  });
  assert.equal(plan.kind, "QUOTE");
  if (plan.kind !== "QUOTE") return;
  assert.equal(plan.options[0]?.productId, null);
  assert.equal(plan.options[0]?.sourceName, "Distributor");
  assert.match(plan.options[0]?.name ?? "", /ThinkPad E14/);
});

test("a missing catalogue SKU can be drafted from a verified external source", () => {
  const [requirement] = extractProductRequirements("Please quote 5 x SKU-77881.");
  assert.equal(requirement?.sku, "SKU-77881");
  assert.equal(requirement?.quantity, 5);
  const external = candidate({
    sourceKind: "EXTERNAL_SOURCE",
    sourceType: "DISTRIBUTOR",
    sourceName: "Authorised distributor",
    sourceUrl: "https://distributor.example/sku-77881",
    name: "HP ProBook 440",
    model: "ProBook 440",
    sku: "SKU-77881",
    specifications: "HP ProBook 440",
    costExVatCents: null,
    listedPriceCents: 1000000,
    vatIncluded: false,
    stockQty: 8,
    checkedAt: now.toISOString(),
    reputable: true,
  });
  const stale = { ...external, sourceUrl: "https://distributor.example/old", checkedAt: "2026-09-01T00:00:00.000Z", listedPriceCents: 500000 };
  const plan = planSourcing({
    requirements: [requirement!],
    pools: { ...emptyPools(), external: [stale, external] },
    ...margins,
    now,
    freshnessMs: 24 * 60 * 60 * 1000,
  });
  assert.equal(plan.kind, "QUOTE");
  if (plan.kind !== "QUOTE") return;
  assert.equal(plan.send, false);
  assert.equal(plan.options[0]?.name, "HP ProBook 440");
  assert.equal(plan.options[0]?.sourceKind, "EXTERNAL_SOURCE");
  assert.equal(plan.options[0]?.sourceUrl, "https://distributor.example/sku-77881");
  assert.equal(plan.options[0]?.checkedAt, now.toISOString());
});

test("a vague server request asks for the missing configuration", () => {
  const [requirement] = extractProductRequirements("Please quote 10 servers.");
  assert.equal(requirement?.quantity, 10);
  assert.equal(requirement?.productType, "Server");
  const plan = planSourcing({ requirements: [requirement!], pools: emptyPools(), ...margins, now });
  assert.equal(plan.kind, "CLARIFICATION");
  if (plan.kind !== "CLARIFICATION") return;
  assert.equal(plan.message, CLARIFICATION_REPLY);
});

test("external retail price is converted once and held for approval", () => {
  const [requirement] = extractProductRequirements("Please quote 4 business laptops:\nCore i5\n16GB RAM\n512GB SSD\nWindows 11 Pro\n14 inch.");
  const retail = candidate({
    sourceKind: "EXTERNAL_SOURCE",
    sourceType: "RETAILER",
    sourceName: "Established SA retailer",
    sourceUrl: "https://retailer.example/thinkpad-e14",
    name: "Lenovo ThinkPad E14 Gen 7",
    model: "ThinkPad E14 Gen 7",
    sku: "",
    specifications: "Core i5, 16GB RAM, 512GB SSD, Windows 11 Pro, 14 inch",
    costExVatCents: null,
    listedPriceCents: 1_000_000,
    vatIncluded: true,
    markupPercent: 26,
    stockQty: 4,
    checkedAt: now.toISOString(),
  });
  const exclusive = exclusiveFromListed(1_000_000, true);
  assert.equal(exclusive, 869565);
  const landed = landedCostCents(exclusive ?? 0, { shippingCents: 0, procurementCents: 0, importCents: 0, riskPercent: 0 });
  assert.equal(landed, 869565);
  const plan = planSourcing({
    requirements: [requirement!],
    pools: { ...emptyPools(), external: [retail] },
    ...margins,
    now,
  });
  assert.equal(plan.kind, "QUOTE");
  if (plan.kind !== "QUOTE") return;
  assert.equal(plan.send, false);
  assert.equal(plan.options[0]?.sourceKind, "EXTERNAL_SOURCE");
  assert.notEqual(plan.options[0]?.unitPriceCents, 1_000_000);
  assert.equal(plan.options[0]?.costStatus, "NEEDS_REVIEW");
  assert.ok((plan.options[0]?.unitPriceCents ?? 0) > landed);
});

test("a tender specification across bullet lines is read without using the tender number as the quantity", () => {
  const [requirement] = extractProductRequirements(`URGENT RFQ – ECPT Tender SCMU12-26/27-0003
The required laptop configuration includes:
Windows 11 Pro 64-bit
Intel Core Ultra 7 155H
16GB DDR5 RAM
512GB PCIe NVMe SSD
14-inch touchscreen display`);
  assert.equal(requirement?.quantity, null);
  assert.equal(requirement?.processor, "Core Ultra 7");
  assert.equal(requirement?.ramGb, 16);
  assert.equal(requirement?.storageGb, 512);
  assert.equal(requirement?.storageType, "SSD");
  assert.equal(requirement?.operatingSystem, "Windows 11 Pro");
  assert.equal(requirement?.screenInches, 14);
  assert.equal(requirementSummary(requirement!), "Laptop, Core Ultra 7, 16GB RAM, 512GB SSD, 14 inch, Windows 11 Pro");
  const noted = planSourcing({ requirements: [requirement!], pools: emptyPools(), ...margins, now });
  assert.equal(noted.kind, "SOURCING");
  const attached = extractProductRequirements("Please quote 4 business laptops. The specification is attached.")[0];
  const plan = planSourcing({ requirements: attached ? [attached] : [], pools: emptyPools(), ...margins, now });
  assert.equal(plan.kind, "CLARIFICATION");
  if (plan.kind !== "CLARIFICATION") return;
  assert.equal(plan.message, ATTACHMENT_CLARIFICATION);
});

test("a website ThinkPad title meets the tender specification and is not priced without a supplier cost", () => {
  const [requirement] = extractProductRequirements(`URGENT RFQ – ECPT Tender SCMU12-26/27-0003
The required laptop configuration includes:
Windows 11 Pro 64-bit
Intel Core Ultra 7 155H
16GB DDR5 RAM
512GB PCIe NVMe SSD
14-inch touchscreen display`);
  const website = candidate({
    sourceKind: "URBAN_FOCUS_CATALOGUE",
    sourceName: "Urban Focus",
    sourceType: "INTERNAL",
    productId: null,
    name: "Lenovo ThinkPad T14 Gen 6 Intel Core Ultra 7 16GB 512GB Win 11 Pro",
    brand: "Lenovo",
    model: "21QC000YZA",
    sku: "21QC000YZA",
    mpn: "21QC000YZA",
    specifications: "Lenovo ThinkPad T14 Gen 6 Intel Core Ultra 7 16GB 512GB Win 11 Pro",
    costExVatCents: null,
    stockQty: 2,
    fresh: true,
  });
  assert.equal(compareRequirement(requirement!, website), "MEETS_REQUIREMENT");
  const plan = planSourcing({
    requirements: [requirement!],
    pools: { ...emptyPools(), catalogue: [website] },
    ...margins,
    now,
  });
  assert.equal(plan.kind, "SOURCING");
});
