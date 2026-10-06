import { displayedQuoteNumber, formatCurrency, formatQuoteDate, lineTotalCents, quoteTotalCents, urbanFocusQuoteNumber } from "./quote";

export { displayedQuoteNumber, urbanFocusQuoteNumber };

export const QUOTATION_AVAILABILITY = "Subject to stock at time of order.";
export const QUOTATION_CUSTOMER_MESSAGE = "Thank you for the opportunity to quote. Please use the quotation number as your payment and correspondence reference.";

export const QUOTATION_BANK = {
  bankName: "Nedbank",
  accountNumber: "1304574253",
  accountType: "Current Account",
  branchCode: "198765",
};

export const QUOTATION_TERMS: Array<{ label: string; text: string }> = [
  "Quotation is valid until the date stated above and is subject to stock availability.",
  "Payment is required before dispatch unless approved credit terms are in place.",
  "Delivery charges are excluded unless specifically stated on this quotation.",
  "New hardware carries a minimum 12-month warranty unless a longer manufacturer warranty is specified.",
  "Returns require prior approval. Special-order, configured and activated/licensed products may not be returnable unless defective.",
  "Product substitutions will only be made with customer approval.",
  "Urban Focus reserves the right to correct genuine pricing or calculation errors before order acceptance.",
].map((text, index) => ({ label: String(index + 1), text }));

export const VAT_RATE = 15;

export type ComplianceStatus = "COMPLIES" | "EXCEEDS" | "DEVIATION" | "INCLUDED" | "TO BE CONFIRMED";

export type QuoteCompanySettings = {
  legalName: string;
  addressLines: string[];
  phone: string;
  email: string;
  website: string;
  vatNumber: string;
  showVatNumber: boolean;
  showBanking: boolean;
  bankName: string;
  accountName: string;
  accountNumber: string;
  branchCode: string;
  accountType: string;
  availability: string;
  leadTime: string;
  paymentTerms: string;
  validity: string;
  delivery: string;
  newGenuine: string;
  substitution: string;
  taxes: string;
  warranty: string;
  exportNote: string;
};

export type QuotationLineInput = {
  description: string;
  quantity: number;
  unitPriceCents: number;
  specifications: string;
  sku: string;
  modelName: string;
  manufacturerPartNumber: string;
  availability: string;
  leadTime: string;
  warranty: string;
  requirementText: string;
  matchGrade: string;
  costStatus: string;
  scheduleNumber?: string;
};

export type QuotationDocument = {
  mode: "STANDARD" | "FORMAL";
  exportQuote: boolean;
  numberLabel: string;
  filename: string;
  issuedLabel: string;
  validUntilLabel: string;
  currency: string;
  customerCompany: string;
  contactName: string;
  email: string;
  customerPhone: string;
  customerReference: string;
  deliveryLocation: string;
  subject: string;
  company: QuoteCompanySettings;
  lines: Array<{
    description: string;
    configuration: string;
    identity: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
    scheduleNumber: string;
  }>;
  subtotalExclCents: number;
  vatCents: number;
  totalInclCents: number;
  terms: Array<{ label: string; text: string }>;
  banking: { bankName: string; accountName: string; accountNumber: string; branchCode: string; accountType: string; reference: string } | null;
  compliance: Array<{ item: string; requirement: string; proposed: string; status: ComplianceStatus }>;
  references: string[];
  customerMessage: string;
  availability: string;
  alternatives: boolean;
};

export function defaultQuoteCompanySettings(): QuoteCompanySettings {
  return {
    legalName: "Urban Focus",
    addressLines: ["17 Waterloo Road", "Samrand Business Park", "Centurion, Gauteng, South Africa"],
    phone: "087 550 1813",
    email: "sales@urbanfocus.co.za",
    website: "www.urbanfocus.co.za",
    vatNumber: "",
    showVatNumber: false,
    showBanking: false,
    bankName: "",
    accountName: "",
    accountNumber: "",
    branchCode: "",
    accountType: "",
    availability: "Subject to stock at the time of order.",
    leadTime: "Lead time is confirmed when the order is placed.",
    paymentTerms: "Payment is due before dispatch unless approved written credit terms exist. Goods remain the property of Urban Focus until payment has been received in full.",
    validity: "This quotation is valid until the stated expiry date and may be revised thereafter due to changes in supplier pricing, exchange rates, availability or other commercial factors.",
    delivery: "Delivery charges are excluded unless specifically listed in the quotation. Delivery dates are estimates and are confirmed after payment or order acceptance and stock confirmation.",
    newGenuine: "The products quoted are new and genuine unless a line states otherwise.",
    substitution: "Urban Focus will not substitute a quoted product without informing the customer. Where the exact product becomes unavailable, an equivalent or better alternative may be proposed for customer approval.",
    taxes: "Prices are exclusive of VAT. VAT at 15% is added to the total.",
    warranty: "All new hardware products supplied by Urban Focus carry a minimum 12-month warranty from the date of delivery unless a longer manufacturer warranty is stated on the quotation or product documentation.",
    exportNote: "This quotation is prepared for export. Destination duties and taxes are excluded unless a line includes them.",
  };
}

