import { priceQuotation } from "./automation";
import { equivalentsRejected, isRecommendationRequest, quoteOptionCount, requestStrictness } from "./rfq-match";
import { supplierClassRank, type SupplierClass } from "./supplier-scorecard";

export const CLARIFICATION_REPLY = "Thank you for your request. To prepare an accurate quotation, could you please confirm the required processor, RAM, storage configuration and operating system?";
export const ATTACHMENT_CLARIFICATION = "The specification appears to be in an attachment. Please paste the required make, model or specification, and the quantity, into your reply so we can quote it.";
export const QUANTITY_CLARIFICATION = "The specification is noted. Please confirm the quantity to quote.";
export const SOURCING_REPLY = "Thank you. We have received your request and are sourcing the requested configuration. We will send the quotation once current availability and pricing have been confirmed.";

export type SourceKind = "URBAN_FOCUS_CATALOGUE" | "SUPPLIER_FEED" | "SUPPLIER_API" | "EXTERNAL_SOURCE";
export type MatchGrade = "EXACT" | "MEETS_REQUIREMENT" | "EXCEEDS_REQUIREMENT" | "PARTIAL" | "DOES_NOT_MEET";
export type SourceConfidence = "HIGH" | "MEDIUM" | "LOW";
export type SourceType = "MANUFACTURER" | "DISTRIBUTOR" | "RETAILER" | "INTERNAL" | "OTHER";

export type ProductRequirement = {
  productType: string;
  quantity: number | null;
  brandPreference: string;
  processor: string;
  processorGeneration: string;
  ramGb: number | null;
  storageGb: number | null;
  storageType: string;
  screenInches: number | null;
  operatingSystem: string;
  graphics: string;
  ports: string;
  networking: string;
  warranty: string;
  formFactor: string;
  colour: string;
  requiredCertifications: string;
  deliveryLocation: string;
  requiredDate: string;
  otherRequirements: string;
  sku: string;
  mpn: string;
  model: string;
  requestedText: string;
};

export type SourcingCandidate = {
  sourceKind: SourceKind;
  sourceName: string;
  sourceUrl: string;
  sourceType: SourceType;
  productId: string | null;
  name: string;
  brand: string;
  model: string;
  sku: string;
  mpn: string;
  specifications: string;
  costExVatCents: number | null;
  listedPriceCents: number | null;
  vatIncluded: boolean;
  shippingCents: number;
  procurementCents: number;
  importCents: number;
  riskPercent: number;
  markupPercent: number;
  stockQty: number | null;
  stockKnown: boolean;
  fresh: boolean;
  checkedAt: string | null;
  reputable: boolean;
  supplierClass?: SupplierClass;
  leadTimeDays?: number | null;
};

export type SourcingPools = {
  catalogue: SourcingCandidate[];
  supplierFeeds: SourcingCandidate[];
  supplierApis: SourcingCandidate[];
  external: SourcingCandidate[];
};

export type PricedSource = {
  role: "Recommended" | "Alternative" | "Upgrade";
  name: string;
  specifications: string;
  quantity: number;
  unitPriceCents: number;
  sourceKind: SourceKind;
  sourceName: string;
  sourceUrl: string;
  checkedAt: string | null;
  match: MatchGrade;
  confidence: SourceConfidence;
  costStatus: "VERIFIED" | "NEEDS_REVIEW";
  canSend: boolean;
  stockQty: number | null;
  productId: string | null;
};

export type SourcingPlan =
  | { kind: "CLARIFICATION"; message: string }
  | { kind: "SOURCING"; message: string; note: string }
  | { kind: "STAFF_REVIEW"; note: string }
  | { kind: "QUOTE"; send: boolean; note: string; options: PricedSource[] };

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20,
};

const SOURCE_ORDER: SourceKind[] = ["URBAN_FOCUS_CATALOGUE", "SUPPLIER_FEED", "SUPPLIER_API", "EXTERNAL_SOURCE"];
const GRADE_ORDER: MatchGrade[] = ["EXACT", "MEETS_REQUIREMENT", "EXCEEDS_REQUIREMENT"];

export function emptyRequirement(requestedText = ""): ProductRequirement {
  return {
    productType: "",
    quantity: null,
    brandPreference: "",
    processor: "",
    processorGeneration: "",
    ramGb: null,
    storageGb: null,
    storageType: "",
    screenInches: null,
    operatingSystem: "",
    graphics: "",
    ports: "",
    networking: "",
    warranty: "",
    formFactor: "",
    colour: "",
    requiredCertifications: "",
    deliveryLocation: "",
    requiredDate: "",
    otherRequirements: "",
    sku: "",
    mpn: "",
    model: "",
    requestedText,
  };
}

export function extractProductRequirements(body: string): ProductRequirement[] {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const groups: string[][] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) groups.push(current);
    current = [];
  };
  for (const line of lines) {
    if (/^(regards|thanks|thank you|kind regards)\b/i.test(line)) {
      flush();
      continue;
    }
    if (isRequestLine(line)) {
      flush();
      current = [line];
      continue;
    }
    if (current.length > 0) current.push(line);
  }
  flush();
  return groups.map((group) => requirementFromText(group.join("\n"))).filter(requirementIsUseful);
}

export function parseRequirementFragment(text: string): ProductRequirement | null {
  const requirement = requirementFromText(text);
  return requirementIsUseful(requirement) ? requirement : null;
}

