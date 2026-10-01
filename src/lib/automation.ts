import { barcodeKey, brandModelKey, mpnKey, skuKey } from "./catalogue-reconcile";
import { markedUpCents } from "./stock";

export const ACKNOWLEDGEMENT = "Thank you for your request for quotation. We have received your enquiry and are checking current pricing and availability. We will respond with the quotation shortly.";

export type InboundKind =
  | "RFQ"
  | "PRICE_ENQUIRY"
  | "STOCK_ENQUIRY"
  | "ORDER_OR_PO"
  | "QUOTE_ACCEPTED"
  | "PRICE_NEGOTIATION"
  | "GENERAL_ENQUIRY"
  | "CAMPAIGN_REPLY"
  | "OTHER";

export type ReplyKind =
  | "QUOTE_ACCEPTED"
  | "PRICE_NEGOTIATION"
  | "MORE_INFORMATION"
  | "STOCK_QUESTION"
  | "DELIVERY_QUESTION"
  | "ALTERNATIVE_REQUEST"
  | "PURCHASE_ORDER"
  | "NOT_INTERESTED"
  | "OTHER";

export type RfqLineDraft = {
  description: string;
  quantity: number | null;
  manufacturer: string;
  model: string;
  sku: string;
  manufacturerPartNumber: string;
  specifications: string;
};

export type ExtractedRfq = {
  customerName: string;
  companyName: string;
  email: string;
  reference: string;
  deliveryLocation: string;
  requiredDate: string;
  notes: string;
  lines: RfqLineDraft[];
};

export type CatalogueHit = {
  id: string;
  productId: string | null;
  sku: string;
  skuKey: string;
  mpnKey: string;
  barcodeKey: string;
  brandModelKey: string;
  nameKey: string;
  name: string;
};

export type LineMatch = {
  status: "MATCHED" | "NEEDS_PRODUCT_REVIEW";
  productId: string | null;
  storeProductId: string;
  sku: string;
  reason: string;
};

const COMMERCIAL = new Set<InboundKind>(["RFQ", "PRICE_ENQUIRY", "STOCK_ENQUIRY", "ORDER_OR_PO"]);

export function isQuotationRequest(kind: InboundKind) {
  return COMMERCIAL.has(kind);
}

export function classifyInbound(input: { subject: string; body: string; campaignReply: boolean }): InboundKind {
  if (input.campaignReply) return "CAMPAIGN_REPLY";
  const text = `${input.subject}\n${input.body}`;
  const reply = classifyCustomerReply(text);
  if (reply === "QUOTE_ACCEPTED") return "QUOTE_ACCEPTED";
  if (reply === "PURCHASE_ORDER") return "ORDER_OR_PO";
  if (reply === "PRICE_NEGOTIATION") return "PRICE_NEGOTIATION";
  if (reply === "NOT_INTERESTED") return "OTHER";
  if (/\b(request for quotation|quotation|please quote|rfq|quote on|kindly quote)\b/i.test(text)) return "RFQ";
  if (/\b(in stock|availability|do you have|stock check)\b/i.test(text)) return "STOCK_ENQUIRY";
  if (/\b(price|pricing|how much|costing)\b/i.test(text)) return "PRICE_ENQUIRY";
  if (/\b(enquiry|inquire|information on)\b/i.test(text)) return "GENERAL_ENQUIRY";
  return "OTHER";
}

export function classifyCustomerReply(text: string): ReplyKind {
  if (/\b(not interested|no longer required|please cancel|decline the quote)\b/i.test(text)) return "NOT_INTERESTED";
  if (/\b(purchase order|\bpo\b|p\.o\.)\b/i.test(text)) return "PURCHASE_ORDER";
  if (/\b(accept(?:ed)? the quot|we accept|please proceed|go ahead with the quot)\b/i.test(text)) return "QUOTE_ACCEPTED";
  if (/\b(better price|discount|cheaper|negotiate|too expensive|reduce the price)\b/i.test(text)) return "PRICE_NEGOTIATION";
  if (/\b(alternative|substitute|equivalent|instead of)\b/i.test(text)) return "ALTERNATIVE_REQUEST";
  if (/\b(deliver|delivery|lead time|when can you)\b/i.test(text)) return "DELIVERY_QUESTION";
  if (/\b(how many|in stock|stock left|availability)\b/i.test(text)) return "STOCK_QUESTION";
  if (/\b(more information|more info|send (?:the )?spec|datasheet)\b/i.test(text)) return "MORE_INFORMATION";
  return "OTHER";
}

