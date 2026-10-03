import { compareRequirement, type ProductRequirement, type SourcingCandidate } from "./sourcing";

export const CLARIFICATION_QUESTION = "To quote the right product, please confirm the brand, model or SKU, and the quantity you need.";
export const EXTERNAL_SOURCING_NOTE = "No website or supplier product is available. An external sourcing task is open.";

export type SalesAction = "CLARIFY" | "EXTERNAL_TASK" | "ALTERNATIVES" | "PREPARE" | "AUTO_SEND";
export type MatchMethod = "EXACT" | "SPECIFICATION" | "FUZZY" | "SEMANTIC" | "NONE";
export type FunnelStage = "ENQUIRY" | "RFQ" | "QUOTED" | "REPLIED" | "REVISED" | "ACCEPTED" | "LOST";

export type EnquiryJson = {
  intent: string;
  customer: { name: string; company: string; email: string; reference: string };
  requirements: Array<{
    productType: string;
    quantity: number | null;
    brand: string;
    sku: string;
    mpn: string;
    model: string;
    processor: string;
    ramGb: number | null;
    storageGb: number | null;
    storageType: string;
    screenInches: number | null;
    operatingSystem: string;
    requestedText: string;
  }>;
};

export type RankedProduct = {
  productId: string | null;
  name: string;
  sku: string;
  method: MatchMethod;
  similarity: number;
  stockQty: number | null;
  unitPriceCents: number | null;
  marginPercent: number | null;
};

export type SalesDecision = {
  action: SalesAction;
  confidence: number;
  matches: RankedProduct[];
  message: string;
};

const STOP = new Set(["stop", "the", "and", "for", "with", "please", "quote", "need"]);

export function buildEnquiryJson(input: {
  intent: string;
  customerName: string;
  companyName: string;
  email: string;
  reference: string;
  requirements: ProductRequirement[];
}): EnquiryJson {
  return {
    intent: input.intent,
    customer: {
      name: input.customerName,
      company: input.companyName,
      email: input.email,
      reference: input.reference,
    },
    requirements: input.requirements.map((requirement) => ({
      productType: requirement.productType,
      quantity: requirement.quantity,
      brand: requirement.brandPreference,
      sku: requirement.sku,
      mpn: requirement.mpn,
      model: requirement.model,
      processor: requirement.processor,
      ramGb: requirement.ramGb,
      storageGb: requirement.storageGb,
      storageType: requirement.storageType,
      screenInches: requirement.screenInches,
      operatingSystem: requirement.operatingSystem,
      requestedText: requirement.requestedText,
    })),
  };
}

export function rankProductMatches(requirement: ProductRequirement, candidates: readonly SourcingCandidate[]): RankedProduct[] {
  const requested = `${requirement.requestedText} ${requirement.model} ${requirement.sku} ${requirement.productType}`;
  return candidates
    .map((candidate) => {
      const identity = sameIdentity(requirement, candidate);
      const grade = compareRequirement(requirement, candidate);
      const fuzzy = tokenDice(requested, `${candidate.name} ${candidate.model} ${candidate.sku}`);
      const semantic = tokenCosine(requested, `${candidate.name} ${candidate.brand} ${candidate.specifications} ${candidate.model}`);
      let method: MatchMethod = "NONE";
      let similarity = 0;
      if (identity) {
        method = "EXACT";
        similarity = 1;
      } else if (grade === "EXACT" || grade === "MEETS_REQUIREMENT" || grade === "EXCEEDS_REQUIREMENT") {
        method = "SPECIFICATION";
        similarity = grade === "EXACT" ? 0.95 : grade === "MEETS_REQUIREMENT" ? 0.88 : 0.8;
      } else if (fuzzy >= 0.55) {
        method = "FUZZY";
        similarity = fuzzy;
      } else if (semantic >= 0.34) {
        method = "SEMANTIC";
        similarity = semantic;
      }
      if (method === "NONE" && /\bthinkpad\b/i.test(`${requirement.model} ${requirement.requestedText}`) && /\bthinkpad\b/i.test(candidate.name)) {
        method = "FUZZY";
        similarity = Math.max(fuzzy, 0.56);
      }
      return {
        productId: candidate.productId,
        name: candidate.name,
        sku: candidate.sku,
        method,
        similarity,
        stockQty: candidate.stockKnown ? candidate.stockQty : null,
        unitPriceCents: null,
        marginPercent: null,
      };
    })
    .filter((match) => match.method !== "NONE")
    .sort((left, right) => methodRank(left.method) - methodRank(right.method) || right.similarity - left.similarity);
}