function requirementIsUseful(item: ProductRequirement) {
  return item.quantity != null || Boolean(item.model || item.sku || item.productType);
}

export function requirementSummary(requirement: ProductRequirement) {
  return [
    requirement.brandPreference,
    requirement.model || requirement.productType,
    requirement.processor,
    requirement.ramGb == null ? "" : `${requirement.ramGb}GB RAM`,
    requirement.storageGb == null ? "" : `${requirement.storageGb}GB ${requirement.storageType}`.trim(),
    requirement.screenInches == null ? "" : `${requirement.screenInches} inch`,
    requirement.operatingSystem,
  ].filter(Boolean).join(", ").slice(0, 300);
}

export function requirementIsVague(requirement: ProductRequirement) {
  if (isRecommendationRequest(requirement.requestedText) && (requirement.productType || /\blaptops?|notebooks?|servers?|switches?\b/i.test(requirement.requestedText))) return false;
  if (requirement.sku || requirement.mpn || requirement.model) return false;
  const specified = [requirement.processor, requirement.ramGb, requirement.storageGb, requirement.operatingSystem, requirement.screenInches, requirement.graphics].filter((value) => value != null && value !== "").length;
  return specified < 2;
}

export function requirementAwaitingQuantity(requirement: ProductRequirement | undefined) {
  if (!requirement || requirement.quantity != null || requirement.sku || requirement.mpn || requirement.model) return false;
  if (isRecommendationRequest(requirement.requestedText)) return false;
  return !requirementIsVague(requirement);
}

export function sourcingCacheKey(requirement: ProductRequirement) {
  if (requirement.sku) return `sku:${requirement.sku.toLowerCase()}`;
  if (requirement.mpn) return `mpn:${requirement.mpn.toLowerCase()}`;
  const parts = [
    requirement.productType,
    requirement.processor,
    requirement.processorGeneration,
    requirement.ramGb == null ? "" : `${requirement.ramGb}gb`,
    requirement.storageGb == null ? "" : `${requirement.storageGb}gb`,
    requirement.storageType,
    requirement.screenInches == null ? "" : `${requirement.screenInches}in`,
    requirement.operatingSystem,
    requirement.model,
  ].filter(Boolean);
  return `spec:${parts.join("|").toLowerCase()}`;
}

export function isSourcingFresh(checkedAt: Date, now: Date, maxAgeMs: number) {
  return now.getTime() - checkedAt.getTime() <= maxAgeMs && now.getTime() >= checkedAt.getTime();
}

export function exclusiveFromListed(listedPriceCents: number, vatIncluded: boolean) {
  if (!Number.isInteger(listedPriceCents) || listedPriceCents <= 0) return null;
  return vatIncluded ? Math.round((listedPriceCents * 100) / 115) : listedPriceCents;
}

export function landedCostCents(costExVatCents: number, allowances: { shippingCents: number; procurementCents: number; importCents: number; riskPercent: number }) {
  const base = costExVatCents + Math.max(0, allowances.shippingCents) + Math.max(0, allowances.procurementCents) + Math.max(0, allowances.importCents);
  const risk = Math.min(100, Math.max(0, allowances.riskPercent));
  return Math.round((base * (100 + risk)) / 100);
}

export function compareRequirement(requirement: ProductRequirement, candidate: SourcingCandidate): MatchGrade {
  const offered = specsFromText(`${candidate.name} ${candidate.model} ${candidate.specifications}`);
  const identityRequested = Boolean(requirement.sku || requirement.mpn || requirement.model);
  const identity = identityMatches(requirement, candidate);
  if (identityRequested && !identity && !hasComparableSpecs(requirement)) return "DOES_NOT_MEET";
  const fields: Array<"MEETS" | "EXCEEDS" | "MISS" | "FAIL"> = [];
  const push = (result: "MEETS" | "EXCEEDS" | "MISS" | "FAIL" | "SKIP") => {
    if (result !== "SKIP") fields.push(result);
  };
  push(compareProcessor(requirement.processor, offered.processor));
  push(compareNumber(requirement.ramGb, offered.ramGb));
  push(compareStorage(requirement, offered));
  push(compareScreen(requirement.screenInches, offered.screenInches));
  push(compareOs(requirement.operatingSystem, offered.operatingSystem));
  if (fields.includes("FAIL")) return "DOES_NOT_MEET";
  if (fields.includes("MISS")) return "PARTIAL";
  if (fields.length === 0) return identity ? "EXACT" : "DOES_NOT_MEET";
  if (identity && !fields.includes("EXCEEDS")) return "EXACT";
  if (identityRequested && !identity && screenIsTheOnlySpec(requirement)) return "DOES_NOT_MEET";
  if (fields.includes("EXCEEDS")) return "EXCEEDS_REQUIREMENT";
  return "MEETS_REQUIREMENT";
}

