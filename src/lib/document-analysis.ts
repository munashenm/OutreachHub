import { compareRequirement, extractProductRequirements, type SourcingCandidate } from "./sourcing";

export const DOCUMENT_KINDS = ["RFQ", "TENDER", "PRICING_SCHEDULE", "TECHNICAL_SPECIFICATION", "TERMS_AND_CONDITIONS", "SUPPORTING_DOCUMENT", "PURCHASE_ORDER", "OTHER"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const RESPONSE_MODES = ["AUTO_SEND", "APPROVAL_REQUIRED", "TENDER_PACKAGE", "CANNOT_QUOTE"] as const;
export type ResponseMode = (typeof RESPONSE_MODES)[number];
export const SPEC_MATCHES = ["MATCH", "PARTIAL MATCH", "NO MATCH", "NEEDS REVIEW"] as const;
export type SpecMatch = (typeof SPEC_MATCHES)[number];

export type AnalysisItem = {
  lineNumber: string;
  specificationGroup: string;
  description: string;
  quantity: number | null;
  unit: string;
  requiredBrand: string;
  requiredModel: string;
  equivalentAllowed: boolean;
  mandatorySpecs: Record<string, string>;
  optionalSpecs: Record<string, string>;
  accessories: string[];
  warrantyRequirements: string;
  serviceRequirements: string;
  sourceDocument: string;
  sourcePage: number | null;
  extractionConfidence: number;
};

export type SourcedValue = { value: string; sourceDocument: string; sourcePage: number | null };

export type DocumentAnalysisRecord = {
  referenceNumber: string;
  customerName: string;
  documentType: DocumentKind;
  requestTitle: string;
  closingDate: string;
  closingTime: string;
  validityPeriod: string;
  deliveryLocation: string;
  deliveryDeadline: string;
  currency: string;
  vatTreatment: "" | "EXCLUSIVE" | "INCLUSIVE";
  submissionMethod: string;
  responseMode: ResponseMode;
  items: AnalysisItem[];
  mandatoryRequirements: SourcedValue[];
  returnableDocuments: SourcedValue[];
  eligibilityRequirements: SourcedValue[];
  pricingRules: SourcedValue[];
  submissionInstructions: SourcedValue[];
  specialConditions: SourcedValue[];
  ambiguities: string[];
  warnings: string[];
  sources: Array<{ field: string; sourceDocument: string; sourcePage: number | null }>;
};

export type DocumentPage = { page: number; text: string };

export type AnalysisMatch = {
  lineNumber: string;
  match: SpecMatch;
  explanation: string;
  productId: string | null;
  productName: string;
  sku: string;
  sourceKind: string;
  sourceName: string;
  sourceUrl: string;
  observedPriceCents: number | null;
  vatIncluded: boolean;
  availability: string;
  observedAt: string;
  pricedFromSupplier: boolean;
  supplierCostCents: number | null;
  shippingCostCents: number | null;
  otherCostCents: number | null;
  configuredMarginPercent: number | null;
  sellingPriceExVatCents: number | null;
  vatCents: number | null;
  sellingPriceInclVatCents: number | null;
  quantity: number | null;
  lineTotalCents: number | null;
};

export const UNPRICED_LINE = {
  supplierCostCents: null,
  shippingCostCents: null,
  otherCostCents: null,
  configuredMarginPercent: null,
  sellingPriceExVatCents: null,
  vatCents: null,
  sellingPriceInclVatCents: null,
  quantity: null,
  lineTotalCents: null,
};

export type StoredDocumentAnalysis = DocumentAnalysisRecord & { matches: AnalysisMatch[] };

const EMPTY_ANALYSIS: DocumentAnalysisRecord = {
  referenceNumber: "",
  customerName: "",
  documentType: "OTHER",
  requestTitle: "",
  closingDate: "",
  closingTime: "",
  validityPeriod: "",
  deliveryLocation: "",
  deliveryDeadline: "",
  currency: "",
  vatTreatment: "",
  submissionMethod: "",
  responseMode: "CANNOT_QUOTE",
  items: [],
  mandatoryRequirements: [],
  returnableDocuments: [],
  eligibilityRequirements: [],
  pricingRules: [],
  submissionInstructions: [],
  specialConditions: [],
  ambiguities: [],
  warnings: [],
  sources: [],
};

export function supportedAttachment(filename: string, contentType: string) {
  const name = filename.toLowerCase();
  const type = contentType.toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf" as const;
  if (type.includes("wordprocessingml") || name.endsWith(".docx")) return "docx" as const;
  if (type.includes("spreadsheetml") || name.endsWith(".xlsx")) return "xlsx" as const;
  if (type === "text/csv" || name.endsWith(".csv")) return "csv" as const;
  if (type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(name)) return "image" as const;
  return null;
}

export function pageIsScanned(text: string) {
  const letters = text.replace(/[^a-z0-9]/gi, "");
  return letters.length < 25;
}

export function classifyDocument(input: { filename: string; text: string }): DocumentKind {
  const text = `${input.filename}\n${input.text}`.replace(/[-_]/g, " ");
  if (/\b(purchase order|\bp\.?o\.?\b)\b/i.test(text) && !/\b(request for quotation|\brfq\b|tender)\b/i.test(input.filename)) return "PURCHASE_ORDER";
  if (/\b(sealed envelope|official tender form|bid submission|invitation to bid)\b/i.test(text) || /\btender\b/i.test(text)) return "TENDER";
  if (/\bpricing schedule\b/i.test(text)) return "PRICING_SCHEDULE";
  if (/\b(technical specification|technical requirements)\b/i.test(text)) return "TECHNICAL_SPECIFICATION";
  if (/\b(terms and conditions|general conditions of contract)\b/i.test(text)) return "TERMS_AND_CONDITIONS";
  if (/\b(request for quotation|\brfq\b|please quote|kindly quote)\b/i.test(text)) return "RFQ";
  if (/\b(brochure|catalogue|datasheet|company profile)\b/i.test(text)) return "SUPPORTING_DOCUMENT";
  return "OTHER";
}

export function analyseDocumentText(input: { filename: string; pages: DocumentPage[] }): DocumentAnalysisRecord {
  const pages = input.pages.length > 0 ? input.pages : [{ page: 1, text: "" }];
  const text = pages.map((page) => page.text).join("\n");
  const record: DocumentAnalysisRecord = { ...EMPTY_ANALYSIS, items: [], sources: [], warnings: [], ambiguities: [] };
  record.documentType = classifyDocument({ filename: input.filename, text });
  record.requestTitle = firstLine(text).slice(0, 200);
  const reference = labeled(pages, ["tender no", "tender number", "rfq no", "rfq number", "reference", "bid no", "enquiry no"]);
  record.referenceNumber = reference?.value ?? "";
  remember(record, "referenceNumber", input.filename, reference?.page ?? null);
  const customer = labeled(pages, ["customer", "client", "buyer", "company", "organisation", "organization"]);
  record.customerName = customer?.value ?? "";
  remember(record, "customerName", input.filename, customer?.page ?? null);
  const closing = labeled(pages, ["closing date", "close date", "closes"]);
  record.closingDate = closing?.value ?? "";
  remember(record, "closingDate", input.filename, closing?.page ?? null);
  const closingTime = labeled(pages, ["closing time"]);
  record.closingTime = closingTime?.value ?? "";
  remember(record, "closingTime", input.filename, closingTime?.page ?? null);
  const validity = labeled(pages, ["validity", "valid for", "quotation validity"]);
  record.validityPeriod = validity?.value ?? "";
  remember(record, "validityPeriod", input.filename, validity?.page ?? null);
  const delivery = labeled(pages, ["delivery location", "place of delivery", "deliver to", "delivery address"]);
  record.deliveryLocation = delivery?.value ?? "";
  remember(record, "deliveryLocation", input.filename, delivery?.page ?? null);
  const deadline = labeled(pages, ["delivery deadline", "delivery date", "delivery within"]);
  record.deliveryDeadline = deadline?.value ?? "";
  remember(record, "deliveryDeadline", input.filename, deadline?.page ?? null);
  record.currency = readCurrency(text);
  record.vatTreatment = readVatTreatment(text);
  record.submissionMethod = readSubmissionMethod(text);
  record.items = extractItems(input.filename, pages);
  record.mandatoryRequirements = sectionLines(pages, input.filename, /\bmandatory\b/i);
  record.returnableDocuments = sectionLines(pages, input.filename, /\breturnable\b/i);
  record.eligibilityRequirements = sectionLines(pages, input.filename, /\beligibility\b/i);
  record.pricingRules = sectionLines(pages, input.filename, /\b(pricing|price|vat)\b/i);
  record.submissionInstructions = sectionLines(pages, input.filename, /\b(submit|submission|sealed|envelope)\b/i);
  record.specialConditions = sectionLines(pages, input.filename, /\bspecial condition/i);
  for (const page of pages) {
    if (pageIsScanned(page.text)) record.warnings.push(`Page ${page.page} of ${input.filename} has no readable text.`);
  }
  for (const item of record.items) {
    if (item.quantity == null) record.ambiguities.push(`Line ${item.lineNumber || item.description} has no quantity in ${input.filename}.`);
    if (!item.description) record.ambiguities.push(`A line in ${input.filename} has no description.`);
  }
  if (record.items.length === 0 && record.documentType !== "TERMS_AND_CONDITIONS" && record.documentType !== "SUPPORTING_DOCUMENT" && record.documentType !== "OTHER") {
    record.ambiguities.push(`${input.filename} did not state a product line.`);
  }
  record.sources = record.sources.filter((source) => source.sourcePage != null || source.field === "documentType");
  record.responseMode = decideResponseMode({
    documentType: record.documentType,
    text,
    itemCount: record.items.length,
    matches: [],
    pricedLines: 0,
    lowConfidence: record.items.some((item) => item.extractionConfidence < 70) || record.warnings.length > 0,
    usesMarketPrice: false,
    substitution: false,
    largeQuotation: record.items.length > 20,
    unusualTerms: record.specialConditions.length > 0,
  });
  return record;
}

export function decideResponseMode(input: {
  documentType: DocumentKind;
  text: string;
  itemCount: number;
  matches: SpecMatch[];
  pricedLines: number;
  lowConfidence: boolean;
  usesMarketPrice: boolean;
  substitution: boolean;
  largeQuotation: boolean;
  unusualTerms: boolean;
}): ResponseMode {
  if (requiresPhysicalSubmission(input.text) || input.documentType === "TENDER") return "TENDER_PACKAGE";
  if (input.itemCount === 0 || input.matches.some((match) => match === "NO MATCH")) return "CANNOT_QUOTE";
  if (input.matches.length > 0 && input.matches.some((match) => match !== "MATCH")) return "APPROVAL_REQUIRED";
  if (input.lowConfidence || input.usesMarketPrice || input.substitution || input.largeQuotation || input.unusualTerms) return "APPROVAL_REQUIRED";
  if (input.pricedLines < input.itemCount) return "APPROVAL_REQUIRED";
  if (input.documentType === "RFQ" && input.itemCount > 0 && input.pricedLines === input.itemCount && input.matches.every((match) => match === "MATCH")) return "AUTO_SEND";
  return "APPROVAL_REQUIRED";
}

export function requiresPhysicalSubmission(text: string) {
  return /\b(sealed envelope|physical submission|hand deliver|official tender form|must be signed|courier the bid)\b/i.test(text);
}

export function requiresEveryLinePriced(text: string) {
  return /\b(all (?:lines|items) must be priced|complete pricing schedule|every line)\b/i.test(text);
}

export function quoteCompletionBlock(input: { requireAllLines: boolean; requested: string[]; priced: string[]; authorisedOverride: boolean }) {
  if (!input.requireAllLines || input.authorisedOverride) return "";
  const missing = input.requested.filter((line) => !input.priced.includes(line));
  if (missing.length === 0) return "";
  return `Lines ${missing.join(", ")} are not priced. The document requires every line to be priced.`;
}

export function readVatTreatment(text: string): "" | "EXCLUSIVE" | "INCLUSIVE" {
  if (/\b(exclusive of vat|excluding vat|vat exclusive|prices exclude vat)\b/i.test(text)) return "EXCLUSIVE";
  if (/\b(inclusive of vat|including vat|vat inclusive|prices include vat)\b/i.test(text)) return "INCLUSIVE";
  return "";
}

export function matchRequestedSpecification(item: AnalysisItem, candidate: SourcingCandidate): { match: SpecMatch; explanation: string } {
  const requested = [
    item.quantity == null ? "1 x" : `${item.quantity} x`,
    item.description,
    Object.entries(item.mandatorySpecs).map(([, value]) => value).join(", "),
  ].filter(Boolean).join(" ");
  const [requirement] = extractProductRequirements(requested);
  if (!requirement) return { match: "NEEDS REVIEW", explanation: "The requested line did not contain a specification that can be checked." };
  if (item.equivalentAllowed) requirement.requestedText = `${requirement.requestedText}\nor equivalent`;
  const grade = compareRequirement(requirement, candidate);
  const offered = `${candidate.name} ${candidate.model} ${candidate.specifications}`;
  const identity = `${candidate.name} ${candidate.model}`.toLowerCase();
  const differentProduct = (item.requiredBrand && !identity.includes(item.requiredBrand.toLowerCase())) || (item.requiredModel && !identity.includes(item.requiredModel.toLowerCase()));
  const missing = Object.entries(item.mandatorySpecs).filter(([, value]) => value && !offered.toLowerCase().includes(value.toLowerCase())).map(([key]) => key);
  if (differentProduct && grade !== "EXACT" && grade !== "MEETS_REQUIREMENT") return { match: "NO MATCH", explanation: `${candidate.name} is not the requested ${item.requiredBrand} ${item.requiredModel}`.trim() + "." };
  if (grade === "DOES_NOT_MEET") return { match: "NO MATCH", explanation: `${candidate.name} does not meet the requested specification.` };
  if (grade === "EXCEEDS_REQUIREMENT" && !item.equivalentAllowed) return { match: "NO MATCH", explanation: `${candidate.name} exceeds the requested specification, and the document does not allow an equivalent.` };
  const stated = Object.keys(item.mandatorySpecs).filter((key) => !missing.includes(key));
  if (missing.length > 0 && stated.length > 0) return { match: "PARTIAL MATCH", explanation: `${candidate.name} matches ${stated.join(", ")} and does not state ${missing.join(", ")}.` };
  if (grade === "PARTIAL" || missing.length > 0) return { match: "NEEDS REVIEW", explanation: missing.length > 0 ? `${candidate.name} does not state ${missing.join(", ")}.` : `${candidate.name} does not state every requested specification.` };
  if (grade === "EXACT" || grade === "MEETS_REQUIREMENT" || (grade === "EXCEEDS_REQUIREMENT" && item.equivalentAllowed)) {
    return { match: "MATCH", explanation: item.equivalentAllowed && grade === "EXCEEDS_REQUIREMENT" ? `${candidate.name} is equal or better, which this document allows.` : `${candidate.name} meets the requested specification.` };
  }
  return { match: "PARTIAL MATCH", explanation: `${candidate.name} meets part of the requested specification.` };
}

export function groupAnalysisKey(record: Pick<DocumentAnalysisRecord, "referenceNumber" | "customerName" | "requestTitle">) {
  if (record.referenceNumber.trim()) return `ref:${record.referenceNumber.trim().toLowerCase()}`;
  return `customer:${record.customerName.trim().toLowerCase()}|${record.requestTitle.trim().toLowerCase()}`;
}

export function shareDocumentContext(records: StoredDocumentAnalysis[]): StoredDocumentAnalysis[] {
  const donors = records.filter((record) => record.referenceNumber.trim());
  return records.map((record) => {
    if (record.referenceNumber.trim() || donors.length === 0) return record;
    const mentioned = `${record.requestTitle}\n${record.items.map((item) => item.description).join("\n")}`.toLowerCase();
    const donor = donors.find((item) => mentioned.includes(item.referenceNumber.trim().toLowerCase()) || (record.customerName.trim() && item.customerName.trim().toLowerCase() === record.customerName.trim().toLowerCase()));
    if (!donor || donor === record) return record;
    const source = donor.sources.find((item) => item.field === "referenceNumber");
    const sourceDocument = source?.sourceDocument || donor.items[0]?.sourceDocument || "";
    const sourcePage = source?.sourcePage ?? donor.items[0]?.sourcePage ?? null;
    return {
      ...record,
      referenceNumber: donor.referenceNumber,
      customerName: record.customerName || donor.customerName,
      closingDate: record.closingDate || donor.closingDate,
      closingTime: record.closingTime || donor.closingTime,
      sources: [...record.sources, { field: "referenceNumber", sourceDocument, sourcePage }],
    };
  });
}

export function analysisAsRequirementText(record: DocumentAnalysisRecord) {
  return record.items.map((item) => {
    const quantity = item.quantity == null ? "" : `${item.quantity} x `;
    const specs = Object.entries(item.mandatorySpecs).map(([key, value]) => `${key} ${value}`).join(", ");
    return `${quantity}${item.description}${specs ? `, ${specs}` : ""}`.trim();
  }).filter(Boolean).join("\n");
}

export function applyAnalysisEdit(record: DocumentAnalysisRecord, field: string, value: string): DocumentAnalysisRecord {
  const next = structuredClone(record);
  if (field === "referenceNumber" || field === "customerName" || field === "requestTitle" || field === "closingDate" || field === "closingTime" || field === "validityPeriod" || field === "deliveryLocation" || field === "deliveryDeadline" || field === "currency" || field === "submissionMethod") {
    next[field] = value.trim();
  }
  if (field === "vatTreatment" && (value === "EXCLUSIVE" || value === "INCLUSIVE" || value === "")) next.vatTreatment = value;
  const line = field.match(/^items\.(\d+)\.(description|quantity|unit|requiredBrand|requiredModel|warrantyRequirements)$/);
  if (line) {
    const item = next.items[Number(line[1])];
    const key = line[2] as "description" | "quantity" | "unit" | "requiredBrand" | "requiredModel" | "warrantyRequirements";
    if (item && key === "quantity") item.quantity = /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
    else if (item && key !== "quantity") item[key] = value.trim();
  }
  return next;
}

function extractItems(filename: string, pages: DocumentPage[]): AnalysisItem[] {
  const items: AnalysisItem[] = [];
  for (const page of pages) {
    const table = tableItems(filename, page);
    if (table.length > 0) {
      items.push(...table);
      continue;
    }
    for (const line of page.text.split(/\r?\n/)) {
      const item = lineItem(filename, page.page, line, items.length + 1);
      if (item) items.push(item);
    }
  }
  return items;
}

function tableItems(filename: string, page: DocumentPage): AnalysisItem[] {
  const rows = page.text.split(/\r?\n/).map((line) => splitRow(line)).filter((row) => row.length > 1);
  const headerIndex = rows.findIndex((row) => row.some((cell) => /description|specification|item/i.test(cell)) && row.some((cell) => /qty|quantity/i.test(cell)));
  if (headerIndex < 0) return [];
  const header = rows[headerIndex].map((cell) => cell.toLowerCase());
  const descriptionIndex = header.findIndex((cell) => /description|specification|item/.test(cell));
  const quantityIndex = header.findIndex((cell) => /qty|quantity/.test(cell));
  const unitIndex = header.findIndex((cell) => cell.trim() === "unit");
  const items: AnalysisItem[] = [];
  for (const [offset, row] of rows.slice(headerIndex + 1).entries()) {
    const description = row[descriptionIndex]?.trim() ?? "";
    if (!description || /description|specification/i.test(description)) continue;
    const quantityText = row[quantityIndex]?.trim() ?? "";
    const quantity = /^\d+$/.test(quantityText) ? Number(quantityText) : null;
    items.push(itemFrom(filename, page.page, String(offset + 1), description, quantity, unitIndex >= 0 ? row[unitIndex]?.trim() ?? "" : "", 90));
  }
  return items;
}

function lineItem(filename: string, page: number, line: string, fallbackNumber: number): AnalysisItem | null {
  const trimmed = line.trim();
  const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
  const quantified = trimmed.match(/^(\d+)\s*[x×]\s+(.+)$/i);
  const chosen = numbered ?? quantified;
  if (!chosen?.[2] || chosen[2].trim().length < 3) return null;
  const quantity = quantified ? Number(quantified[1]) : null;
  return itemFrom(filename, page, numbered?.[1] ?? String(fallbackNumber), chosen[2].trim(), quantity, "", 80);
}

function itemFrom(filename: string, page: number, lineNumber: string, description: string, quantity: number | null, unit: string, confidence: number): AnalysisItem {
  const equivalentAllowed = /\b(or equivalent|equal or better|or similar)\b/i.test(description);
  const brand = description.match(/\b(lenovo|hp|dell|asus|acer|apple|microsoft)\b/i)?.[1] ?? "";
  const model = description.match(/\bthinkpad\s+[a-z]?\d{2}[a-z0-9]*/i)?.[0] ?? "";
  return {
    lineNumber,
    specificationGroup: "",
    description: description.slice(0, 500),
    quantity,
    unit,
    requiredBrand: brand ? brand[0].toUpperCase() + brand.slice(1).toLowerCase() : "",
    requiredModel: model,
    equivalentAllowed,
    mandatorySpecs: specsIn(description),
    optionalSpecs: {},
    accessories: [],
    warrantyRequirements: description.match(/\b(\d+\s*(?:year|yr)s?\s+warranty)\b/i)?.[1] ?? "",
    serviceRequirements: "",
    sourceDocument: filename,
    sourcePage: page,
    extractionConfidence: confidence,
  };
}

function specsIn(text: string) {
  const specs: Record<string, string> = {};
  const processor = text.match(/\b(core\s+ultra\s+[3579]|core\s+i[3579]|ryzen\s+[3579])\b/i)?.[1];
  const ram = text.match(/\b(\d+\s*gb)\s*(?:ram|memory)\b/i)?.[1];
  const storage = text.match(/\b(\d+\s*(?:gb|tb)\s*(?:ssd|nvme|hdd))\b/i)?.[1];
  const screen = text.match(/\b(\d+(?:\.\d+)?\s*(?:inch|inches))\b/i)?.[1];
  const os = text.match(/\b(windows\s+11(?:\s+pro)?)\b/i)?.[1];
  if (processor) specs.cpu = processor;
  if (ram) specs.ram = ram;
  if (storage) specs.storage = storage;
  if (screen) specs.screen = screen;
  if (os) specs.operatingSystem = os;
  if (/\btouch\s*screen\b/i.test(text)) specs.touchScreen = "touch screen";
  if (/\b(lte|sim)\b/i.test(text)) specs.lte = "LTE";
  if (/\btpm\b/i.test(text)) specs.tpm = "TPM";
  if (/\bsecure boot\b/i.test(text)) specs.secureBoot = "secure boot";
  const warranty = text.match(/\b(\d+\s*(?:year|yr)s?\s+warranty)\b/i)?.[1];
  if (warranty) specs.warranty = warranty;
  const ports = ["HDMI", "USB-C", "Thunderbolt", "Ethernet"].filter((port) => new RegExp(port.replace("-", "[- ]?"), "i").test(text));
  if (ports.length > 0) specs.ports = ports.join(", ");
  if (/\btracking software\b/i.test(text)) specs.trackingSoftware = "tracking software";
  return specs;
}

function sectionLines(pages: DocumentPage[], filename: string, pattern: RegExp): SourcedValue[] {
  const found: SourcedValue[] = [];
  for (const page of pages) {
    for (const line of page.text.split(/\r?\n/)) {
      const value = line.trim();
      if (value.length < 8 || value.length > 300 || !pattern.test(value)) continue;
      if (found.some((item) => item.value === value)) continue;
      found.push({ value, sourceDocument: filename, sourcePage: page.page });
    }
  }
  return found.slice(0, 12);
}

function labeled(pages: DocumentPage[], labels: string[]) {
  const pattern = new RegExp(`(?:${labels.map(escapeRegExp).join("|")})\\s*[:\\-]\\s*(.+)`, "i");
  for (const page of pages) {
    for (const line of page.text.split(/\r?\n/)) {
      const match = line.match(pattern);
      const value = match?.[1]?.trim().slice(0, 200) ?? "";
      if (value) return { value, page: page.page };
    }
  }
  return null;
}

function remember(record: DocumentAnalysisRecord, field: string, filename: string, page: number | null) {
  const value = record[field as keyof DocumentAnalysisRecord];
  if (typeof value === "string" && value) record.sources.push({ field, sourceDocument: filename, sourcePage: page });
}

function readCurrency(text: string) {
  if (/\bZAR\b|\bR\s?\d/.test(text)) return "ZAR";
  if (/\bUSD\b/.test(text)) return "USD";
  if (/\bEUR\b/.test(text)) return "EUR";
  return "";
}

function readSubmissionMethod(text: string) {
  if (requiresPhysicalSubmission(text)) return "Physical or sealed submission";
  if (/\b(submit by email|email the quotation)\b/i.test(text)) return "Email";
  if (/\b(portal|e-?submission)\b/i.test(text)) return "Portal";
  return "";
}

function splitRow(line: string) {
  if (line.includes("|")) return line.split("|").map((cell) => cell.trim()).filter(Boolean);
  if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim());
  if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map((cell) => cell.trim());
  return [line.trim()];
}

function firstLine(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
