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
  sku: string;
  mpn: string;
  description: string;
};

export type RfqAnalysis = {
  classification: RfqClassification;
  customerIntent: string;
  items: RfqAnalysisItem[];
  missingInformation: string[];
  sufficientToQuote: boolean;
  recommendedAction: RecommendedAction;
  confidence: number;
  responseDraft: string;
};

const FORBIDDEN_KEYS = ["price", "cost", "stock", "vat", "deliverycharge", "delivery", "warranty", "banking", "quotationnumber", "quotenumber", "unitprice", "sellprice"];

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
    const description = [quantity ? `${quantity} x` : "", brand, model, specifications.join(", ")].filter(Boolean).join(" ").trim();
    if (!description) return [];
    return [{ quantity, category: present(item.category, source), brand, model, specifications, sku, mpn, description }];
  });
  const missingInformation = analysis.missingInformation.filter((item) => customerDraftIsSafe(item));
  const responseDraft = customerDraftIsSafe(analysis.responseDraft) ? analysis.responseDraft : "";
  return {
    ...analysis,
    items,
    missingInformation,
    responseDraft,
    sufficientToQuote: analysis.sufficientToQuote && items.length > 0 && missingInformation.length === 0,
  };
}

export function quotationSendPermission(input: { verifiedAutoSend: boolean; analysis: RfqAnalysis | null }): QuotationPermission {
  if (!input.analysis) return "EXISTING";
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
  if (!apiKey) return null;
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
    if (!response.ok) return null;
    const json = await response.json() as unknown;
    const text = outputText(json);
    if (!text) return null;
    const parsed = parseRfqAnalysis(JSON.parse(text) as unknown);
    return parsed ? groundRfqAnalysis(parsed, source) : null;
  } catch {
    return null;
  }
}

export function confidenceLevel(confidence: number): "AUTO" | "REVIEW" | "LOW" {
  if (confidence >= 0.9) return "AUTO";
  if (confidence >= 0.7) return "REVIEW";
  return "LOW";
}

const ANALYSER_INSTRUCTIONS = [
  "You interpret a customer email for OutreachHub.",
  "Return only the structured interpretation.",
  "Do not invent a product price, supplier price, stock quantity, VAT, delivery charge, warranty, banking details, or quotation number.",
  "Do not include those values even if the customer mentions them.",
  "Use only words written in the email for product, quantity, brand, model, SKU, and specifications.",
  "A quantity is null when the email does not state one.",
  "responseDraft is a plain-text question or acknowledgement with no prices, stock, VAT, warranty, banking, or quotation number.",
].join(" ");

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["classification", "customerIntent", "items", "missingInformation", "sufficientToQuote", "recommendedAction", "confidence", "responseDraft"],
  properties: {
    classification: { type: "string", enum: [...RFQ_CLASSIFICATIONS] },
    customerIntent: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quantity", "category", "brand", "model", "specifications", "sku", "mpn"],
        properties: {
          quantity: { type: ["number", "null"] },
          category: { type: "string" },
          brand: { type: "string" },
          model: { type: "string" },
          specifications: { type: "array", items: { type: "string" } },
          sku: { type: "string" },
          mpn: { type: "string" },
        },
      },
    },
    missingInformation: { type: "array", items: { type: "string" } },
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
  return new RegExp(`\\b${quantity}\\b`).test(source) ? quantity : null;
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