export function planSourcing(input: {
  requirements: ProductRequirement[];
  pools: SourcingPools;
  minimumMarginPercent: number;
  autoQuoteMarginPercent: number;
  autoSendMarginPercent: number;
  now?: Date;
  freshnessMs?: number;
}): SourcingPlan {
  const now = input.now ?? new Date();
  const freshnessMs = input.freshnessMs ?? 24 * 60 * 60 * 1000;
  if (input.requirements.length === 0) {
    return { kind: "SOURCING", message: SOURCING_REPLY, note: "The request did not state a quantity and a product or specification, so sourcing is still open." };
  }
  if (input.requirements.some(requirementIsVague)) {
    return { kind: "CLARIFICATION", message: CLARIFICATION_REPLY };
  }
  const priced: PricedSource[] = [];
  for (const requirement of input.requirements) {
    const found = chooseSources(requirement, input.pools, now, freshnessMs, input);
    if (found.blocked) return { kind: "STAFF_REVIEW", note: found.blocked };
    if (found.options.length === 0) {
      return { kind: "SOURCING", message: SOURCING_REPLY, note: "No in-stock source meets the specification yet. Sourcing is continuing." };
    }
    priced.push(...found.options);
  }
  const catalogueBacked = priced.every((option) => option.sourceKind !== "EXTERNAL_SOURCE");
  const send = priced.length > 0 && priced.every((option) => option.canSend) && catalogueBacked;
  return {
    kind: "QUOTE",
    send,
    note: send ? "A catalogue or supplier product meets the request, so the quotation can be sent." : "A sourced quotation is ready for approval.",
    options: priced.slice(0, 3),
  };
}

function chooseSources(requirement: ProductRequirement, pools: SourcingPools, now: Date, freshnessMs: number, margins: { minimumMarginPercent: number; autoQuoteMarginPercent: number; autoSendMarginPercent: number }) {
  const internal = [...pools.catalogue, ...pools.supplierFeeds, ...pools.supplierApis];
  const found = selectSources(requirement, internal, now, freshnessMs, margins);
  if (found.options.length > 0 || found.blocked) return found;
  return selectSources(requirement, pools.external, now, freshnessMs, margins);
}

function selectSources(requirement: ProductRequirement, candidates: SourcingCandidate[], now: Date, freshnessMs: number, margins: { minimumMarginPercent: number; autoQuoteMarginPercent: number; autoSendMarginPercent: number }) {
  const quantity = Math.max(1, requirement.quantity ?? 1);
  const text = requirement.requestedText;
  const strictness = requestStrictness(text, Boolean(requirement.sku || requirement.mpn || requirement.model));
  const rejected = strictness === "EXACT" || equivalentsRejected(text);
  const recommendation = strictness === "RECOMMENDATION";
  const optionCount = quoteOptionCount(text);
  const usable = candidates.filter((candidate) => candidate.supplierClass !== "REJECT" && usableCandidate(candidate, now, freshnessMs) && candidate.stockKnown && candidate.stockQty != null && candidate.stockQty >= quantity && candidate.fresh && canPrice(candidate));
  const chosen = recommendation && optionCount >= 2
    ? priceLevels(usable.filter((candidate) => recommendationEligible(requirement, candidate)), optionCount)
    : firstStage(requirement, usable, rejected, recommendation);
  return priceSelection(requirement, chosen, quantity, margins, optionCount);
}

function firstStage(requirement: ProductRequirement, candidates: SourcingCandidate[], rejected: boolean, recommendation: boolean) {
  const stages: Array<{ limit: number; match: (candidate: SourcingCandidate) => boolean }> = [];
  if (requirement.sku || requirement.mpn) stages.push({ limit: 1, match: (candidate) => identitySku(requirement, candidate) });
  if (requirement.model && !recommendation) stages.push({ limit: 1, match: (candidate) => exactModel(requirement, candidate) });
  if (!rejected && requirement.model) stages.push({ limit: 1, match: (candidate) => fuzzyModel(requirement, candidate) });
  const identityRequested = Boolean(requirement.sku || requirement.mpn || requirement.model);
  if (!(rejected && identityRequested)) stages.push({ limit: 1, match: (candidate) => specificationMatch(requirement, candidate) });
  if (!rejected) stages.push({ limit: 1, match: (candidate) => suitableAlternative(requirement, candidate) });
  for (const stage of stages) {
    const found = candidates.filter(stage.match);
    if (found.length === 0) continue;
    return sortCandidates(requirement, found).slice(0, stage.limit);
  }
  return [];
}

function priceSelection(requirement: ProductRequirement, candidates: SourcingCandidate[], quantity: number, margins: { minimumMarginPercent: number; autoQuoteMarginPercent: number; autoSendMarginPercent: number }, optionCount: number) {
  const options: PricedSource[] = [];
  let blocked = "";
  for (const candidate of candidates) {
    const grade = quoteGrade(requirement, candidate);
    const priced = priceCandidate(requirement, candidate, grade, optionCount >= 2 ? Math.max(1, requirement.quantity ?? 1) : quantity, margins);
    if (!priced) continue;
    if (priced.marginBelowMinimum) {
      blocked = "The margin is below the minimum, so the quotation was not created.";
      continue;
    }
    options.push(priced.option);
  }
  if (options.length > 1) {
    options.forEach((option, index) => {
      option.role = index === 0 ? "Recommended" : "Alternative";
    });
  }
  if (options.length === 0 && blocked) return { options: [], blocked };
  return { options, blocked: "" };
}

