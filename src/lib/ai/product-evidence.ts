import { completeStructured, logAiUse } from "./rfq-analyzer";
import { compareRequirement, type ProductRequirement, type SourcingCandidate } from "../sourcing";
import type { ObservedProduct } from "../external-search";

export type SelectionDecision = {
  requirementIndex: number;
  evidenceId: string;
  meetsMandatory: boolean;
  reason: string;
};

const SELECTION_INSTRUCTIONS = [
  "You select products for an Urban Focus quotation from evidence that was actually retrieved.",
  "Each evidence card has an id, name, specifications, source URL, listed price, stock, and warranty copied from that source.",
  "Do not invent a product, price, stock quantity, warranty, or specification.",
  "If evidence is missing for a requirement, request at most two searches. Each search query names the product and the mandatory specification.",
  "A selection must use an evidence id from the cards. Set meetsMandatory to false when a mandatory specification is absent from that card.",
  "A laptop and a charger or power supply are different requirements.",
  "Prefer a South African source when the evidence is otherwise equal. An international source stays selectable when its price currency and delivery evidence are present.",
].join(" ");

const SELECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["searches", "selections"],
  properties: {
    searches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: { query: { type: "string" } },
      },
    },
    selections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requirementIndex", "evidenceId", "meetsMandatory", "reason"],
        properties: {
          requirementIndex: { type: "integer" },
          evidenceId: { type: "string" },
          meetsMandatory: { type: "boolean" },
          reason: { type: "string" },
        },
      },
    },
  },
};

export function candidateFromObservation(product: ObservedProduct, pageUrl: string): SourcingCandidate {
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  return {
    sourceKind: "EXTERNAL_SOURCE",
    sourceName: host,
    sourceUrl: pageUrl,
    sourceType: "RETAILER",
    productId: null,
    name: product.name,
    brand: product.brand,
    model: product.model || product.name,
    sku: product.sku,
    mpn: product.mpn,
    specifications: product.specifications,
    costExVatCents: null,
    listedPriceCents: product.listedPriceCents,
    vatIncluded: product.vatIncluded === true,
    vatKnown: product.vatIncluded != null,
    shippingCents: 0,
    procurementCents: 0,
    importCents: 0,
    riskPercent: 0,
    markupPercent: 25,
    stockQty: product.stockQty,
    stockKnown: product.stockQty != null || /instock|in stock/i.test(product.availability),
    fresh: true,
    checkedAt: new Date().toISOString(),
    reputable: true,
  };
}

export function applyModelSelection(requirements: ProductRequirement[], evidence: SourcingCandidate[], decisions: SelectionDecision[]) {
  const cards = evidence.map((candidate, index) => ({ id: `e${index}`, candidate }));
  const byId = new Map(cards.map((card) => [card.id, card.candidate]));
  const accepted: SourcingCandidate[] = [];
  for (const decision of decisions) {
    if (!decision.meetsMandatory) continue;
    const candidate = byId.get(decision.evidenceId);
    const requirement = requirements[decision.requirementIndex];
    if (!candidate || !requirement) continue;
    if (failsHardSpecification(requirement, candidate)) continue;
    if (!accepted.includes(candidate)) accepted.push(candidate);
  }
  return accepted;
}

export function selectionIsNeeded(requirements: ProductRequirement[], candidates: SourcingCandidate[]) {
  return requirements.some((requirement) => {
    const viable = candidates.filter((candidate) => candidate.vatKnown !== false && compareRequirement(requirement, candidate) !== "DOES_NOT_MEET");
    if (viable.length !== 1) return true;
    return viable[0]?.sourceKind === "EXTERNAL_SOURCE";
  });
}

export function evidenceCards(evidence: SourcingCandidate[]) {
  return evidence.map((candidate, index) => ({
    id: `e${index}`,
    name: candidate.name,
    specifications: candidate.specifications,
    sourceName: candidate.sourceName,
    sourceUrl: candidate.sourceUrl,
    sourceKind: candidate.sourceKind,
    listedPriceCents: candidate.listedPriceCents,
    costExVatCents: candidate.costExVatCents,
    stockQty: candidate.stockQty,
    vatKnown: candidate.vatKnown !== false,
    leadTimeDays: candidate.leadTimeDays ?? null,
  }));
}