export function extractRfqRequest(body: string): ExtractedRfq {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const labeled = (labels: string[]) => {
    const pattern = new RegExp(`^(?:${labels.join("|")})\\s*[:\\-]\\s*(.+)$`, "i");
    for (const line of lines) {
      const match = line.match(pattern);
      if (match?.[1]?.trim()) return match[1].trim().slice(0, 200);
    }
    return "";
  };
  const emailMatch = body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const referenceMatch = body.match(/\b(?:rfq|reference|ref|enquiry)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9./-]{2,})/i);
  const products: RfqLineDraft[] = [];
  for (const line of lines) {
    const product = productLine(line) ?? inlineQuantity(line);
    if (product) products.push(product);
  }
  return {
    customerName: labeled(["name", "contact", "attention", "attn"]),
    companyName: labeled(["company", "organisation", "organization"]),
    email: emailMatch?.[0]?.toLowerCase() ?? "",
    reference: referenceMatch?.[1]?.slice(0, 80) ?? "",
    deliveryLocation: labeled(["deliver to", "delivery", "delivery location", "ship to"]),
    requiredDate: labeled(["required by", "required date", "need by", "needed by"]),
    notes: "",
    lines: products,
  };
}

export function matchRfqLine(
  line: { sku?: string; manufacturerPartNumber?: string; barcode?: string; manufacturer?: string; model?: string; description?: string },
  hits: readonly CatalogueHit[],
  confirmedSupplierSkus: ReadonlyMap<string, string> = new Map(),
): LineMatch {
  const pick = (found: CatalogueHit[], reason: string): LineMatch | null => {
    if (found.length > 1) {
      return { status: "NEEDS_PRODUCT_REVIEW", productId: null, storeProductId: "", sku: "", reason: "More than one catalogue product matches. Nothing was selected." };
    }
    const hit = found[0];
    if (!hit) return null;
    return { status: "MATCHED", productId: hit.productId, storeProductId: hit.id, sku: hit.sku, reason };
  };
  const part = mpnKey(line.manufacturerPartNumber ?? "");
  if (part.length >= 3) {
    const found = pick(hits.filter((hit) => hit.mpnKey === part), "Matched the manufacturer part number.");
    if (found) return found;
  }
  const sku = skuKey(line.sku ?? "");
  if (sku) {
    const found = pick(hits.filter((hit) => hit.skuKey === sku), "Matched the SKU.");
    if (found) return found;
  }
  const barcode = barcodeKey(line.barcode ?? "");
  if (barcode) {
    const found = pick(hits.filter((hit) => hit.barcodeKey === barcode), "Matched the barcode.");
    if (found) return found;
  }
  const supplier = skuKey(line.sku ?? "");
  const confirmed = supplier ? confirmedSupplierSkus.get(supplier) : undefined;
  if (confirmed) {
    const found = pick(hits.filter((hit) => hit.id === confirmed || hit.productId === confirmed), "Matched a confirmed supplier SKU.");
    if (found) return found;
  }
  const brandModel = brandModelKey(line.manufacturer ?? "", line.model || line.manufacturerPartNumber || "");
  if (brandModel) {
    const found = pick(hits.filter((hit) => hit.brandModelKey === brandModel), "Matched the brand and model.");
    if (found) return found;
  }
  const name = nameKey(line.description ?? "");
  if (name.length >= 8) {
    const exact = hits.filter((hit) => hit.nameKey === name);
    if (exact.length === 1 && exact[0]) {
      return { status: "MATCHED", productId: exact[0].productId, storeProductId: exact[0].id, sku: exact[0].sku, reason: "Matched the product name." };
    }
    if (exact.length > 1) {
      return { status: "NEEDS_PRODUCT_REVIEW", productId: null, storeProductId: "", sku: "", reason: "More than one catalogue product has this name." };
    }
  }
  const fuzzy = fuzzyName(line.description ?? "", hits);
  if (fuzzy) {
    return { status: "NEEDS_PRODUCT_REVIEW", productId: null, storeProductId: fuzzy.id, sku: "", reason: "The name is only similar to a catalogue product. Confirm it before quoting." };
  }
  return { status: "NEEDS_PRODUCT_REVIEW", productId: null, storeProductId: "", sku: "", reason: "No catalogue product matched." };
}

