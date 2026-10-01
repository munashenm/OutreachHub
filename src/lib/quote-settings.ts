import { defaultQuoteCompanySettings, type QuoteCompanySettings } from "./quotation-document";

export type PublicQuoteSettings = QuoteCompanySettings & { hasAccountNumber: boolean; hasBranchCode: boolean };

export function readQuoteCompanySettings(value: unknown): QuoteCompanySettings {
  const defaults = defaultQuoteCompanySettings();
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const source = value as Record<string, unknown>;
  const text = (key: keyof QuoteCompanySettings, fallback: string) => typeof source[key] === "string" ? (source[key] as string).trim() : fallback;
  const address = Array.isArray(source.addressLines) ? source.addressLines.filter((line): line is string => typeof line === "string" && line.trim().length > 0) : defaults.addressLines;
  return {
    ...defaults,
    legalName: text("legalName", defaults.legalName) || defaults.legalName,
    addressLines: address.length > 0 ? address : defaults.addressLines,
    phone: text("phone", defaults.phone),
    email: text("email", defaults.email),
    website: text("website", defaults.website),
    vatNumber: text("vatNumber", ""),
    showVatNumber: source.showVatNumber === true && text("vatNumber", "").length > 0,
    showBanking: source.showBanking === true,
    bankName: text("bankName", ""),
    accountName: text("accountName", ""),
    accountNumber: text("accountNumber", ""),
    branchCode: text("branchCode", ""),
    accountType: text("accountType", ""),
    availability: text("availability", defaults.availability),
    leadTime: text("leadTime", defaults.leadTime),
    paymentTerms: text("paymentTerms", defaults.paymentTerms),
    validity: text("validity", defaults.validity),
    delivery: text("delivery", defaults.delivery),
    newGenuine: text("newGenuine", defaults.newGenuine),
    substitution: text("substitution", defaults.substitution),
    taxes: text("taxes", defaults.taxes),
    warranty: text("warranty", defaults.warranty),
    exportNote: text("exportNote", defaults.exportNote),
  };
}

export function publicQuoteSettings(value: unknown): PublicQuoteSettings {
  const settings = readQuoteCompanySettings(value);
  return {
    ...settings,
    accountNumber: "",
    branchCode: "",
    hasAccountNumber: settings.accountNumber.trim().length > 0,
    hasBranchCode: settings.branchCode.trim().length > 0,
  };
}