export async function assistProductSelection(input: {
  requirements: ProductRequirement[];
  evidence: SourcingCandidate[];
  searchOnline: (query: string) => Promise<SourcingCandidate[]>;
}, deps?: { fetchImpl?: typeof fetch; apiKey?: string; model?: string }) {
  const cache = new Map<string, SourcingCandidate[]>();
  let evidence = [...input.evidence];
  const first = await selectionCall(input.requirements, evidence, deps);
  if (!first) return { ok: false as const, accepted: [] as SourcingCandidate[], searched: false, reviewReason: "Product comparison was not confirmed. The RFQ was kept for internal review." };
  let decisions = first.selections;
  let searched = false;
  const queries = first.searches.map((search) => search.query.trim()).filter((query) => query.length >= 3).slice(0, 2);
  if (queries.length > 0) {
    searched = true;
    for (const query of queries) {
      const key = query.toLowerCase();
      if (cache.has(key)) continue;
      const found = await input.searchOnline(query);
      cache.set(key, found);
      evidence = [...evidence, ...found];
    }
    const second = await selectionCall(input.requirements, evidence, deps);
    if (!second) return { ok: false as const, accepted: [], searched, reviewReason: "Retrieved products could not be compared. The RFQ was kept for internal review." };
    decisions = second.selections;
  }
  const accepted = applyModelSelection(input.requirements, evidence, decisions);
  logAiUse({ purpose: "selection", invoked: true, success: accepted.length > 0, reviewReason: accepted.length > 0 ? "selected" : "No retrieved product met the mandatory specification." });
  return { ok: true as const, accepted, searched, reviewReason: accepted.length > 0 ? "" : "No retrieved product met the mandatory specification." };
}

async function selectionCall(requirements: ProductRequirement[], evidence: SourcingCandidate[], deps?: { fetchImpl?: typeof fetch; apiKey?: string; model?: string }) {
  const content = JSON.stringify({
    requirements: requirements.map((requirement, index) => ({
      index,
      quantity: requirement.quantity,
      productType: requirement.productType,
      brand: requirement.brandPreference,
      model: requirement.model,
      sku: requirement.sku,
      mpn: requirement.mpn,
      processor: requirement.processor,
      ramGb: requirement.ramGb,
      storageGb: requirement.storageGb,
      operatingSystem: requirement.operatingSystem,
      requestedText: requirement.requestedText.slice(0, 400),
    })),
    evidence: evidenceCards(evidence),
  });
  const raw = await completeStructured({
    instructions: SELECTION_INSTRUCTIONS,
    content,
    schemaName: "product_selection",
    schema: SELECTION_SCHEMA,
    purpose: "selection",
  }, deps);
  return parseSelection(raw);
}

function parseSelection(raw: unknown): { searches: Array<{ query: string }>; selections: SelectionDecision[] } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const searches = Array.isArray(record.searches) ? record.searches.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const query = "query" in entry && typeof entry.query === "string" ? entry.query.slice(0, 160) : "";
    return query ? [{ query }] : [];
  }) : [];
  const selections = Array.isArray(record.selections) ? record.selections.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const decision = entry as Record<string, unknown>;
    if (typeof decision.requirementIndex !== "number" || !Number.isInteger(decision.requirementIndex)) return [];
    if (typeof decision.evidenceId !== "string" || typeof decision.meetsMandatory !== "boolean") return [];
    return [{
      requirementIndex: decision.requirementIndex,
      evidenceId: decision.evidenceId,
      meetsMandatory: decision.meetsMandatory,
      reason: typeof decision.reason === "string" ? decision.reason.slice(0, 240) : "",
    }];
  }) : [];
  return { searches, selections };
}

function failsHardSpecification(requirement: ProductRequirement, candidate: SourcingCandidate) {
  const hard = Boolean(requirement.processor || requirement.ramGb || requirement.storageGb || requirement.operatingSystem || requirement.screenInches);
  if (!hard) return false;
  return compareRequirement(requirement, candidate) === "DOES_NOT_MEET";
}