export type PriceDecision = "AUTO_QUOTE" | "READY_FOR_APPROVAL" | "MARGIN_WARNING" | "STALE" | "STOCK_REVIEW" | "PRICE_REVIEW";

export function priceQuotation(input: {
  costExVatCents: number | null;
  markupPercent: number;
  minimumMarginPercent: number;
  autoQuoteMarginPercent: number;
  autoSendMarginPercent: number;
  fresh: boolean;
  stockKnown: boolean;
  stockQty: number | null;
  requestedQty: number;
  abnormalPriceChange: boolean;
}) {
  const empty = { costExVatCents: null as number | null, sellExVatCents: null as number | null, sellInclVatCents: null as number | null, marginPercent: null as number | null };
  if (!input.fresh || input.costExVatCents == null || input.costExVatCents <= 0) {
    return { ...empty, decision: "STALE" as PriceDecision };
  }
  if (!input.stockKnown || input.stockQty == null || input.stockQty < Math.max(1, input.requestedQty)) {
    return { ...empty, costExVatCents: input.costExVatCents, decision: "STOCK_REVIEW" as PriceDecision };
  }
  const sellExVatCents = markedUpCents(input.costExVatCents, input.markupPercent);
  if (sellExVatCents == null || sellExVatCents <= 0) {
    return { ...empty, costExVatCents: input.costExVatCents, decision: "MARGIN_WARNING" as PriceDecision };
  }
  const sellInclVatCents = Math.round((sellExVatCents * 115) / 100);
  const marginPercent = Math.floor(((sellExVatCents - input.costExVatCents) * 100) / sellExVatCents);
  const priced = { costExVatCents: input.costExVatCents, sellExVatCents, sellInclVatCents, marginPercent };
  if (input.abnormalPriceChange) return { ...priced, decision: "PRICE_REVIEW" as PriceDecision };
  if (marginPercent < input.minimumMarginPercent) return { ...priced, decision: "MARGIN_WARNING" as PriceDecision };
  if (marginPercent < input.autoQuoteMarginPercent) return { ...priced, decision: "READY_FOR_APPROVAL" as PriceDecision };
  return { ...priced, decision: "AUTO_QUOTE" as PriceDecision };
}

export function canAutoSend(input: { decisions: PriceDecision[]; matchesHighConfidence: boolean; specificationClear: boolean; autoSendMarginMet: boolean }) {
  return input.matchesHighConfidence
    && input.specificationClear
    && input.autoSendMarginMet
    && input.decisions.length > 0
    && input.decisions.every((decision) => decision === "AUTO_QUOTE");
}

export function factualReply(kind: ReplyKind, facts: { stockQty: number | null; validUntil: string; specifications: string }) {
  if (kind === "STOCK_QUESTION" && facts.stockQty != null) {
    return facts.stockQty > 0
      ? `We currently have ${facts.stockQty} available on the quoted item.`
      : "The quoted item is currently out of stock.";
  }
  if (kind === "MORE_INFORMATION" && facts.validUntil) {
    return `The quotation remains valid until ${facts.validUntil}.`;
  }
  if (kind === "MORE_INFORMATION" && facts.specifications.trim()) {
    return `The stored specification is: ${facts.specifications.trim()}`;
  }
  return null;
}