export function unpricedCatalogueNote(requirement: ProductRequirement, matches: readonly RankedProduct[]) {
  if (matches.some((match) => (match.unitPriceCents ?? 0) > 0)) return "";
  const family = requirement.model.toLowerCase().split(/\s+/)[0] ?? "";
  const specified = matches.filter((match) => match.method === "EXACT" || match.method === "SPECIFICATION");
  const exactSpec = specified.filter((match) => match.similarity >= 0.88);
  const chosen = exactSpec.find((match) => (match.stockQty ?? 0) > 0) ?? exactSpec[0] ?? specified.find((match) => (match.stockQty ?? 0) > 0) ?? specified[0]
    ?? matches.find((match) => (match.method === "FUZZY" || match.method === "SEMANTIC") && family.length > 2 && match.name.toLowerCase().includes(family) && (match.stockQty ?? 0) > 0)
    ?? matches.find((match) => (match.method === "FUZZY" || match.method === "SEMANTIC") && family.length > 2 && match.name.toLowerCase().includes(family));
  if (!chosen?.name) return "";
  const sku = chosen.sku ? ` (${chosen.sku})` : "";
  return `${chosen.name}${sku} is on the website catalogue. No supplier cost is on file, so no price was offered.`;
}

export function confidenceFor(match: RankedProduct, requestedQuantity: number) {
  const base = match.method === "EXACT" ? 92 : match.method === "SPECIFICATION" ? 76 : match.method === "FUZZY" ? 54 : match.method === "SEMANTIC" ? 41 : 0;
  if (match.unitPriceCents == null || match.unitPriceCents <= 0) return Math.min(base, 35);
  if (match.stockQty == null) return Math.min(base, 48);
  if (match.stockQty < Math.max(1, requestedQuantity)) return Math.min(base, 36);
  return base;
}

export function decideSalesResponse(input: {
  vague: boolean;
  requestedExact: boolean;
  requestedQuantity: number;
  matches: RankedProduct[];
  marginAllowed: boolean;
  autoSendAllowed: boolean;
}): SalesDecision {
  if (input.vague || input.matches.length === 0) {
    const nothing = input.matches.length === 0 && !input.vague;
    return {
      action: nothing ? "EXTERNAL_TASK" : "CLARIFY",
      confidence: 0,
      matches: [],
      message: nothing ? EXTERNAL_SOURCING_NOTE : CLARIFICATION_QUESTION,
    };
  }
  const priced = input.matches.filter((match) => match.unitPriceCents != null && match.unitPriceCents > 0);
  const best = priced[0] ?? input.matches[0];
  const confidence = best ? confidenceFor(best, input.requestedQuantity) : 0;
  if (!best) return { action: "EXTERNAL_TASK", confidence: 0, matches: [], message: EXTERNAL_SOURCING_NOTE };
  if (priced.length === 0 || !input.marginAllowed) {
    return { action: "PREPARE", confidence, matches: input.matches.slice(0, 3), message: "" };
  }
  if (confidence < 50) {
    return { action: "CLARIFY", confidence, matches: priced.slice(0, 3), message: CLARIFICATION_QUESTION };
  }
  const exact = priced.find((match) => match.method === "EXACT" && (match.stockQty ?? 0) >= Math.max(1, input.requestedQuantity));
  if (input.requestedExact && !exact) {
    return {
      action: "ALTERNATIVES",
      confidence,
      matches: priced.slice(0, 3),
      message: composeSalesReply({ action: "ALTERNATIVES", customerName: "", lines: replyLines(priced.slice(0, 3), input.requestedQuantity), validUntil: "" }),
    };
  }
  const chosen = exact ?? best;
  const action = input.autoSendAllowed && confidence >= 80 && chosen.method !== "FUZZY" && chosen.method !== "SEMANTIC" ? "AUTO_SEND" : "PREPARE";
  return {
    action,
    confidence,
    matches: [chosen, ...priced.filter((match) => match !== chosen)].slice(0, 3),
    message: composeSalesReply({
      action,
      customerName: "",
      lines: replyLines([chosen], input.requestedQuantity),
      validUntil: "",
    }),
  };
}