function sortCandidates(requirement: ProductRequirement, candidates: SourcingCandidate[]) {
  const gradeFor = (candidate: SourcingCandidate) => quoteGrade(requirement, candidate);
  return [...candidates].sort((left, right) => {
    const source = SOURCE_ORDER.indexOf(left.sourceKind) - SOURCE_ORDER.indexOf(right.sourceKind);
    if (source !== 0) return source;
    const grade = GRADE_ORDER.indexOf(gradeFor(left)) - GRADE_ORDER.indexOf(gradeFor(right));
    if (grade !== 0) return grade;
    const points = candidateScore(requirement, right) - candidateScore(requirement, left);
    if (points !== 0) return points;
    const rank = supplierClassRank(left.supplierClass) - supplierClassRank(right.supplierClass);
    if (rank !== 0) return rank;
    const price = priceOf(left) - priceOf(right);
    if (price !== 0) return price;
    return (left.leadTimeDays ?? 999) - (right.leadTimeDays ?? 999);
  });
}

function priceLevels(candidates: SourcingCandidate[], count: number) {
  const priced = candidates.map((candidate) => ({ candidate, price: priceOf(candidate) })).filter((item) => item.price > 0).sort((left, right) => left.price - right.price);
  if (priced.length === 0) return [];
  if (count < 2 || priced.length === 1) return [priced[0].candidate];
  const cheap = priced[0];
  const dear = [...priced].reverse().find((item) => item.price > cheap.price);
  return dear ? [cheap.candidate, dear.candidate] : [cheap.candidate];
}

export function candidateScore(requirement: ProductRequirement, candidate: SourcingCandidate) {
  const offered = specsFromText(`${candidate.name} ${candidate.model} ${candidate.specifications}`);
  let points = 0;
  const award = (result: string, meet: number, exceed: number) => {
    if (result === "MEETS") points += meet;
    if (result === "EXCEEDS") points += exceed;
  };
  award(compareProcessor(requirement.processor, offered.processor), 20, 14);
  award(compareNumber(requirement.ramGb, offered.ramGb), 15, 12);
  award(compareStorage(requirement, offered), 15, 12);
  award(compareScreen(requirement.screenInches, offered.screenInches), 8, 6);
  award(compareOs(requirement.operatingSystem, offered.operatingSystem), 20, 0);
  if (requirement.warranty && `${candidate.name} ${candidate.specifications}`.toLowerCase().includes(requirement.warranty.toLowerCase())) points += 8;
  if (candidate.stockKnown && candidate.stockQty != null && candidate.stockQty >= Math.max(1, requirement.quantity ?? 1)) points += 10;
  if (candidate.leadTimeDays != null && candidate.leadTimeDays >= 0) points += Math.max(0, 10 - Math.min(10, candidate.leadTimeDays));
  return points;
}

export function requirementsFromSources(body: string, attachment: string): ProductRequirement[] {
  const fromBody = extractProductRequirements(body);
  const supplement = attachment.trim() ? requirementFromText(attachment) : emptyRequirement();
  const supplementUseful = meaningfulRequirement(supplement);
  if (fromBody.length === 0) {
    const fromAttachment = extractProductRequirements(attachment);
    if (fromAttachment.length > 0) return fromAttachment;
    return supplementUseful ? [supplement] : [];
  }
  if (!supplementUseful) return fromBody;
  return fromBody.map((requirement) => fillRequirement(requirement, supplement));
}

function meaningfulRequirement(requirement: ProductRequirement) {
  return requirementIsUseful(requirement) || hasComparableSpecs(requirement);
}

function fillRequirement(primary: ProductRequirement, extra: ProductRequirement): ProductRequirement {
  const filled = { ...primary };
  const keys = ["productType", "brandPreference", "processor", "processorGeneration", "storageType", "operatingSystem", "graphics", "ports", "networking", "warranty", "formFactor", "colour", "requiredCertifications", "sku", "mpn", "model"] as const;
  for (const key of keys) if (!filled[key] && extra[key]) filled[key] = extra[key];
  if (filled.quantity == null && extra.quantity != null) filled.quantity = extra.quantity;
  if (filled.ramGb == null && extra.ramGb != null) filled.ramGb = extra.ramGb;
  if (filled.storageGb == null && extra.storageGb != null) filled.storageGb = extra.storageGb;
  if (filled.screenInches == null && extra.screenInches != null) filled.screenInches = extra.screenInches;
  if (extra.requestedText.trim()) filled.requestedText = `${primary.requestedText}\n${extra.requestedText}`.slice(0, 800);
  return filled;
}

function canPrice(candidate: SourcingCandidate) {
  if ((candidate.costExVatCents ?? 0) > 0) return true;
  return (candidate.listedPriceCents ?? 0) > 0 && (candidate.sourceKind === "URBAN_FOCUS_CATALOGUE" || candidate.sourceKind === "EXTERNAL_SOURCE");
}

function priceOf(candidate: SourcingCandidate) {
  if (candidate.sourceKind === "URBAN_FOCUS_CATALOGUE" && (candidate.listedPriceCents ?? 0) > 0) return candidate.listedPriceCents ?? 0;
  return candidate.costExVatCents ?? candidate.listedPriceCents ?? 0;
}

function identitySku(requirement: ProductRequirement, candidate: SourcingCandidate) {
  const offered = [candidate.sku, candidate.mpn].map((value) => value.toLowerCase());
  const sku = requirement.sku.toLowerCase();
  const mpn = requirement.mpn.toLowerCase();
  return Boolean((sku && offered.includes(sku)) || (mpn && offered.includes(mpn)));
}

function exactModel(requirement: ProductRequirement, candidate: SourcingCandidate) {
  const wanted = requirement.model.toLowerCase().replace(/\s+/g, " ").trim();
  if (wanted.length < 4) return false;
  return `${candidate.name} ${candidate.model}`.toLowerCase().includes(wanted);
}

