export const RFQ_CLASSIFICATIONS = ["RFQ", "PRICE_ENQUIRY", "STOCK_ENQUIRY", "PURCHASE_ORDER", "NEGOTIATION", "GENERAL_ENQUIRY"] as const;
export const RECOMMENDED_ACTIONS = ["QUOTE", "SOURCE_PRODUCT", "ASK_CLARIFICATION", "STOCK_CHECK", "PRICE_CHECK", "ORDER_PROCESSING", "NEGOTIATION", "NO_RESPONSE", "MANUAL_REVIEW"] as const;

export type RfqClassification = (typeof RFQ_CLASSIFICATIONS)[number];
export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];
export type QuotationPermission = "EXISTING" | "SEND" | "REVIEW" | "CLARIFY" | "MANUAL";

export type RfqAnalysisItem = {
  quantity: number | null;
  category: string;
  brand: string;
  model: string;
  specifications: string[];
  mandatorySpecifications: string[];
  preferences: string[];
  uncertainties: string[];
  sku: string;
  mpn: string;
  description: string;
};

export type RfqAnalysis = {
  classification: RfqClassification;
  customerIntent: string;
  items: RfqAnalysisItem[];
  missingInformation: string[];
  uncertainties: string[];
  sufficientToQuote: boolean;
  recommendedAction: RecommendedAction;
  confidence: number;
  responseDraft: string;
};

const FORBIDDEN_KEYS = ["price", "cost", "stock", "vat", "deliverycharge", "delivery", "warranty", "banking", "quotationnumber", "quotenumber", "unitprice", "sellprice"];
const QUANTITY_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20,
};

export function parseRfqAnalysis(raw: unknown): RfqAnalysis | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = stripFinancialFields(raw) as Record<string, unknown>;
  const classification = enumValue(record.classification, RFQ_CLASSIFICATIONS);
  const recommendedAction = enumValue(record.recommendedAction, RECOMMENDED_ACTIONS);
  if (!classification || !recommendedAction) return null;
  const confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence) ? Math.min(1, Math.max(0, record.confidence)) : 0;
  const items = Array.isArray(record.items) ? record.items.flatMap((entry) => parseItem(entry)) : [];
  return {
    classification,
    customerIntent: cleanText(record.customerIntent, 400),
    items,
    missingInformation: stringList(record.missingInformation),
    uncertainties: stringList(record.uncertainties).filter(customerDraftIsSafe),
    sufficientToQuote: record.sufficientToQuote === true && items.length > 0,
    recommendedAction,
    confidence,
    responseDraft: cleanText(record.responseDraft, 2000),
  };
}

export function groundRfqAnalysis(analysis: RfqAnalysis, source: string): RfqAnalysis {
  const items = analysis.items.flatMap((item) => {
    const quantity = quantityInSource(item.quantity, source);
    const brand = present(item.brand, source);
    const model = present(item.model, source);
    const sku = present(item.sku, source).toUpperCase();
    const mpn = present(item.mpn, source).toUpperCase();
    const specifications = item.specifications.filter((spec) => present(spec, source));
    const mandatorySpecifications = item.mandatorySpecifications.filter((spec) => present(spec, source));
    const preferences = item.preferences.filter((spec) => present(spec, source));
    const uncertainties = item.uncertainties.filter((spec) => customerDraftIsSafe(spec));
    const category = categoryInSource(item.category, source);
    const description = [quantity ? `${quantity} x` : "", brand, model || category, specifications.join(", ")].filter(Boolean).join(" ").trim();
    if (!description && !category) return [];
    return [{ quantity, category, brand, model, specifications, mandatorySpecifications, preferences, uncertainties, sku, mpn, description: description || category }];
  });
  const missingInformation = analysis.missingInformation.filter((item) => customerDraftIsSafe(item));
  const uncertainties = analysis.uncertainties.filter((item) => customerDraftIsSafe(item));
  const responseDraft = customerDraftIsSafe(analysis.responseDraft) ? analysis.responseDraft : "";
  return {
    ...analysis,
    items,
    missingInformation,
    uncertainties,
    responseDraft,
    sufficientToQuote: analysis.sufficientToQuote && items.length > 0 && missingInformation.length === 0,
  };
}

export function quotationSendPermission(input: { verifiedAutoSend: boolean; analysis: RfqAnalysis | null }): QuotationPermission {
  if (!input.analysis) return "MANUAL";
  const level = confidenceLevel(input.analysis.confidence);
  if (level === "LOW") {
    return input.analysis.missingInformation.length > 0 || input.analysis.recommendedAction === "ASK_CLARIFICATION" ? "CLARIFY" : "MANUAL";
  }
  if (level === "REVIEW") return "REVIEW";
  if (!input.verifiedAutoSend || !input.analysis.sufficientToQuote) return "MANUAL";
  if (input.analysis.recommendedAction === "ASK_CLARIFICATION" || input.analysis.recommendedAction === "NO_RESPONSE" || input.analysis.recommendedAction === "MANUAL_REVIEW") return "MANUAL";
  return "SEND";
}

