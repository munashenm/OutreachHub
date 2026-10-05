import { Prisma } from "../generated/prisma/client";
import { priceQuotation } from "../lib/automation";
import { getDb } from "../lib/db";
import {
  analyseDocumentText,
  analysisAsRequirementText,
  applyAnalysisEdit,
  decideResponseMode,
  pageIsScanned,
  quoteCompletionBlock,
  requiresEveryLinePriced,
  supportedAttachment,
  type AnalysisMatch,
  type DocumentAnalysisRecord,
  type ResponseMode,
  type StoredDocumentAnalysis,
} from "../lib/document-analysis";
import { readDocumentFile } from "../lib/document-files";
import { readImageText } from "../lib/document-vision";
import { AppError } from "../lib/errors";
import type { Actor } from "./types";
import { chooseSupplierOffer } from "../lib/supplier-connector";

const MAX_BYTES = 20 * 1024 * 1024;

export async function saveMessageAttachments(workspaceId: string, messageId: string, files: Array<{ filename: string; contentType: string; content: Buffer }>) {
  const db = getDb();
  for (const file of files) {
    if (!supportedAttachment(file.filename, file.contentType)) continue;
    if (file.content.length === 0 || file.content.length > MAX_BYTES) continue;
    const existing = await db.storedAttachment.findFirst({ where: { messageId, filename: file.filename, workspaceId }, select: { id: true } });
    if (existing) continue;
    await db.storedAttachment.create({
      data: { workspaceId, messageId, filename: file.filename.slice(0, 180), contentType: file.contentType.slice(0, 120), content: Uint8Array.from(file.content) },
    });
  }
}