function fuzzyModel(requirement: ProductRequirement, candidate: SourcingCandidate) {
  const generic = new Set(["thinkpad", "laptop", "lenovo", "notebook", "probook", "elitebook", "dell", "asus", "hp"]);
  const tokens = requirement.model.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 2 && !generic.has(token));
  if (tokens.length === 0) return false;
  const hay = `${candidate.name} ${candidate.model} ${candidate.sku}`.toLowerCase();
  return tokens.every((token) => hay.includes(token));
}

function specificationMatch(requirement: ProductRequirement, candidate: SourcingCandidate) {
  if (!hasComparableSpecs(requirement)) return false;
  const grade = compareRequirement(requirement, candidate);
  return grade === "EXACT" || grade === "MEETS_REQUIREMENT" || grade === "EXCEEDS_REQUIREMENT";
}

function suitableAlternative(requirement: ProductRequirement, candidate: SourcingCandidate) {
  if (isRecommendationRequest(requirement.requestedText)) return recommendationEligible(requirement, candidate);
  if (!(requirement.model || requirement.sku || requirement.mpn)) return false;
  return specificationMatch(requirement, candidate);
}

function recommendationEligible(requirement: ProductRequirement, candidate: SourcingCandidate) {
  const blob = `${candidate.name} ${candidate.brand} ${candidate.model} ${candidate.specifications}`;
  const wantsLaptop = requirement.productType === "Laptop" || /\blaptops?|notebooks?\b/i.test(requirement.requestedText);
  if (wantsLaptop && !/\blaptops?|notebooks?|thinkpad|probook|elitebook|latitude\b/i.test(blob)) return false;
  if (/\b(professional|programming|business)\b/i.test(requirement.requestedText) && !/\b(thinkpad|probook|elitebook|latitude|expertbook|precision|zbook)\b/i.test(blob)) return false;
  const probe = { ...requirement, model: "", sku: "", mpn: "" };
  if (hasComparableSpecs(probe)) {
    const grade = compareRequirement(probe, candidate);
    return grade === "EXACT" || grade === "MEETS_REQUIREMENT" || grade === "EXCEEDS_REQUIREMENT";
  }
  return wantsLaptop || Boolean(requirement.productType);
}

function quoteGrade(requirement: ProductRequirement, candidate: SourcingCandidate): MatchGrade {
  if (identitySku(requirement, candidate) || exactModel(requirement, candidate)) {
    const grade = compareRequirement(requirement, candidate);
    return grade === "DOES_NOT_MEET" || grade === "PARTIAL" ? "EXACT" : grade;
  }
  const probe = { ...requirement, model: "", sku: "", mpn: "" };
  if (hasComparableSpecs(probe)) {
    const grade = compareRequirement(probe, candidate);
    if (grade === "EXACT" || grade === "MEETS_REQUIREMENT" || grade === "EXCEEDS_REQUIREMENT") return grade;
  }
  return "MEETS_REQUIREMENT";
}

function priceCandidate(requirement: ProductRequirement, candidate: SourcingCandidate, grade: MatchGrade, quantity: number, margins: { minimumMarginPercent: number; autoQuoteMarginPercent: number; autoSendMarginPercent: number }) {
  const published = candidate.sourceKind === "URBAN_FOCUS_CATALOGUE" && (candidate.listedPriceCents ?? 0) > 0 ? candidate.listedPriceCents : null;
  if (published) {
    if ((candidate.costExVatCents ?? 0) > 0) {
      const margin = ((published - (candidate.costExVatCents ?? 0)) / published) * 100;
      if (margin < margins.minimumMarginPercent) return { marginBelowMinimum: true as const, option: null };
    }
    return {
      marginBelowMinimum: false as const,
      option: {
        role: grade === "EXCEEDS_REQUIREMENT" ? "Upgrade" as const : "Recommended" as const,
        name: candidate.name,
        specifications: candidate.specifications,
        quantity,
        unitPriceCents: published,
        sourceKind: candidate.sourceKind,
        sourceName: candidate.sourceName,
        sourceUrl: candidate.sourceUrl,
        checkedAt: candidate.checkedAt,
        match: grade,
        confidence: "HIGH" as const,
        costStatus: "VERIFIED" as const,
        canSend: true,
        stockQty: candidate.stockQty,
        productId: candidate.productId,
      },
    };
  }
  const external = candidate.sourceKind === "EXTERNAL_SOURCE";
  const listed = candidate.listedPriceCents;
  const exclusive = external ? exclusiveFromListed(listed ?? 0, candidate.vatIncluded) : candidate.costExVatCents;
  if (exclusive == null || exclusive <= 0) return null;
  const costExVatCents = external
    ? landedCostCents(exclusive, { shippingCents: candidate.shippingCents, procurementCents: candidate.procurementCents, importCents: candidate.importCents, riskPercent: candidate.riskPercent })
    : exclusive;
  const decision = priceQuotation({
    costExVatCents,
    markupPercent: candidate.markupPercent,
    minimumMarginPercent: margins.minimumMarginPercent,
    autoQuoteMarginPercent: margins.autoQuoteMarginPercent,
    autoSendMarginPercent: margins.autoSendMarginPercent,
    fresh: true,
    stockKnown: true,
    stockQty: candidate.stockQty,
    requestedQty: quantity,
    abnormalPriceChange: false,
  });
  if (decision.decision === "MARGIN_WARNING" || decision.sellExVatCents == null) return { marginBelowMinimum: true as const, option: null };
  const sellIncl = decision.sellInclVatCents ?? 0;
  const marketIncl = candidate.vatIncluded ? listed ?? 0 : Math.round(((listed ?? 0) * 115) / 100);
  const aboveMarket = external && candidate.sourceType === "RETAILER" && marketIncl > 0 && sellIncl > Math.round(marketIncl * 1.15);
  const confidence = sourceConfidence(requirement, candidate, grade);
  const differentModel = Boolean(requirement.model) && !identityMatches(requirement, candidate);
  const role: PricedSource["role"] = grade === "EXCEEDS_REQUIREMENT" ? "Upgrade" : differentModel ? "Alternative" : "Recommended";
  const verified = !aboveMarket && confidence !== "LOW";
  const canSend = verified && confidence === "HIGH" && decision.decision === "AUTO_QUOTE" && (decision.marginPercent ?? -1) >= margins.autoSendMarginPercent && (grade === "EXACT" || grade === "MEETS_REQUIREMENT") && role === "Recommended";
  return {
    marginBelowMinimum: false as const,
    option: {
      role,
      name: candidate.name,
      specifications: candidate.specifications,
      quantity,
      unitPriceCents: decision.sellExVatCents,
      sourceKind: candidate.sourceKind,
      sourceName: candidate.sourceName,
      sourceUrl: candidate.sourceUrl,
      checkedAt: candidate.checkedAt,
      match: grade,
      confidence,
      costStatus: verified ? "VERIFIED" as const : "NEEDS_REVIEW" as const,
      canSend,
      stockQty: candidate.stockQty,
      productId: candidate.productId,
    },
  };
}