export function quotePdfFilename(sequence: number, issuedAt: Date, storedFilename = "") {
  return `${displayedQuoteNumber(sequence, issuedAt, storedFilename)}.pdf`;
}

export function quotationEmailSubject(sequence: number, issuedAt: Date, storedFilename = "") {
  return `Quotation ${displayedQuoteNumber(sequence, issuedAt, storedFilename)}`;
}

export function quoteCoverEmail(input: { customerName: string; quoteNumber: string; validUntil: Date }) {
  const name = input.customerName.trim();
  return [
    name ? `Good day ${name},` : "Good day,",
    "",
    `Please find attached Urban Focus quotation ${input.quoteNumber} in response to your enquiry.`,
    `The quotation is valid until ${formatQuoteDate(input.validUntil)}.`,
    "Please let us know if you require any amendments or further information.",
    "",
    "Regards,",
    "Urban Focus Sales Team",
  ].join("\n");
}

export function quotationTotals(lines: { quantity: number; unitPriceCents: number }[]) {
  const subtotalExclCents = quoteTotalCents(lines);
  if (subtotalExclCents === null) return null;
  const vatCents = Math.round((subtotalExclCents * VAT_RATE) / 100);
  return { subtotalExclCents, vatCents, totalInclCents: subtotalExclCents + vatCents };
}

export function buildQuotationDocument(input: {
  mode: "STANDARD" | "FORMAL";
  exportQuote: boolean;
  sequence: number | null;
  issuedAt: Date;
  validUntil: Date;
  currency: string;
  customerCompany: string;
  contactName: string;
  email: string;
  customerPhone?: string;
  customerReference: string;
  deliveryLocation: string;
  subject: string;
  company: QuoteCompanySettings;
  lines: QuotationLineInput[];
  references: string[];
  blockedReferenceUrls?: string[];
  storedFilename?: string;
}): QuotationDocument {
  const totals = quotationTotals(input.lines);
  if (!totals) throw new Error("The quotation totals could not be calculated.");
  const numberLabel = input.sequence == null ? "" : displayedQuoteNumber(input.sequence, input.issuedAt, input.storedFilename ?? "");
  const filename = input.sequence == null ? "quotation.pdf" : quotePdfFilename(input.sequence, input.issuedAt, input.storedFilename ?? "");
  const company = { ...input.company, showVatNumber: input.company.showVatNumber && input.company.vatNumber.trim().length > 0 };
  const terms = QUOTATION_TERMS;
  const banking = {
    bankName: QUOTATION_BANK.bankName,
    accountName: "",
    accountNumber: QUOTATION_BANK.accountNumber,
    branchCode: QUOTATION_BANK.branchCode,
    accountType: QUOTATION_BANK.accountType,
    reference: numberLabel,
  };
  const blocked = new Set((input.blockedReferenceUrls ?? []).map((url) => url.trim()).filter(Boolean));
  const references = input.mode === "FORMAL"
    ? input.references.map((url) => url.trim()).filter((url) => url.startsWith("https://") && !blocked.has(url))
    : [];
  return {
    mode: input.mode,
    exportQuote: input.exportQuote,
    numberLabel,
    filename,
    issuedLabel: formatQuoteDate(input.issuedAt),
    validUntilLabel: formatQuoteDate(input.validUntil),
    currency: input.currency || "ZAR",
    customerCompany: input.customerCompany.trim(),
    contactName: input.contactName.trim(),
    email: input.email.trim(),
    customerPhone: input.customerPhone?.trim() ?? "",
    customerReference: customerRfqReference(input.customerReference, input.subject),
    deliveryLocation: input.deliveryLocation.trim(),
    subject: input.subject.trim(),
    company,
    lines: input.lines.map((line, index) => {
      const formatted = formatQuotationLine({
        name: line.modelName,
        description: line.description,
        model: line.modelName,
        specifications: line.specifications,
        sku: line.sku,
        manufacturerPartNumber: line.manufacturerPartNumber,
      });
      return {
        description: formatted.primary,
        configuration: shortConfiguration(formatted.detail),
        identity: formatted.identifier,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        lineTotalCents: lineTotalCents(line.quantity, line.unitPriceCents) ?? 0,
        scheduleNumber: line.scheduleNumber?.trim() || String(index + 1),
      };
    }),
    ...totals,
    terms,
    banking,
    compliance: input.mode === "FORMAL" ? input.lines.flatMap((line, index) => complianceForLine(line, index)) : [],
    references,
    customerMessage: QUOTATION_CUSTOMER_MESSAGE,
    availability: QUOTATION_AVAILABILITY,
    alternatives: input.lines.length > 1 && input.lines.every((line) => /^OPTION\s+\d+/i.test(line.description.trim()) && !line.modelName.trim()),
  };
}

