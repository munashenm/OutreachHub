import { formatCents, formatQuoteDate, formatQuoteNumber, lineTotalCents, quoteTotalCents } from "./quote";

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
  }>;
  subtotalExclCents: number;
  vatCents: number;
  totalInclCents: number;
  terms: Array<{ label: string; text: string }>;
  banking: { bankName: string; accountName: string; accountNumber: string; branchCode: string; accountType: string; reference: string } | null;
  compliance: Array<{ item: string; requirement: string; proposed: string; status: ComplianceStatus }>;
  references: string[];
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
    paymentTerms: "Payment is due before dispatch unless written credit terms already exist.",
    validity: "This quotation is valid until the date shown above.",
    delivery: "Delivery is to the stated address. Delivery charges are excluded unless a line includes them.",
    newGenuine: "The products quoted are new and genuine unless a line states otherwise.",
    substitution: "A substitute is supplied only when this quotation names that substitute.",
    taxes: "Prices are exclusive of VAT. VAT at 15% is added to the total.",
    warranty: "The manufacturer warranty applies unless a line states a different warranty.",
    exportNote: "This quotation is prepared for export. Destination duties and taxes are excluded unless a line includes them.",
  };
}

export function urbanFocusQuoteNumber(sequence: number, issuedAt: Date) {
  return `UF-${formatQuoteNumber(sequence, issuedAt)}`;
}

export function quotePdfFilename(sequence: number, issuedAt: Date) {
  return `${urbanFocusQuoteNumber(sequence, issuedAt)}.pdf`;
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
  customerReference: string;
  deliveryLocation: string;
  subject: string;
  company: QuoteCompanySettings;
  lines: QuotationLineInput[];
  references: string[];
  blockedReferenceUrls?: string[];
}): QuotationDocument {
  const totals = quotationTotals(input.lines);
  if (!totals) throw new Error("The quotation totals could not be calculated.");
  const numberLabel = input.sequence == null ? "Draft" : urbanFocusQuoteNumber(input.sequence, input.issuedAt);
  const filename = input.sequence == null ? "UF-Q-DRAFT.pdf" : quotePdfFilename(input.sequence, input.issuedAt);
  const company = { ...input.company, showVatNumber: input.company.showVatNumber && input.company.vatNumber.trim().length > 0 };
  const terms = [
    { label: "Availability / Lead Time", text: joinTerm(input.company.availability, input.company.leadTime) },
    { label: "Payment Terms", text: input.company.paymentTerms },
    { label: "Quotation Validity", text: input.company.validity },
    { label: "Delivery", text: input.company.delivery },
    { label: "New / Genuine", text: input.company.newGenuine },
    { label: "Substitution", text: input.company.substitution },
    { label: "Taxes / Duties", text: input.exportQuote ? `${input.company.taxes} ${input.company.exportNote}`.trim() : input.company.taxes },
    { label: "Warranty", text: input.company.warranty },
  ].filter((term) => term.text.length > 0);
  const banking = company.showBanking && company.accountNumber.trim()
    ? {
        bankName: company.bankName,
        accountName: company.accountName,
        accountNumber: company.accountNumber,
        branchCode: company.branchCode,
        accountType: company.accountType,
        reference: numberLabel,
      }
    : null;
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
    customerReference: input.customerReference.trim(),
    deliveryLocation: input.deliveryLocation.trim(),
    subject: input.subject.trim(),
    company,
    lines: input.lines.map((line) => ({
      description: line.modelName.trim() || line.description.trim(),
      configuration: shortConfiguration(line.specifications),
      identity: [line.sku, line.manufacturerPartNumber].filter(Boolean).join(" · "),
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: lineTotalCents(line.quantity, line.unitPriceCents) ?? 0,
    })),
    ...totals,
    terms,
    banking,
    compliance: input.mode === "FORMAL" ? input.lines.flatMap((line, index) => complianceForLine(line, index)) : [],
    references,
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

function joinTerm(left: string, right: string) {
  return [left.trim(), right.trim()].filter(Boolean).join(" ");
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

export function moneyLabel(cents: number, currency: string) {
  return formatCents(cents, currency);
}
