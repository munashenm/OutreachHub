import { getDb } from "../lib/db";
import { AppError } from "../lib/errors";
import { publicQuoteSettings, readQuoteCompanySettings, type PublicQuoteSettings } from "../lib/quote-settings";
import { buildQuotationDocument, type QuoteCompanySettings } from "../lib/quotation-document";
import { renderQuotationPdf } from "../lib/quotation-pdf";
import { quoteValidUntil } from "../lib/quote";
import { decryptSecret, encryptSecret } from "../lib/token-crypto";
import type { Actor } from "./types";

export async function quoteSettingsForForm(workspaceId: string): Promise<PublicQuoteSettings> {
  const workspace = await getDb().workspace.findFirst({ where: { id: workspaceId }, select: { quoteSettings: true } });
  return publicQuoteSettings(workspace?.quoteSettings);
}

export async function saveQuoteSettings(actor: Actor, input: QuoteCompanySettings) {
  const current = await getDb().workspace.findFirst({ where: { id: actor.workspaceId }, select: { quoteSettings: true } });
  const existing = readQuoteCompanySettings(current?.quoteSettings);
  const accountNumber = sealOrKeep(input.accountNumber, existing.accountNumber);
  const branchCode = sealOrKeep(input.branchCode, existing.branchCode);
  await getDb().workspace.update({
    where: { id: actor.workspaceId },
    data: {
      quoteSettings: {
        ...input,
        accountNumber,
        branchCode,
        showVatNumber: input.showVatNumber && input.vatNumber.trim().length > 0,
      },
    },
  });
}

export async function generateQuotePdf(workspaceId: string, quoteId: string, options?: { mode?: "STANDARD" | "FORMAL"; exportQuote?: boolean; references?: string }) {
  const quote = await getDb().quote.findFirst({
    where: { id: quoteId, workspaceId },
    include: {
      lines: {
        orderBy: { id: "asc" },
        include: { product: { select: { sku: true, name: true, manufacturerPartNumber: true, specifications: true } } },
      },
      rfq: { include: { prospect: true, company: true, sourceMessage: true, lines: { orderBy: { id: "asc" } } } },
      workspace: { select: { quoteSettings: true } },
    },
  });
  if (!quote) throw new AppError("Quotation not found.", 404, "NOT_FOUND");
  if (quote.status === "SENT") {
    if (!quote.pdf || !quote.pdfFilename) throw new AppError("The issued quotation PDF is not stored.");
    return { filename: quote.pdfFilename, bytes: Buffer.from(quote.pdf) };
  }
  const issuedAt = quote.issuedAt ?? new Date();
  const validUntil = quote.validUntil ?? quoteValidUntil(issuedAt, quote.validDays);
  const mode = options?.mode === "FORMAL" || quote.documentMode === "FORMAL" ? "FORMAL" : "STANDARD";
  const exportQuote = options?.exportQuote ?? quote.exportQuote;
  const company = companyForPdf(quote.workspace.quoteSettings);
  const document = buildQuotationDocument({
    mode,
    exportQuote,
    sequence: quote.number,
    issuedAt,
    validUntil,
    currency: quote.currency,
    customerCompany: quote.rfq.company?.companyName ?? "",
    contactName: quote.rfq.prospect ? `${quote.rfq.prospect.firstName} ${quote.rfq.prospect.lastName}`.trim() : quote.rfq.sourceMessage.fromName ?? "",
    email: quote.rfq.prospect?.email || quote.rfq.sourceMessage.fromEmail || "",
    customerReference: quote.rfq.customerReference,
    deliveryLocation: quote.rfq.deliveryLocation,
    subject: quote.rfq.subject,
    company,
    references: (options?.references ?? quote.references).split(/\s+/),
    blockedReferenceUrls: quote.lines.map((line) => line.sourceUrl),
    lines: quote.lines.map((line, index) => ({
      description: line.description,
      quantity: Number(line.quantity),
      unitPriceCents: line.unitPriceCents,
      specifications: line.specifications.trim() || (quote.status === "DRAFT" ? line.product?.specifications ?? "" : ""),
      sku: line.sku || (quote.status === "DRAFT" ? line.product?.sku ?? "" : ""),
      modelName: line.modelName || (quote.status === "DRAFT" ? line.product?.name ?? "" : ""),
      manufacturerPartNumber: line.manufacturerPartNumber || (quote.status === "DRAFT" ? line.product?.manufacturerPartNumber ?? "" : ""),
      availability: line.availability || company.availability,
      leadTime: line.leadTime || company.leadTime,
      warranty: line.warranty || company.warranty,
      requirementText: line.requirementText || quote.rfq.lines[index]?.specifications || quote.rfq.lines[index]?.description || "",
      matchGrade: line.matchGrade,
      costStatus: line.costStatus,
    })),
  });
  const bytes = await renderQuotationPdf(document);
  await getDb().quote.update({
    where: { id: quote.id },
    data: { pdf: Uint8Array.from(bytes), pdfFilename: document.filename, documentMode: mode, exportQuote, references: options?.references ?? quote.references },
  });
  return { filename: document.filename, bytes };
}

function companyForPdf(value: unknown): QuoteCompanySettings {
  const settings = readQuoteCompanySettings(value);
  return {
    ...settings,
    accountNumber: openBank(settings.accountNumber),
    branchCode: openBank(settings.branchCode),
  };
}

function openBank(value: string) {
  if (!value.includes(".")) return value;
  try {
    return decryptSecret(value);
  } catch {
    return "";
  }
}

function sealOrKeep(next: string, current: string) {
  const trimmed = next.trim();
  if (!trimmed) return current;
  try {
    return encryptSecret(trimmed);
  } catch {
    throw new AppError("Set OAUTH_ENCRYPTION_KEY before saving banking details.");
  }
}