export function seoFromProduct(input: { brand: string; model: string; productType: string; category: string; specifications: string }) {
  const brand = input.brand.trim();
  const model = input.model.trim();
  const productType = input.productType.trim();
  const features = input.specifications.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2);
  if (brand.length < 2 || model.length < 2 || productType.length < 2) return null;
  const title = `${brand} ${model} ${productType} | Urban Focus South Africa`.replace(/\s+/g, " ").slice(0, 180);
  const featureText = features.length > 0 ? `${features.join(". ")}. ` : "";
  const meta = `${brand} ${model} ${productType}. ${featureText}Available from Urban Focus in South Africa.`.replace(/\s+/g, " ").slice(0, 300);
  const slug = `${brand} ${model} ${productType}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  const short = `${brand} ${model} ${productType}${input.category.trim() ? ` in ${input.category.trim()}` : ""}.`.slice(0, 500);
  const long = [short, input.specifications.trim()].filter(Boolean).join("\n\n").slice(0, 8000);
  return { title, meta, slug, short, long, specifications: input.specifications.trim().slice(0, 8000) };
}

const REJECTED_IMAGE = /watermark|thumbnail|thumb|placeholder|amazon\.|takealot\.|ebay\.|aliexpress|50x50|100x100/i;

export function acceptProductImage(url: string, identity: { brand: string; sku: string; manufacturerPartNumber: string }, pageVerified = false) {
  const value = url.trim();
  if (!value.startsWith("https://") || /\s/.test(value) || value.length > 2000) return false;
  if (REJECTED_IMAGE.test(value)) return false;
  if (pageVerified) return true;
  const token = mpnKey(identity.manufacturerPartNumber) || skuKey(identity.sku);
  return token.length >= 3 && value.toUpperCase().includes(token);
}

export function imagesFromProductPage(html: string, identity: { brand: string; manufacturerPartNumber: string }) {
  const brand = identity.brand.trim().toLowerCase();
  const part = identity.manufacturerPartNumber.trim().toLowerCase();
  if (brand.length < 2 || part.length < 3) return [];
  const page = html.toLowerCase();
  if (!page.includes(brand) || !page.includes(part)) return [];
  const found: string[] = [];
  const patterns = [
    /property=["']og:image["'][^>]*content=["']([^"']+)["']/gi,
    /content=["']([^"']+)["'][^>]*property=["']og:image["']/gi,
    /"image"\s*:\s*"([^"]+)"/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const url = match[1]?.trim() ?? "";
      if (acceptProductImage(url, { brand: identity.brand, sku: "", manufacturerPartNumber: identity.manufacturerPartNumber }, true) && !found.includes(url)) {
        found.push(url);
      }
      if (found.length === 4) return found;
    }
  }
  return found;
}

export type NewProductDecision = "PUBLISH" | "IMAGE_REVIEW_REQUIRED" | "NEW_PRODUCT_REVIEW_REQUIRED";

export function newProductDecision(input: {
  matchedExisting: boolean;
  duplicateBlocked: boolean;
  sku: string;
  manufacturerPartNumber: string;
  name: string;
  brand: string;
  category: string;
  costCents: number | null;
  stockQty: number | null;
  markupPercent: number;
  minimumMarginPercent: number;
  description: string;
  specifications: string;
  imageUrls: string[];
}): NewProductDecision {
  if (input.matchedExisting || input.duplicateBlocked) return "NEW_PRODUCT_REVIEW_REQUIRED";
  const identity = mpnKey(input.manufacturerPartNumber).length >= 3 || skuKey(input.sku).length >= 3;
  const content = input.description.trim().length >= 20 || input.specifications.trim().length >= 20;
  const sell = input.costCents != null ? markedUpCents(input.costCents, input.markupPercent) : null;
  const margin = sell != null && input.costCents != null && sell > 0 ? Math.floor(((sell - input.costCents) * 100) / sell) : -1;
  const priced = input.costCents != null && input.costCents > 0 && sell != null && margin >= input.minimumMarginPercent;
  const images = input.imageUrls.filter((url) => acceptProductImage(url, input));
  const ready = identity
    && input.name.trim().length >= 3
    && input.brand.trim().length >= 2
    && input.category.trim().length >= 2
    && (input.stockQty ?? 0) > 0
    && priced
    && content;
  if (!ready) return "NEW_PRODUCT_REVIEW_REQUIRED";
  if (images.length === 0) return "IMAGE_REVIEW_REQUIRED";
  return "PUBLISH";
}

export function storeStockInstruction(quantity: number) {
  const stockQuantity = Math.max(0, Math.floor(quantity));
  return { stockQuantity, inStock: stockQuantity > 0, deleteProduct: false };
}

function productLine(line: string): RfqLineDraft | null {
  if (/^(name|company|email|deliver|delivery|required|need|regards|thanks|good|hi|hello|dear)\b/i.test(line)) return null;
  const times = line.match(/^(\d+)\s*[x×]\s+(.+)$/i);
  const labeled = line.match(/^(.+?)\s+(?:qty|quantity)\s*[:\-]?\s*(\d+)\b/i);
  const quantity = times ? Number(times[1]) : labeled ? Number(labeled[2]) : null;
  const description = (times?.[2] ?? labeled?.[1] ?? "").trim();
  if (quantity == null || !Number.isInteger(quantity) || quantity <= 0 || description.length < 2) return null;
  const sku = token(description, /(?:sku)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})/i);
  const manufacturerPartNumber = token(description, /(?:mpn|part(?:\s*number)?|model)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})/i);
  return {
    description: description.slice(0, 300),
    quantity,
    manufacturer: "",
    model: manufacturerPartNumber,
    sku,
    manufacturerPartNumber,
    specifications: "",
  };
}

function inlineQuantity(line: string): RfqLineDraft | null {
  const match = line.match(/\b(\d+)\s*[x×]\s+(.+?)\.?\s*$/i);
  if (!match?.[1] || !match[2]) return null;
  return productLine(`${match[1]} x ${match[2].replace(/\.$/, "")}`);
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20,
};

export function groundAiRfqExtraction(raw: unknown, source: string): ExtractedRfq {
  const empty: ExtractedRfq = { customerName: "", companyName: "", email: "", reference: "", deliveryLocation: "", requiredDate: "", notes: "", lines: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const record = raw as Record<string, unknown>;
  const text = (value: unknown) => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim().slice(0, 300);
    return trimmed && source.toLowerCase().includes(trimmed.toLowerCase()) ? trimmed : "";
  };
  const lines = Array.isArray(record.lines) ? record.lines.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const line = entry as Record<string, unknown>;
    const quantity = groundedQuantity(line.quantity, source);
    const description = text(line.description);
    if (quantity == null || description.length < 2) return [];
    const manufacturerPartNumber = text(line.manufacturerPartNumber).toUpperCase();
    return [{
      description,
      quantity,
      manufacturer: text(line.manufacturer),
      model: text(line.model),
      sku: text(line.sku).toUpperCase(),
      manufacturerPartNumber,
      specifications: text(line.specifications),
    }];
  }) : [];
  return {
    customerName: text(record.customerName),
    companyName: text(record.companyName),
    email: text(record.email).toLowerCase(),
    reference: text(record.reference),
    deliveryLocation: text(record.deliveryLocation),
    requiredDate: text(record.requiredDate),
    notes: "",
    lines,
  };
}

export function mergeRfqExtraction(base: ExtractedRfq, grounded: ExtractedRfq): ExtractedRfq {
  if (base.lines.length > 0) return base;
  return {
    customerName: base.customerName || grounded.customerName,
    companyName: base.companyName || grounded.companyName,
    email: base.email || grounded.email,
    reference: base.reference || grounded.reference,
    deliveryLocation: base.deliveryLocation || grounded.deliveryLocation,
    requiredDate: base.requiredDate || grounded.requiredDate,
    notes: "",
    lines: grounded.lines,
  };
}

function groundedQuantity(value: unknown, source: string) {
  const quantity = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
  if (quantity == null || !Number.isInteger(quantity) || quantity <= 0 || quantity > 100000) return null;
  if (new RegExp(`\\b${quantity}\\b`).test(source)) return quantity;
  const word = Object.entries(NUMBER_WORDS).find(([, number]) => number === quantity)?.[0];
  return word && new RegExp(`\\b${word}\\b`, "i").test(source) ? quantity : null;
}

function token(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1]?.toUpperCase().slice(0, 80) ?? "";
}

export function nameKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function fuzzyName(value: string, hits: readonly CatalogueHit[]) {
  const tokens = nameKey(value).split(" ").filter((token) => token.length >= 4);
  if (tokens.length < 2) return null;
  const found = hits.filter((hit) => {
    const words = new Set(hit.nameKey.split(" "));
    const shared = tokens.filter((token) => words.has(token)).length;
    return shared >= 2 && shared / Math.min(tokens.length, words.size || 1) >= 0.8;
  });
  return found.length === 1 ? found[0] : null;
}