export function composeSalesReply(input: {
  action: SalesAction;
  customerName: string;
  lines: Array<{ name: string; quantity: number; unitPriceCents: number; stockQty: number }>;
  validUntil: string;
}) {
  const greeting = input.customerName.trim() ? `Hello ${input.customerName.trim()},` : "Hello,";
  if (input.action === "CLARIFY") return `${greeting}\n\n${CLARIFICATION_QUESTION}`;
  if (input.action === "EXTERNAL_TASK") return `${greeting}\n\n${EXTERNAL_SOURCING_NOTE}`;
  const lines = input.lines.filter((line) => line.name.trim() && line.quantity > 0 && line.unitPriceCents > 0 && line.stockQty >= 0);
  if (lines.length === 0) return `${greeting}\n\n${CLARIFICATION_QUESTION}`;
  const listed = lines.map((line) => `${line.quantity} x ${line.name} at ${formatZar(line.unitPriceCents)} each excluding VAT, ${line.stockQty} available.`).join("\n");
  const validity = input.validUntil.trim() ? `\n\nThis offer is valid until ${input.validUntil.trim()}.` : "";
  if (input.action === "ALTERNATIVES") {
    return `${greeting}\n\nThe exact item is not available. These verified alternatives are in stock:\n${listed}${validity}`;
  }
  return `${greeting}\n\nWe can quote:\n${listed}${validity}`;
}

export function composeFollowUp(input: { quoteNumber: string; validUntil: string }) {
  const until = input.validUntil.trim() ? ` It remains valid until ${input.validUntil.trim()}.` : "";
  return `Hello,\n\nI am following up on quotation ${input.quoteNumber}.${until}\n\nPlease reply if you would like to proceed, change the quotation, or decline it.`;
}

export function quoteFollowUpAction(input: {
  sentAt: Date;
  now: Date;
  followUpCount: number;
  followUpLimit: number;
  afterDays: number;
  customerReplied: boolean;
  rejected: boolean;
  ordered: boolean;
}) {
  if (input.customerReplied || input.rejected || input.ordered || input.followUpCount >= input.followUpLimit) return "stop" as const;
  const due = input.sentAt.getTime() + Math.max(1, input.afterDays) * 24 * 60 * 60 * 1000;
  return input.now.getTime() >= due ? "send" as const : "wait" as const;
}

export function funnelStage(status: string): FunnelStage {
  if (status === "WON") return "ACCEPTED";
  if (status === "LOST") return "LOST";
  if (status === "NEGOTIATION") return "REVISED";
  if (status === "QUOTE_SENT") return "QUOTED";
  if (status === "NEW") return "ENQUIRY";
  return "RFQ";
}

export function salesFunnelMetrics(rows: Array<{ stage: FunnelStage; valueCents: number; marginPercent: number | null; responseMinutes: number | null; lostReason: string }>) {
  const count = (stage: FunnelStage) => rows.filter((row) => row.stage === stage).length;
  const quoted = count("QUOTED");
  const accepted = count("ACCEPTED");
  const margins = rows.map((row) => row.marginPercent).filter((value): value is number => value != null);
  const responses = rows.map((row) => row.responseMinutes).filter((value): value is number => value != null);
  const lost = new Map<string, number>();
  for (const row of rows) {
    if (row.stage !== "LOST" || !row.lostReason.trim()) continue;
    lost.set(row.lostReason, (lost.get(row.lostReason) ?? 0) + 1);
  }
  return {
    enquiry: count("ENQUIRY"),
    rfq: count("RFQ"),
    quoted,
    replied: count("REPLIED"),
    revised: count("REVISED"),
    accepted,
    lost: count("LOST"),
    quotationValueCents: rows.filter((row) => row.stage === "QUOTED").reduce((sum, row) => sum + row.valueCents, 0),
    averageMarginPercent: margins.length === 0 ? null : Math.round(margins.reduce((sum, value) => sum + value, 0) / margins.length),
    averageResponseMinutes: responses.length === 0 ? null : Math.round(responses.reduce((sum, value) => sum + value, 0) / responses.length),
    conversionPercent: quoted === 0 ? null : Math.round((accepted / quoted) * 100),
    lostReasons: [...lost.entries()].map(([reason, total]) => ({ reason, total })),
  };
}