function sourceConfidence(requirement: ProductRequirement, candidate: SourcingCandidate, grade: MatchGrade): SourceConfidence {
  if (!candidate.reputable || !candidate.fresh || !candidate.stockKnown) return "LOW";
  const identity = Boolean(requirement.sku || requirement.mpn) && identityMatches(requirement, candidate);
  if (candidate.sourceKind === "EXTERNAL_SOURCE") {
    if (!candidate.sourceUrl || !candidate.checkedAt) return "LOW";
    if (identity && grade === "EXACT") return "HIGH";
    if (grade === "EXACT" || grade === "MEETS_REQUIREMENT" || grade === "EXCEEDS_REQUIREMENT") return "MEDIUM";
    return "LOW";
  }
  if (grade === "EXACT" || grade === "MEETS_REQUIREMENT") return "HIGH";
  if (grade === "EXCEEDS_REQUIREMENT") return "MEDIUM";
  return "LOW";
}

function usableCandidate(candidate: SourcingCandidate, now: Date, freshnessMs: number) {
  if (candidate.sourceKind !== "EXTERNAL_SOURCE") return true;
  if (!candidate.sourceUrl || !candidate.checkedAt || candidate.listedPriceCents == null || candidate.listedPriceCents <= 0) return false;
  return isSourcingFresh(new Date(candidate.checkedAt), now, freshnessMs);
}

function isRequestLine(line: string) {
  if (/\b(recommend(?:ation)?s?|suitable options?|or equivalent)\b/i.test(line)) return true;
  return (/\b(?:quote|need|pricing|rfq)\b/i.test(line) && hasQuantity(line)) || /^\s*\d+\s*[x×]\b/i.test(line);
}

function hasQuantity(line: string) {
  return /\b\d+\b/.test(stripSpecNumbers(line)) || /\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty)\b/i.test(line);
}

function requirementFromText(text: string): ProductRequirement {
  const requirement = emptyRequirement(text.slice(0, 800));
  const specs = specsFromText(text);
  requirement.processor = specs.processor;
  requirement.ramGb = specs.ramGb;
  requirement.storageGb = specs.storageGb;
  requirement.storageType = specs.storageType;
  requirement.screenInches = specs.screenInches;
  requirement.operatingSystem = specs.operatingSystem;
  requirement.processorGeneration = text.match(/\b(\d+)(?:st|nd|rd|th)\s+gen(?:eration)?\b/i)?.[1] ?? text.match(/\bgen(?:eration)?\s*(\d+)\b/i)?.[1] ?? "";
  requirement.graphics = text.match(/\b(rtx\s*\d{3,4}|radeon\s*\w+|intel\s+iris|integrated graphics)\b/i)?.[1] ?? "";
  requirement.warranty = text.match(/\b(\d+\s*(?:year|yr)s?\s+warranty)\b/i)?.[1] ?? "";
  requirement.formFactor = /\b(laptop|notebook)\b/i.test(text) ? "laptop" : /\bdesktop\b/i.test(text) ? "desktop" : "";
  requirement.colour = text.match(/\b(black|silver|grey|gray|white)\b/i)?.[1] ?? "";
  const brand = text.match(/\b(lenovo|hp|dell|asus|acer|apple|microsoft)\b/i)?.[1] ?? "";
  requirement.brandPreference = brand ? brand[0].toUpperCase() + brand.slice(1).toLowerCase() : "";
  if (/\blaptops?|notebooks?\b/i.test(text)) requirement.productType = "Laptop";
  else if (/\bservers?\b/i.test(text)) requirement.productType = "Server";
  else if (/\bswitches?\b/i.test(text)) requirement.productType = "Switch";
  const model = text.match(/\b((?:thinkpad|latitude|alienware|probook|elitebook|precision|inspiron|xps)\s+[a-z]?\d{2,4}[a-z0-9]*)\b/i)?.[0] ?? "";
  requirement.model = model;
  const labelled = text.match(/\b(?:sku|mpn|part(?:\s*number)?)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})\b/i)?.[1] ?? "";
  const afterQuantity = text.match(/(?:^|\s)[x×]\s+([A-Z0-9][A-Z0-9-]{2,})/i)?.[1] ?? "";
  const sku = labelled || (/\d/.test(afterQuantity) ? afterQuantity : "");
  if (sku && !/thinkpad/i.test(sku)) requirement.sku = sku.toUpperCase();
  requirement.quantity = quantityFrom(text);
  return requirement;
}