export function documentContainsInternalPricing(document: QuotationDocument) {
  const text = JSON.stringify({
    lines: document.lines,
    terms: document.terms,
    compliance: document.compliance,
    references: document.references,
    customerCompany: document.customerCompany,
    subject: document.subject,
  }).toLowerCase();
  return /\b(markup|margin|supplier cost|sourceurl|stockfeed)\b/.test(text);
}

export function formatQuotationLine(input: {
  name?: string;
  description?: string;
  model?: string;
  specifications?: string;
  sku?: string;
  manufacturerPartNumber?: string;
}) {
  const name = collapseRepeated(input.name ?? "");
  const description = collapseRepeated(input.description ?? "");
  const model = collapseRepeated(input.model ?? "");
  const specifications = collapseRepeated(input.specifications ?? "");
  const primary = name || description || model || specifications;
  const known = [primary, name, model].filter(Boolean);
  const extras: string[] = [];
  for (const candidate of [description, model, specifications]) {
    const detail = stripKnown(candidate, known);
    if (!detail || comparable(detail) === comparable(primary)) continue;
    const existing = extras.findIndex((item) => comparable(item) === comparable(detail) || comparable(item).includes(comparable(detail)) || comparable(detail).includes(comparable(item)));
    if (existing >= 0) {
      if (detail.length > extras[existing].length) extras[existing] = detail;
      continue;
    }
    extras.push(detail);
  }
  const sku = normaliseWhitespace(input.sku ?? "");
  const partNumber = normaliseWhitespace(input.manufacturerPartNumber ?? "");
  const prose = [primary, ...extras].filter(Boolean).join(" ");
  const identifier = [
    sku && !includesToken(prose, sku) ? `SKU: ${sku}` : "",
    partNumber && partNumber.toLowerCase() !== sku.toLowerCase() && !includesToken(prose, partNumber) ? `MPN: ${partNumber}` : "",
  ].filter(Boolean).join("\n");
  return { primary, detail: extras.join("\n"), identifier };
}

function customerRfqReference(reference: string, subject: string) {
  const values = [normaliseWhitespace(reference), normaliseWhitespace(subject)].filter(Boolean);
  return values.filter((value, index) => values.findIndex((item) => comparable(item) === comparable(value)) === index).join(" — ");
}

function normaliseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function comparable(value: string) {
  return normaliseWhitespace(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function collapseRepeated(value: string) {
  const clean = normaliseWhitespace(value);
  if (!clean) return "";
  const words = clean.split(" ");
  for (let size = 1; size <= Math.floor(words.length / 2); size += 1) {
    if (words.length % size !== 0) continue;
    const phrase = words.slice(0, size).join(" ");
    const repeats = words.length / size;
    if (repeats < 2) continue;
    if (Array.from({ length: repeats }, () => phrase).join(" ").toLowerCase() === clean.toLowerCase()) return phrase;
  }
  return clean;
}

function stripKnown(value: string, known: string[]) {
  let rest = collapseRepeated(value);
  if (!rest) return "";
  for (const item of known.map((entry) => collapseRepeated(entry)).filter((entry) => entry.length >= 8)) {
    if (comparable(rest) === comparable(item)) return "";
    const pattern = new RegExp(escapeRegExp(item), "ig");
    const next = collapseRepeated(normaliseWhitespace(rest.replace(pattern, " ")));
    if (!next || comparable(next) === comparable(rest)) continue;
    rest = next;
  }
  return /[a-z0-9]/i.test(rest) ? rest : "";
}

function includesToken(haystack: string, token: string) {
  const needle = comparable(token);
  return needle.length > 0 && comparable(haystack).includes(needle);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shortConfiguration(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 280 ? `${clean.slice(0, 277)}...` : clean;
}

function complianceForLine(line: QuotationLineInput, index: number) {
  const requirement = line.requirementText.trim();
  const proposed = line.specifications.trim();
  const verified = line.costStatus === "VERIFIED" && (line.matchGrade === "EXACT" || line.matchGrade === "MEETS_REQUIREMENT" || line.matchGrade === "EXCEEDS_REQUIREMENT");
  const rows = compareSpecFields(requirement, proposed, verified);
  if (rows.length > 0) return rows.map((row) => ({ item: `${index + 1}. ${line.description}`, ...row }));
  return [{
    item: `${index + 1}. ${line.description}`,
    requirement: requirement || "Not stated",
    proposed: proposed || "Not stated",
    status: "TO BE CONFIRMED" as const,
  }];
}

function compareSpecFields(requirement: string, proposed: string, verified: boolean) {
  const wanted = readSpecs(requirement);
  const offered = readSpecs(proposed);
  const rows: Array<{ requirement: string; proposed: string; status: ComplianceStatus }> = [];
  const push = (label: string, required: string, actual: string, status: ComplianceStatus) => {
    if (!required) return;
    rows.push({ requirement: `${label}: ${required}`, proposed: actual ? `${label}: ${actual}` : "Not stated", status: actual ? status : "TO BE CONFIRMED" });
  };
  push("Processor", wanted.processor, offered.processor, processorStatus(wanted.processor, offered.processor, verified));
  push("RAM", wanted.ram, offered.ram, numberStatus(wanted.ramGb, offered.ramGb, verified));
  push("Storage", wanted.storage, offered.storage, numberStatus(wanted.storageGb, offered.storageGb, verified));
  push("Display", wanted.display, offered.display, numberStatus(wanted.screen, offered.screen, verified));
  push("Operating system", wanted.os, offered.os, textStatus(wanted.os, offered.os, verified));
  push("Warranty", wanted.warranty, offered.warranty, textStatus(wanted.warranty, offered.warranty, verified));
  for (const port of wanted.ports) {
    const present = offered.ports.includes(port);
    rows.push({
      requirement: `Ports: ${port}`,
      proposed: present ? `Ports: ${port}` : "Not stated",
      status: present ? (verified ? "INCLUDED" : "TO BE CONFIRMED") : "TO BE CONFIRMED",
    });
  }
  return rows;
}

function processorStatus(required: string, offered: string, verified: boolean): ComplianceStatus {
  if (!offered) return "TO BE CONFIRMED";
  if (!verified) return "TO BE CONFIRMED";
  const rank = (value: string) => /i3/.test(value) ? 3 : /i5/.test(value) ? 5 : /i7/.test(value) ? 7 : /i9/.test(value) ? 9 : 0;
  const left = rank(required.toLowerCase());
  const right = rank(offered.toLowerCase());
  if (left === 0 || right === 0 || right < left) return "DEVIATION";
  if (right > left) return "EXCEEDS";
  return "COMPLIES";
}

function numberStatus(required: number | null, offered: number | null, verified: boolean): ComplianceStatus {
  if (offered == null) return "TO BE CONFIRMED";
  if (!verified || required == null) return "TO BE CONFIRMED";
  if (offered < required) return "DEVIATION";
  if (offered > required) return "EXCEEDS";
  return "COMPLIES";
}

function textStatus(required: string, offered: string, verified: boolean): ComplianceStatus {
  if (!offered) return "TO BE CONFIRMED";
  if (!verified) return "TO BE CONFIRMED";
  return required.toLowerCase() === offered.toLowerCase() ? "COMPLIES" : "DEVIATION";
}

function readSpecs(text: string) {
  const core = text.match(/\bcore\s+i([3579])\b/i);
  const ram = text.match(/\b(\d+)\s*gb\s*(?:ram|memory)\b/i);
  const disk = text.match(/\b(\d+)\s*(gb|tb)\s*(ssd|nvme|hdd)\b/i);
  const screen = text.match(/\b(\d+(?:\.\d+)?)\s*(?:-| )?\s*(?:inch|inches)\b/i);
  const os = text.match(/\bwindows\s+11(?:\s+(?:pro|home))?\b/i)?.[0] ?? "";
  const warranty = text.match(/\b(\d+\s*(?:year|yr)s?\s+warranty)\b/i)?.[1] ?? "";
  const ports = ["USB-C", "HDMI", "RJ45", "Thunderbolt"].filter((port) => new RegExp(port, "i").test(text));
  const storageGb = disk?.[1] ? (disk[2].toLowerCase() === "tb" ? Number(disk[1]) * 1024 : Number(disk[1])) : null;
  return {
    processor: core ? `Core i${core[1]}` : "",
    ram: ram ? `${ram[1]}GB RAM` : "",
    ramGb: ram ? Number(ram[1]) : null,
    storage: disk ? `${disk[1]}${disk[2].toUpperCase()} ${disk[3].toUpperCase()}` : "",
    storageGb,
    display: screen ? `${screen[1]} inch` : "",
    screen: screen ? Number(screen[1]) : null,
    os,
    warranty,
    ports,
  };
}

export function moneyLabel(cents: number) {
  return formatCurrency(cents / 100);
}