export function funnelRowsFromRfqs(rfqs: Array<{ status: string; createdAt: string; respondedAt: string | null; lostReason: string; sentQuoteValueCents: number }>) {
  return rfqs.flatMap((rfq) => {
    const responseMinutes = rfq.respondedAt == null ? null : Math.max(0, Math.round((Date.parse(rfq.respondedAt) - Date.parse(rfq.createdAt)) / 60000));
    const row = { valueCents: 0, marginPercent: null as number | null, responseMinutes, lostReason: "" };
    const rows: Array<{ stage: FunnelStage; valueCents: number; marginPercent: number | null; responseMinutes: number | null; lostReason: string }> = [
      { ...row, stage: "ENQUIRY" },
      { ...row, stage: "RFQ" },
    ];
    if (rfq.sentQuoteValueCents > 0) rows.push({ ...row, stage: "QUOTED", valueCents: rfq.sentQuoteValueCents });
    if (rfq.respondedAt) rows.push({ ...row, stage: "REPLIED" });
    if (rfq.status === "NEGOTIATION") rows.push({ ...row, stage: "REVISED" });
    if (rfq.status === "WON") rows.push({ ...row, stage: "ACCEPTED" });
    if (rfq.status === "LOST") rows.push({ ...row, stage: "LOST", lostReason: rfq.lostReason });
    return rows;
  });
}

function replyLines(matches: RankedProduct[], quantity: number) {
  return matches.flatMap((match) => {
    if (match.unitPriceCents == null || match.stockQty == null) return [];
    return [{ name: match.sku ? `${match.name} (${match.sku})` : match.name, quantity: Math.max(1, quantity), unitPriceCents: match.unitPriceCents, stockQty: match.stockQty }];
  });
}

function sameIdentity(requirement: ProductRequirement, candidate: SourcingCandidate) {
  const sku = requirement.sku.trim().toLowerCase();
  const mpn = requirement.mpn.trim().toLowerCase();
  const model = requirement.model.trim().toLowerCase();
  if (sku && (candidate.sku.toLowerCase() === sku || candidate.mpn.toLowerCase() === sku)) return true;
  if (mpn && (candidate.mpn.toLowerCase() === mpn || candidate.sku.toLowerCase() === mpn)) return true;
  if (model.length >= 4 && `${candidate.name} ${candidate.model}`.toLowerCase().includes(model)) return true;
  return false;
}

function methodRank(method: MatchMethod) {
  if (method === "EXACT") return 0;
  if (method === "SPECIFICATION") return 1;
  if (method === "FUZZY") return 2;
  if (method === "SEMANTIC") return 3;
  return 4;
}

function tokens(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !STOP.has(token));
}

function tokenDice(left: string, right: string) {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  if (a.size + b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function tokenCosine(left: string, right: string) {
  const a = new Map<string, number>();
  const b = new Map<string, number>();
  for (const token of tokens(left)) a.set(token, (a.get(token) ?? 0) + 1);
  for (const token of tokens(right)) b.set(token, (b.get(token) ?? 0) + 1);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const [token, count] of a) {
    leftNorm += count * count;
    dot += count * (b.get(token) ?? 0);
  }
  for (const count of b.values()) rightNorm += count * count;
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function formatZar(cents: number) {
  return `ZAR ${(cents / 100).toFixed(2)}`;
}