function quantityFrom(text: string) {
  const stripped = stripSpecNumbers(text);
  const explicit = stripped.match(/\b(\d+)\s*[x×]\b/i) ?? stripped.match(/\b(?:quote|supply(?:\s+of)?|order(?:\s+of)?|need|qty|quantity)\s*[:#]?\s*(\d+)\b/i);
  if (explicit?.[1]) return boundedQuantity(Number(explicit[1]));
  const word = stripped.match(/\b(?:quote|supply|order|need|for)\s+(one|two|three|four|five|six|seven|eight|nine|ten|twenty)\b/i);
  if (word?.[1]) return NUMBER_WORDS[word[1].toLowerCase()] ?? null;
  return null;
}

function boundedQuantity(quantity: number) {
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 100000) return null;
  return quantity;
}

function stripSpecNumbers(text: string) {
  return text
    .replace(/\bcore\s+ultra\s+[3579]\b/gi, " ")
    .replace(/\bcore\s+i[3579](?:\s*-\s*\d{3,5}\w*)?/gi, " ")
    .replace(/\b\d+\s*gb(?:\s+ddr\d+)?\s*(?:ram|memory)\b/gi, " ")
    .replace(/\b\d+\s*(?:gb|tb)(?:\s+pcie)?\s*(?:ssd|nvme|hdd)\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:-| )?\s*(?:inch|inches|")/gi, " ")
    .replace(/\bwindows\s+11(?:\s+(?:pro|home))?\b/gi, " ");
}

type ParsedSpecs = {
  processor: string;
  ramGb: number | null;
  storageGb: number | null;
  storageType: string;
  screenInches: number | null;
  operatingSystem: string;
};

function specsFromText(text: string): ParsedSpecs {
  const ram = text.match(/\b(\d+)\s*gb(?:\s+ddr\d+)?\s*(?:ram|memory)\b/i) ?? text.match(/\b(?:memory|ram)\s*[:\-]?\s*(\d+)\s*gb\b/i);
  const disk = text.match(/\b(\d+)\s*(gb|tb)(?:\s+pcie)?\s*(ssd|nvme|hdd)\b/i) ?? text.match(/\bstorage\s*[:\-]?\s*(\d+)\s*(gb|tb)\b/i);
  const screen = text.match(/\b(\d+(?:\.\d+)?)\s*(?:-| )?\s*(?:inch|inches|")/i);
  const thinkpadScreen = text.match(/\bthinkpad\s+[a-z]{0,3}(\d{2})\b/i);
  let ramGb = ram ? Number(ram[1]) : null;
  let storageGb = disk?.[1] ? (disk[2].toLowerCase() === "tb" ? Number(disk[1]) * 1024 : Number(disk[1])) : null;
  if ((ramGb == null || storageGb == null) && /\b(?:thinkpad|laptop|notebook|core)\b/i.test(text)) {
    const amounts = [...text.matchAll(/\b(\d+)\s*(gb|tb)\b/gi)].map((match) => match[2].toLowerCase() === "tb" ? Number(match[1]) * 1024 : Number(match[1]));
    const memory = amounts.find((amount) => amount >= 4 && amount <= 64);
    const drive = amounts.find((amount) => amount >= 128);
    if (ramGb == null && memory != null && drive != null) ramGb = memory;
    if (storageGb == null && drive != null) storageGb = drive;
  }
  if (ramGb == null) {
    const amounts = [...text.matchAll(/\b(\d+)\s*gb\b/gi)].map((match) => Number(match[1]));
    const small = amounts.filter((amount) => amount >= 4 && amount <= 64);
    const large = amounts.filter((amount) => amount >= 128);
    if (small.length === 1 && large.length === 0) ramGb = small[0];
  }
  const modelInches = thinkpadScreen ? Number(thinkpadScreen[1]) : null;
  const screenInches = screen ? Number(screen[1]) : modelInches === 13 || modelInches === 14 || modelInches === 15 || modelInches === 16 ? modelInches : null;
  return {
    processor: parseProcessor(text),
    ramGb,
    storageGb,
    storageType: disk?.[3] ? (disk[3].toLowerCase() === "hdd" ? "HDD" : "SSD") : "",
    screenInches,
    operatingSystem: /\bwin(?:dows)?\s*11\s+pro\b/i.test(text) ? "Windows 11 Pro" : /\bwin(?:dows)?\s*11\s+home\b/i.test(text) ? "Windows 11 Home" : /\bwin(?:dows)?\s*11\b/i.test(text) ? "Windows 11" : "",
  };
}

function hasComparableSpecs(requirement: ProductRequirement) {
  return Boolean(requirement.processor || requirement.ramGb || requirement.storageGb || requirement.operatingSystem || requirement.screenInches);
}

function screenIsTheOnlySpec(requirement: ProductRequirement) {
  return requirement.screenInches != null && !requirement.processor && requirement.ramGb == null && requirement.storageGb == null && !requirement.operatingSystem;
}

function identityMatches(requirement: ProductRequirement, candidate: SourcingCandidate) {
  const sku = requirement.sku.toLowerCase();
  const mpn = requirement.mpn.toLowerCase();
  if (sku && (candidate.sku.toLowerCase() === sku || candidate.mpn.toLowerCase() === sku)) return true;
  if (mpn && (candidate.mpn.toLowerCase() === mpn || candidate.sku.toLowerCase() === mpn)) return true;
  if (!requirement.model) return false;
  const wanted = requirement.model.toLowerCase().replace(/\s+/g, " ");
  const offered = `${candidate.name} ${candidate.model}`.toLowerCase();
  return offered.includes(wanted);
}

function parseProcessor(text: string) {
  const classes: string[] = [];
  const add = (label: string) => {
    if (!classes.includes(label)) classes.push(label);
  };
  for (const match of text.matchAll(/\bcore\s+i([3579])\b/gi)) add(`Core i${match[1]}`);
  for (const match of text.matchAll(/\bultra\s+([3579])\b/gi)) add(`Core Ultra ${match[1]}`);
  for (const match of text.matchAll(/\bcore\s+([3579])\b/gi)) add(`Core Ultra ${match[1]}`);
  for (const match of text.matchAll(/\bryzen\s+([3579])\b/gi)) add(`Ryzen ${match[1]}`);
  return classes.join("|");
}

function compareProcessor(required: string, offered: string): "MEETS" | "EXCEEDS" | "MISS" | "FAIL" | "SKIP" {
  if (!required) return "SKIP";
  const options = required.split("|").map((part) => part.trim()).filter(Boolean);
  if (options.length === 0) return "SKIP";
  const rank = { EXCEEDS: 3, MEETS: 2, MISS: 1, FAIL: 0, SKIP: 0 };
  let best: "MEETS" | "EXCEEDS" | "MISS" | "FAIL" | "SKIP" = "FAIL";
  for (const option of options) {
    const result = compareOneProcessor(option, offered);
    if (rank[result] > rank[best]) best = result;
  }
  return best;
}

function compareOneProcessor(required: string, offered: string): "MEETS" | "EXCEEDS" | "MISS" | "FAIL" | "SKIP" {
  if (!required) return "SKIP";
  if (!offered) return "MISS";
  const requiredUltra = /ultra/.test(required.toLowerCase());
  const offeredUltra = /ultra/.test(offered.toLowerCase());
  if (requiredUltra !== offeredUltra) return "FAIL";
  const rank = (value: string) => {
    const ultra = value.toLowerCase().match(/ultra\s*([3579])/);
    if (ultra?.[1]) return 100 + Number(ultra[1]);
    return /i3/.test(value) ? 3 : /i5/.test(value) ? 5 : /i7/.test(value) ? 7 : /i9/.test(value) ? 9 : /ryzen\s*3/.test(value.toLowerCase()) ? 3 : /ryzen\s*5/.test(value.toLowerCase()) ? 5 : /ryzen\s*7/.test(value.toLowerCase()) ? 7 : 0;
  };
  const left = rank(required.toLowerCase());
  const right = rank(offered.toLowerCase());
  const sameFamily = required.toLowerCase().includes("ryzen") === offered.toLowerCase().includes("ryzen");
  if (!sameFamily || right === 0) return "FAIL";
  if (right < left) return "FAIL";
  if (right > left) return "EXCEEDS";
  return "MEETS";
}

function compareNumber(required: number | null, offered: number | null): "MEETS" | "EXCEEDS" | "MISS" | "FAIL" | "SKIP" {
  if (required == null) return "SKIP";
  if (offered == null) return "MISS";
  if (offered < required) return "FAIL";
  if (offered > required) return "EXCEEDS";
  return "MEETS";
}

function compareStorage(requirement: ProductRequirement, offered: ParsedSpecs): "MEETS" | "EXCEEDS" | "MISS" | "FAIL" | "SKIP" {
  if (requirement.storageGb == null && !requirement.storageType) return "SKIP";
  if (requirement.storageType === "SSD" && offered.storageType === "HDD") return "FAIL";
  if (requirement.storageGb == null) return offered.storageType ? "MEETS" : "MISS";
  return compareNumber(requirement.storageGb, offered.storageGb);
}

function compareScreen(required: number | null, offered: number | null): "MEETS" | "EXCEEDS" | "MISS" | "FAIL" | "SKIP" {
  if (required == null) return "SKIP";
  if (offered == null) return "MISS";
  if (offered + 0.1 < required) return "FAIL";
  if (offered > required + 0.1) return "EXCEEDS";
  return "MEETS";
}

function compareOs(required: string, offered: string): "MEETS" | "EXCEEDS" | "MISS" | "FAIL" | "SKIP" {
  if (!required) return "SKIP";
  if (!offered) return "MISS";
  if (required === "Windows 11 Pro" && offered !== "Windows 11 Pro") return "FAIL";
  if (required === offered) return "MEETS";
  return "FAIL";
}