export function clarificationFromAnalysis(analysis: RfqAnalysis) {
  if (analysis.responseDraft && customerDraftIsSafe(analysis.responseDraft)) return analysis.responseDraft;
  const missing = analysis.missingInformation.filter((item) => customerDraftIsSafe(item));
  if (missing.length === 0) return "";
  return `Good day,\n\nThank you for the enquiry. Please confirm: ${missing.join("; ")}.`;
}

export function customerDraftIsSafe(value: string) {
  return !/(\bvat\b|\bzar\b|R\s?\d|\bUF-Q-|\bwarranty\b|\baccount\b|\bstock\b|\bprice\b)/i.test(value);
}

export function rankSuppliedMatches<T extends { name: string; sku?: string; specifications?: string }>(items: RfqAnalysisItem[], matches: readonly T[]) {
  return matches
    .map((match, index) => ({ match, index, score: matchScore(items, match) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((row) => row.match);
}

export async function analyzeInboundEmail(input: { subject: string; body: string }, deps?: { fetchImpl?: typeof fetch; apiKey?: string; model?: string }): Promise<RfqAnalysis | null> {
  const apiKey = deps?.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    logAiUse({ purpose: "extraction", invoked: false, success: false, reviewReason: "OpenAI is not configured." });
    return null;
  }
  const source = `${input.subject}\n${input.body}`.slice(0, 12000);
  const fetchImpl = deps?.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: deps?.model || process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0,
        instructions: ANALYSER_INSTRUCTIONS,
        input: source,
        text: { format: { type: "json_schema", name: "rfq_analysis", strict: true, schema: ANALYSIS_SCHEMA } },
      }),
    });
    if (!response.ok) {
      logAiUse({ purpose: "extraction", invoked: true, success: false, reviewReason: `The model returned ${response.status}.` });
      return null;
    }
    const json = await response.json() as unknown;
    const text = outputText(json);
    if (!text) {
      logAiUse({ purpose: "extraction", invoked: true, success: false, reviewReason: "The model returned no structured extraction." });
      return null;
    }
    const parsed = parseRfqAnalysis(JSON.parse(text) as unknown);
    const grounded = parsed ? groundRfqAnalysis(parsed, source) : null;
    logAiUse({ purpose: "extraction", invoked: true, success: Boolean(grounded && grounded.items.length > 0), reviewReason: grounded?.items.length ? "extracted" : "No grounded product line was returned." });
    return grounded;
  } catch {
    logAiUse({ purpose: "extraction", invoked: true, success: false, reviewReason: "The model request did not complete." });
    return null;
  }
}

export async function completeStructured(input: { instructions: string; content: string; schemaName: string; schema: object; purpose: string }, deps?: { fetchImpl?: typeof fetch; apiKey?: string; model?: string }): Promise<unknown | null> {
  const apiKey = deps?.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    logAiUse({ purpose: input.purpose, invoked: false, success: false, reviewReason: "OpenAI is not configured." });
    return null;
  }
  const fetchImpl = deps?.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: deps?.model || process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0,
        instructions: input.instructions,
        input: input.content.slice(0, 12000),
        text: { format: { type: "json_schema", name: input.schemaName, strict: true, schema: input.schema } },
      }),
    });
    if (!response.ok) {
      logAiUse({ purpose: input.purpose, invoked: true, success: false, reviewReason: `The model returned ${response.status}.` });
      return null;
    }
    const json = await response.json() as unknown;
    const text = outputText(json);
    if (!text) {
      logAiUse({ purpose: input.purpose, invoked: true, success: false, reviewReason: "The model returned no structured text." });
      return null;
    }
    return JSON.parse(text) as unknown;
  } catch {
    logAiUse({ purpose: input.purpose, invoked: true, success: false, reviewReason: "The model request did not complete." });
    return null;
  }
}

export function logAiUse(entry: { purpose: string; invoked: boolean; success: boolean; reviewReason: string }) {
  console.info(`[RFQ-AI] purpose=${entry.purpose} invoked=${entry.invoked} success=${entry.success} review=${entry.reviewReason.replace(/\s+/g, " ").slice(0, 180)}`);
}

export function confidenceLevel(confidence: number): "AUTO" | "REVIEW" | "LOW" {
  if (confidence >= 0.9) return "AUTO";
  if (confidence >= 0.7) return "REVIEW";
  return "LOW";
}