export async function listTenderAnalyses(workspaceId: string, rfqId: string) {
  const rows = await getDb().tenderAnalysis.findMany({
    where: { workspaceId, rfqId },
    include: { edits: { orderBy: { createdAt: "asc" } }, attachment: { select: { id: true, filename: true, contentType: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({ ...row, record: asAnalysis(row.analysis) }));
}

export async function analysisTextForRfq(rfqId: string) {
  const rows = await getDb().tenderAnalysis.findMany({ where: { rfqId }, select: { analysis: true } });
  return rows.map((row) => analysisAsRequirementText(asAnalysis(row.analysis))).filter(Boolean).join("\n");
}

export async function responseModeForRfq(rfqId: string): Promise<ResponseMode | ""> {
  const rows = await getDb().tenderAnalysis.findMany({ where: { rfqId }, select: { responseMode: true } });
  const modes = rows.map((row) => row.responseMode);
  if (modes.includes("TENDER_PACKAGE")) return "TENDER_PACKAGE";
  if (modes.includes("CANNOT_QUOTE")) return "CANNOT_QUOTE";
  if (modes.includes("APPROVAL_REQUIRED")) return "APPROVAL_REQUIRED";
  if (modes.includes("AUTO_SEND")) return "AUTO_SEND";
  return "";
}

export async function analyseRfqDocuments(workspaceId: string, rfqId: string) {
  const db = getDb();
  const rfq = await db.rfq.findFirst({
    where: { id: rfqId, workspaceId },
    include: { sourceMessage: { include: { attachments: true } } },
  });
  if (!rfq) throw new AppError("RFQ not found.", 404, "NOT_FOUND");
  const previousEdits = await db.documentEdit.findMany({ where: { analysis: { rfqId } }, orderBy: { createdAt: "asc" } });
  await db.tenderAnalysis.deleteMany({ where: { rfqId, workspaceId } });
  const documents: Array<{ filename: string; attachmentId: string | null; pages: { page: number; text: string }[]; warnings: string[] }> = [];
  if (rfq.sourceMessage.body.trim()) documents.push({ filename: "email", attachmentId: null, pages: [{ page: 1, text: rfq.sourceMessage.body }], warnings: [] });
  for (const file of rfq.sourceMessage.attachments) {
    const read = await readDocumentFile(file.filename, file.contentType, Buffer.from(file.content));
    const pages = [...read.pages];
    const warnings = [...read.warnings];
    if (supportedAttachment(file.filename, file.contentType) === "image") {
      const vision = await readImageText({ filename: file.filename, contentType: file.contentType, bytes: Buffer.from(file.content) });
      if (vision.text) pages.push({ page: pages.length + 1, text: vision.text });
      if (vision.warning) warnings.push(vision.warning);
    } else if (pages.some((page) => pageIsScanned(page.text))) {
      warnings.push("A scanned page had no readable text. The original file is kept. No text was invented for that page.");
    }
    documents.push({ filename: file.filename, attachmentId: file.id, pages, warnings });
  }
  const saved: ResponseMode[] = [];
  for (const document of documents) {
    let record: StoredDocumentAnalysis = { ...analyseDocumentText({ filename: document.filename, pages: document.pages }), matches: [] };
    record.warnings.push(...document.warnings.filter((warning) => !record.warnings.includes(warning)));
    for (const edit of previousEdits) record = { ...applyAnalysisEdit(record, edit.field, edit.nextValue), matches: record.matches };
    record.responseMode = decideResponseMode({
      documentType: record.documentType,
      text: document.pages.map((page) => page.text).join("\n"),
      itemCount: record.items.length,
      matches: record.matches.map((match) => match.match),
      pricedLines: record.matches.filter((match) => match.pricedFromSupplier).length,
      lowConfidence: record.items.some((item) => item.extractionConfidence < 70) || record.warnings.length > 0,
      usesMarketPrice: record.matches.some((match) => match.observedPriceCents != null && !match.pricedFromSupplier),
      substitution: record.matches.some((match) => match.match === "PARTIAL MATCH"),
      largeQuotation: record.items.length > 20,
      unusualTerms: record.specialConditions.length > 0,
    });
    const row = await db.tenderAnalysis.create({
      data: {
        workspaceId,
        rfqId,
        attachmentId: document.attachmentId,
        documentType: record.documentType,
        referenceNumber: record.referenceNumber,
        responseMode: record.responseMode,
        analysis: record as unknown as Prisma.InputJsonValue,
        edits: saved.length === 0 ? { create: previousEdits.map((edit) => ({ actorId: edit.actorId, field: edit.field, previousValue: edit.previousValue, nextValue: edit.nextValue })) } : undefined,
      },
    });
    saved.push(row.responseMode as ResponseMode);
  }
  const mode = strictest(saved);
  if (mode === "TENDER_PACKAGE") {
    await db.rfq.update({ where: { id: rfqId }, data: { automationNote: "This tender requires the official submission method. No quotation email was sent." } });
  }
  return mode;
}

export async function correctAnalysisField(actor: Actor, analysisId: string, field: string, value: string) {
  const db = getDb();
  const row = await db.tenderAnalysis.findFirst({ where: { id: analysisId, workspaceId: actor.workspaceId } });
  if (!row) throw new AppError("Document analysis not found.", 404, "NOT_FOUND");
  const current = asAnalysis(row.analysis);
  const previous = fieldValue(current, field);
  const next = { ...applyAnalysisEdit(current, field, value), matches: current.matches };
  await db.documentEdit.create({
    data: { analysisId: row.id, actorId: actor.userId, field: field.slice(0, 80), previousValue: previous.slice(0, 500), nextValue: value.trim().slice(0, 500) },
  });
  await db.tenderAnalysis.update({
    where: { id: row.id },
    data: { analysis: next as unknown as Prisma.InputJsonValue, referenceNumber: next.referenceNumber },
  });
}

export async function saveAnalysisMatches(workspaceId: string, rfqId: string, matchesByReference: Map<string, AnalysisMatch[]>) {
  const db = getDb();
  const rows = await db.tenderAnalysis.findMany({ where: { workspaceId, rfqId } });
  for (const row of rows) {
    const record = asAnalysis(row.analysis);
    const matches = matchesByReference.get(row.id) ?? [];
    const text = JSON.stringify(record);
    const next: StoredDocumentAnalysis = {
      ...record,
      matches,
      responseMode: decideResponseMode({
        documentType: record.documentType,
        text,
        itemCount: record.items.length,
        matches: matches.map((match) => match.match),
        pricedLines: matches.filter((match) => match.pricedFromSupplier && match.match === "MATCH").length,
        lowConfidence: record.items.some((item) => item.extractionConfidence < 70) || record.warnings.length > 0,
        usesMarketPrice: matches.some((match) => match.observedPriceCents != null && !match.pricedFromSupplier),
        substitution: matches.some((match) => match.match === "PARTIAL MATCH"),
        largeQuotation: record.items.length > 20,
        unusualTerms: record.specialConditions.length > 0,
      }),
    };
    await db.tenderAnalysis.update({
      where: { id: row.id },
      data: { responseMode: next.responseMode, analysis: next as unknown as Prisma.InputJsonValue },
    });
  }
}

export async function generateQuoteFromAnalysis(actor: Actor, rfqId: string) {
  const db = getDb();
  const rows = await listTenderAnalyses(actor.workspaceId, rfqId);
  if (rows.length === 0) throw new AppError("Analyse the documents before generating a quotation.");
  if (rows.some((row) => row.responseMode === "TENDER_PACKAGE")) {
    throw new AppError("This tender requires the official submission method. A quotation email was not created.");
  }
  const matches = rows.flatMap((row) => row.record.matches.filter((match) => match.match === "MATCH" && match.pricedFromSupplier && match.productId));
  const requested = rows.flatMap((row) => row.record.items.map((item) => item.lineNumber || item.description));
  const text = rows.map((row) => JSON.stringify(row.record)).join("\n");
  const block = quoteCompletionBlock({
    requireAllLines: requiresEveryLinePriced(text),
    requested,
    priced: matches.map((match) => match.lineNumber),
    authorisedOverride: false,
  });
  if (block) throw new AppError(block);
  if (matches.length === 0) throw new AppError("No requested line has a supplier cost and a full specification match.");
  if (rows.some((row) => row.record.vatTreatment === "INCLUSIVE")) {
    throw new AppError("The document states VAT-inclusive prices. Review the price before a quotation is created.");
  }
  const workspace = await db.workspace.findFirst({ where: { id: actor.workspaceId } });
  if (!workspace) throw new AppError("Workspace not found.", 404, "NOT_FOUND");
  const offers = await db.supplierPrice.findMany({
    where: { workspaceId: actor.workspaceId, productId: { in: matches.map((match) => match.productId || "") }, costKnown: true },
    include: { supplier: { select: { markupPercent: true, preference: true, leadTimeDays: true, priceSyncIntervalMinutes: true } } },
  });
  let quote = await db.quote.findFirst({ where: { workspaceId: actor.workspaceId, rfqId, status: "DRAFT" } });
  if (!quote) quote = await db.quote.create({ data: { workspaceId: actor.workspaceId, rfqId } });
  await db.quoteLine.deleteMany({ where: { quoteId: quote.id } });
  const now = new Date();
  for (const match of matches) {
    const productOffers = offers.filter((offer) => offer.productId === match.productId);
    const chosen = chooseSupplierOffer(productOffers.map((row) => ({
      supplierId: row.supplierId,
      costCents: row.costCents,
      costKnown: row.costKnown,
      stockQty: row.stockQty,
      stockKnown: row.stockKnown,
      updatedAt: row.updatedAt,
      preference: row.supplier.preference,
      leadTimeDays: row.leadTimeDays ?? row.supplier.leadTimeDays,
      priceFreshMs: row.supplier.priceSyncIntervalMinutes * 60 * 1000,
    })), 1, now);
    const item = rows.flatMap((entry) => entry.record.items).find((entry) => entry.lineNumber === match.lineNumber);
    if (item?.quantity == null || item.quantity <= 0) throw new AppError(`Line ${match.lineNumber || item?.description || "requested"} has no quantity in the document.`);
    const quantity = item.quantity;
    const priced = priceQuotation({
      costExVatCents: chosen?.costCents ?? null,
      markupPercent: offers.find((row) => row.supplierId === chosen?.supplierId)?.supplier.markupPercent ?? 0,
      minimumMarginPercent: workspace.minimumMarginPercent,
      autoQuoteMarginPercent: workspace.autoQuoteMarginPercent,
      autoSendMarginPercent: workspace.autoSendMarginPercent,
      fresh: chosen != null,
      stockKnown: chosen != null,
      stockQty: chosen?.stockQty ?? null,
      requestedQty: quantity,
      abnormalPriceChange: false,
    });
    if (priced.sellExVatCents == null) continue;
    await db.quoteLine.create({
      data: {
        workspaceId: actor.workspaceId,
        quoteId: quote.id,
        productId: match.productId,
        description: item.description || match.productName,
        modelName: [item.description, match.productName].filter(Boolean).join(" — "),
        quantity: new Prisma.Decimal(quantity.toFixed(2)),
        unitPriceCents: priced.sellExVatCents,
        sku: match.sku,
        specifications: Object.entries(item.mandatorySpecs).map(([key, value]) => `${key}: ${value}`).join("; "),
        sourceKind: match.sourceKind,
        sourceUrl: match.pricedFromSupplier ? "" : match.sourceUrl,
        matchGrade: "MEETS_REQUIREMENT",
        costStatus: "VERIFIED",
        scheduleNumber: match.lineNumber,
        requirementText: item.description || match.explanation,
      },
    });
  }
  const reference = rows.map((row) => row.record.referenceNumber).find(Boolean) ?? "";
  const delivery = rows.map((row) => row.record.deliveryLocation).find(Boolean) ?? "";
  const current = await db.rfq.findFirst({ where: { id: rfqId }, select: { customerReference: true, deliveryLocation: true } });
  await db.rfq.update({
    where: { id: rfqId },
    data: {
      status: "QUOTE_PREPARED",
      automationNote: "A quotation was prepared from the document analysis. It has not been sent.",
      customerReference: current?.customerReference || reference,
      deliveryLocation: current?.deliveryLocation || delivery,
    },
  });
}

export async function markAnalysisApproved(actor: Actor, rfqId: string) {
  await getDb().tenderAnalysis.updateMany({
    where: { workspaceId: actor.workspaceId, rfqId },
    data: { approvedById: actor.userId, approvedAt: new Date() },
  });
}

function asAnalysis(value: unknown): StoredDocumentAnalysis {
  const record = value && typeof value === "object" ? value as Partial<StoredDocumentAnalysis> : {};
  const base = analyseDocumentText({ filename: "email", pages: [{ page: 1, text: "" }] });
  return { ...base, ...record, items: Array.isArray(record.items) ? record.items : [], matches: Array.isArray(record.matches) ? record.matches : [] };
}

function fieldValue(record: DocumentAnalysisRecord, field: string) {
  const direct = record[field as keyof DocumentAnalysisRecord];
  if (typeof direct === "string") return direct;
  return "";
}

function strictest(modes: ResponseMode[]): ResponseMode | "" {
  if (modes.includes("TENDER_PACKAGE")) return "TENDER_PACKAGE";
  if (modes.includes("CANNOT_QUOTE")) return "CANNOT_QUOTE";
  if (modes.includes("APPROVAL_REQUIRED")) return "APPROVAL_REQUIRED";
  if (modes.includes("AUTO_SEND")) return "AUTO_SEND";
  return "";
}