const ANALYSER_INSTRUCTIONS = [
  "You interpret a customer RFQ for OutreachHub. The message and its attachment text are the only source.",
  "Return one item for every distinct product. A laptop and its charger, dock, or power supply are different items.",
  "A line number such as 1. is not the quantity. A quantity is null when the customer does not state one.",
  "Put requirements the product must meet in mandatorySpecifications. Put optional wishes in preferences. List genuine gaps in uncertainties.",
  "Do not invent a product price, supplier price, stock quantity, VAT, delivery charge, warranty, banking details, or quotation number.",
  "Do not include those values even if the customer mentions them.",
  "Use only words written in the RFQ for product, quantity, brand, model, SKU, part number, and specifications.",
  "responseDraft is a plain-text question or acknowledgement with no prices, stock, VAT, warranty, banking, or quotation number.",
].join(" ");

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
    required: ["classification", "customerIntent", "items", "missingInformation", "uncertainties", "sufficientToQuote", "recommendedAction", "confidence", "responseDraft"],
    properties: {
    classification: { type: "string", enum: [...RFQ_CLASSIFICATIONS] },
    customerIntent: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quantity", "category", "brand", "model", "specifications", "mandatorySpecifications", "preferences", "uncertainties", "sku", "mpn"],
        properties: {
          quantity: { type: ["number", "null"] },
          category: { type: "string" },
          brand: { type: "string" },
          model: { type: "string" },
          specifications: { type: "array", items: { type: "string" } },
          mandatorySpecifications: { type: "array", items: { type: "string" } },
          preferences: { type: "array", items: { type: "string" } },
          uncertainties: { type: "array", items: { type: "string" } },
          sku: { type: "string" },
          mpn: { type: "string" },
        },
      },
    },
    missingInformation: { type: "array", items: { type: "string" } },
    uncertainties: { type: "array", items: { type: "string" } },
    sufficientToQuote: { type: "boolean" },
    recommendedAction: { type: "string", enum: [...RECOMMENDED_ACTIONS] },
    confidence: { type: "number" },
    responseDraft: { type: "string" },
  },
};

function parseItem(entry: unknown): RfqAnalysisItem[] {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
  const line = stripFinancialFields(entry) as Record<string, unknown>;
  const quantity = typeof line.quantity === "number" && Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : null;
  return [{
    quantity,
    category: cleanText(line.category, 120),
    brand: cleanText(line.brand, 120),
    model: cleanText(line.model, 160),
    specifications: stringList(line.specifications),
    mandatorySpecifications: stringList(line.mandatorySpecifications),
    preferences: stringList(line.preferences),
    uncertainties: stringList(line.uncertainties).filter(customerDraftIsSafe),
    sku: cleanText(line.sku, 80).toUpperCase(),
    mpn: cleanText(line.mpn, 80).toUpperCase(),
    description: "",
  }];
}

function stripFinancialFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stripFinancialFields(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    if (FORBIDDEN_KEYS.includes(key.toLowerCase().replace(/[^a-z]/g, ""))) return [];
    return [[key, stripFinancialFields(entry)]];
  }));
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : null;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const text = cleanText(entry, 240);
    return text ? [text] : [];
  }).slice(0, 12);
}

function cleanText(value: unknown, limit: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function present(value: string, source: string) {
  const trimmed = value.trim();
  if (trimmed.length < 2) return "";
  return source.toLowerCase().includes(trimmed.toLowerCase()) ? trimmed : "";
}

function quantityInSource(quantity: number | null, source: string) {
  if (quantity == null) return null;
  if (new RegExp(`\\b${quantity}\\b`).test(source)) return quantity;
  const word = Object.entries(QUANTITY_WORDS).find(([, number]) => number === quantity)?.[0];
  return word && new RegExp(`\\b${word}\\b`, "i").test(source) ? quantity : null;
}

function categoryInSource(category: string, source: string) {
  const words = category.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
  if (words.length === 0) return present(category, source);
  const haystack = source.toLowerCase();
  return words.every((word) => haystack.includes(word.slice(0, Math.min(5, word.length)))) ? category.trim() : "";
}

function matchScore(items: RfqAnalysisItem[], match: { name: string; sku?: string; specifications?: string }) {
  const haystack = `${match.name} ${match.sku ?? ""} ${match.specifications ?? ""}`.toLowerCase();
  return items.reduce((total, item) => {
    const sku = item.sku.toLowerCase();
    const exactSku = sku && haystack.includes(sku) ? 5 : 0;
    const model = item.model.toLowerCase();
    const modelHit = model && haystack.includes(model) ? 3 : 0;
    const brand = item.brand.toLowerCase();
    const brandHit = brand && haystack.includes(brand) ? 2 : 0;
    const specs = item.specifications.filter((spec) => haystack.includes(spec.toLowerCase())).length;
    return total + exactSku + modelHit + brandHit + specs;
  }, 0);
}

function outputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const output = "output" in payload && Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
    }
  }
  return "";
}
