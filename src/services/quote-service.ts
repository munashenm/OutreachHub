import { Prisma } from "../generated/prisma/client";
import { getDb, isUniqueViolation } from "../lib/db";
import { AppError } from "../lib/errors";
import { parseMoneyToCents, parseQuantity, quoteValidUntil, snapshotQuoteLine } from "../lib/quote";
import { quoteMarginBlock, sellMarginPercent } from "../lib/stock";
import { quoteCoverEmail, quotationEmailSubject, urbanFocusQuoteNumber } from "../lib/quotation-document";
import { ownedByWorkspace } from "../lib/gmail-sync";
import { recordActivity } from "./activity-service";
import { getRfq } from "./rfq-service";
import { generateQuotePdf } from "./quotation-pdf-service";
import { sendCustomerResponse } from "./reply-service";
import { recordFunnel, scheduleQuoteFollowUp } from "./sales-response-service";
import { markAnalysisApproved, responseModeForRfq } from "./document-analysis-service";
import { queueStockForWebsite } from "./stock-sync-service";
import { lowestCostsByProduct } from "./supplier-service";
import { accessTokenForMailbox } from "./mailbox-service";
import { searchGmailIds } from "./google-service";
import { classifySendFailure, quoteSendKey } from "../lib/quote-send";
import type { Actor } from "./types";

export async function quotesForRfq(workspaceId: string, rfqId: string) {
  return getDb().quote.findMany({
    where: { workspaceId, rfqId },
    omit: { pdf: true },
    include: { lines: { orderBy: { id: "asc" }, include: { product: { select: { sku: true, name: true, specifications: true, imageUrls: true } } } } },
    orderBy: { createdAt: "desc" },
  });
}

async function draftQuote(workspaceId: string, rfqId: string) {
  const existing = await getDb().quote.findFirst({
    where: { workspaceId, rfqId, status: "DRAFT" },
    include: { lines: true },
  });
  if (existing) return existing;
  return getDb().quote.create({
    data: { workspaceId, rfqId },
    include: { lines: true },
  });
}

export async function quoteApprovalLimits(workspaceId: string) {
  const workspace = await getDb().workspace.findFirst({
    where: { id: workspaceId },
    select: { minimumMarginPercent: true, autoSendMarginPercent: true },
  });
  return {
    minimumMarginPercent: workspace?.minimumMarginPercent ?? 0,
    autoSendMarginPercent: workspace?.autoSendMarginPercent ?? 25,
  };
}

async function assertQuoteMargins(workspaceId: string, lines: Array<{ productId: string | null; unitPriceCents: number }>) {
  const productIds = lines.flatMap((line) => line.productId ? [line.productId] : []);
  if (productIds.length === 0) return;
  const [limits, costs] = await Promise.all([
    quoteApprovalLimits(workspaceId),
    lowestCostsByProduct(workspaceId, productIds),
  ]);
  for (const line of lines) {
    if (!line.productId) continue;
    const message = quoteMarginBlock(costs.get(line.productId) ?? null, line.unitPriceCents, limits.minimumMarginPercent);
    if (message) throw new AppError(message);
  }
}

export async function addQuoteLine(actor: Actor, input: { rfqId: string; productId: string; description: string; quantity: string; unitPrice: string }) {
  const rfq = await getRfq(actor.workspaceId, input.rfqId);
  if (!rfq) throw new AppError("RFQ not found.", 404, "NOT_FOUND");
  const quantity = parseQuantity(input.quantity);
  const unitPriceCents = parseMoneyToCents(input.unitPrice);
  if (quantity === null) throw new AppError("Enter a quantity greater than zero.");
  if (unitPriceCents === null) throw new AppError("Enter a unit price in rands, such as 1299.50.");
  let productId: string | null = null;
  if (input.productId) {
    const product = ownedByWorkspace(
      await getDb().product.findFirst({ where: { id: input.productId, workspaceId: actor.workspaceId } }),
      actor.workspaceId,
    );
    if (!product) throw new AppError("Product not found in this workspace.");
    productId = product.id;
  }
  await assertQuoteMargins(actor.workspaceId, [{ productId, unitPriceCents }]);
  const quote = await draftQuote(actor.workspaceId, rfq.id);
  if (quote.status !== "DRAFT") throw new AppError("This quote has already been sent.");
  await getDb().quoteLine.create({
    data: {
      workspaceId: actor.workspaceId,
      quoteId: quote.id,
      productId,
      description: input.description,
      quantity: new Prisma.Decimal(quantity.toFixed(2)),
      unitPriceCents,
    },
  });
}

export async function removeQuoteLine(actor: Actor, lineId: string) {
  const line = await getDb().quoteLine.findFirst({
    where: { id: lineId, workspaceId: actor.workspaceId },
    include: { quote: true },
  });
  if (!line || line.quote.workspaceId !== actor.workspaceId) throw new AppError("Quote line not found.", 404, "NOT_FOUND");
  if (line.quote.status !== "DRAFT") throw new AppError("Sent quote lines cannot be removed.");
  await getDb().quoteLine.deleteMany({ where: { id: line.id, workspaceId: actor.workspaceId } });
}

export async function getQuoteDocument(workspaceId: string, id: string) {
  return getDb().quote.findFirst({
    where: { id, workspaceId, number: { not: null } },
    omit: { pdf: true },
    include: {
      lines: { orderBy: { id: "asc" }, include: { product: { select: { specifications: true, imageUrls: true } } } },
      rfq: { include: { prospect: true, company: true, sourceMessage: true } },
    },
  });
}

export async function sendQuote(actor: Actor, rfqId: string, terms: { validDays: number; notes: string; documentMode?: "STANDARD" | "FORMAL"; exportQuote?: boolean; references?: string }) {
  const rfq = await getRfq(actor.workspaceId, rfqId);
  if (!rfq) throw new AppError("RFQ not found.", 404, "NOT_FOUND");
  const alreadySent = await getDb().quote.findFirst({ where: { workspaceId: actor.workspaceId, rfqId: rfq.id, status: "SENT" }, select: { id: true } });
  if (alreadySent) return;
  if (await responseModeForRfq(rfq.id) === "TENDER_PACKAGE") throw new AppError("This tender requires the official submission method. An email quotation was not sent.");
  const quote = await getDb().quote.findFirst({
    where: { workspaceId: actor.workspaceId, rfqId: rfq.id, status: "DRAFT" },
    include: { lines: true },
  });
  if (!quote || quote.lines.length === 0) throw new AppError("Add at least one line before sending the quote.");
  await assertQuoteMargins(actor.workspaceId, quote.lines.map((line) => ({ productId: line.productId, unitPriceCents: line.unitPriceCents })));
  const to = rfq.sourceMessage.fromEmail || rfq.prospect?.email;
  if (!to) throw new AppError("This enquiry has no customer email address.");
  const issuedAt = quote.issuedAt ?? new Date();
  const prepared = await getDb().$transaction(async (tx) => {
    let number = quote.number;
    if (number == null) {
      const workspace = await tx.workspace.update({
        where: { id: actor.workspaceId },
        data: { quoteSequence: { increment: 1 } },
        select: { quoteSequence: true },
      });
      number = workspace.quoteSequence;
    }
    const updated = await tx.quote.update({
      where: { id: quote.id },
      data: {
        number,
        issuedAt,
        validDays: terms.validDays,
        notes: terms.notes,
        validUntil: quoteValidUntil(issuedAt, terms.validDays),
        documentMode: terms.documentMode === "FORMAL" ? "FORMAL" : "STANDARD",
        exportQuote: terms.exportQuote === true,
        references: terms.references ?? "",
      },
      include: { lines: { include: { product: { select: { specifications: true, imageUrls: true, sku: true, name: true, manufacturerPartNumber: true } } } } },
    });
    const lines = [];
    for (const [index, line] of updated.lines.entries()) {
      const shot = snapshotQuoteLine(line.product);
      const specifications = line.specifications.trim() ? line.specifications : shot.specifications;
      const imageUrls = line.imageUrls.length > 0 ? line.imageUrls : shot.imageUrls;
      const requirement = rfq.lines[index];
      const frozen = {
        specifications,
        imageUrls,
        sku: line.sku || line.product?.sku || "",
        modelName: line.modelName || line.product?.name || "",
        manufacturerPartNumber: line.manufacturerPartNumber || line.product?.manufacturerPartNumber || "",
        requirementText: line.requirementText || requirement?.specifications || requirement?.description || "",
      };
      await tx.quoteLine.update({ where: { id: line.id }, data: frozen });
      lines.push({ ...line, ...frozen });
    }
    return { ...updated, lines };
  });
  if (prepared.number == null || prepared.issuedAt == null || prepared.validUntil == null) {
    throw new AppError("The quotation number could not be assigned.");
  }
  const quoteNumber = prepared.number;
  const quoteIssuedAt = prepared.issuedAt;
  const pdf = await generateQuotePdf(actor.workspaceId, prepared.id, {
    mode: terms.documentMode === "FORMAL" ? "FORMAL" : "STANDARD",
    exportQuote: terms.exportQuote === true,
    references: terms.references ?? "",
  });
  const customerName = rfq.prospect ? `${rfq.prospect.firstName} ${rfq.prospect.lastName}`.trim() : rfq.sourceMessage.fromName ?? "";
  const body = quoteCoverEmail({
    customerName,
    quoteNumber: urbanFocusQuoteNumber(quoteNumber, quoteIssuedAt),
    validUntil: prepared.validUntil,
  });
  const subject = quotationEmailSubject(quoteNumber, quoteIssuedAt);
  const claimed = await claimQuoteSend({ quoteId: quote.id, rfqId: rfq.id, recipient: to, subject, version: 1 });
  if (!claimed) return;
  await getDb().rfq.update({ where: { id: rfq.id }, data: { status: "SENDING" } });
  let gmailMessageId = "";
  try {
    const sentMessage = await sendCustomerResponse(actor, {
      messageId: rfq.sourceMessageId,
      to,
      cc: "",
      subject,
      body,
      attachments: [{ filename: pdf.filename, contentType: "application/pdf", data: pdf.bytes }],
    });
    gmailMessageId = sentMessage.externalId ?? "";
    await getDb().quoteSendAttempt.update({
      where: { idempotencyKey: quoteSendKey(quote.id, 1) },
      data: { status: "SENT", gmailMessageId, completedAt: new Date(), lastError: "" },
    });
  } catch (error) {
    const outcome = classifySendFailure(error);
    const reason = error instanceof Error ? error.message.slice(0, 300) : "The quotation email could not be sent.";
    await getDb().quoteSendAttempt.update({
      where: { idempotencyKey: quoteSendKey(quote.id, 1) },
      data: { status: outcome, lastError: reason, completedAt: outcome === "FAILED_CONFIRMED" ? new Date() : null },
    });
    await getDb().rfq.update({
      where: { id: rfq.id },
      data: { status: "QUOTE_READY", lastError: outcome === "UNKNOWN" ? "The quotation send did not return a result. It will be checked before another email is sent." : reason },
    });
    throw error;
  }
  await getDb().$transaction(async (tx) => {
    await tx.quote.update({ where: { id: prepared.id }, data: { status: "SENT", sentAt: new Date() } });
    await tx.rfq.update({ where: { id: rfq.id }, data: { status: "SENT" } });
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId === "system" ? null : actor.userId,
      prospectId: rfq.prospectId,
      companyId: rfq.companyId,
      type: "QUOTE_SENT",
      summary: `Sent quotation ${urbanFocusQuoteNumber(quoteNumber, quoteIssuedAt)} for “${rfq.subject}”.`,
    });
    await queueStockForWebsite(tx, actor.workspaceId, prepared.lines.map((line) => line.productId ?? ""));
  });
  const sentAt = new Date();
  await scheduleQuoteFollowUp(actor.workspaceId, prepared.id, sentAt);
  const valueCents = prepared.lines.reduce((sum, line) => sum + line.unitPriceCents * Number(line.quantity), 0);
  const productIds = prepared.lines.flatMap((line) => line.productId ? [line.productId] : []);
  const costs = productIds.length === 0 ? new Map<string, number>() : await lowestCostsByProduct(actor.workspaceId, productIds);
  const margins = prepared.lines.flatMap((line) => {
    const cost = line.productId ? costs.get(line.productId) : undefined;
    if (cost == null) return [];
    const margin = sellMarginPercent(cost, line.unitPriceCents);
    return margin == null ? [] : [margin];
  });
  const marginPercent = margins.length === 0 ? null : Math.round(margins.reduce((sum, margin) => sum + margin, 0) / margins.length);
  await recordFunnel({ workspaceId: actor.workspaceId, rfqId: rfq.id, status: "QUOTE_SENT", valueCents: Math.round(valueCents), marginPercent });
  await markAnalysisApproved(actor, rfq.id);
}

async function claimQuoteSend(input: { quoteId: string; rfqId: string; recipient: string; subject: string; version: number }) {
  const db = getDb();
  const key = quoteSendKey(input.quoteId, input.version);
  const existing = await db.quoteSendAttempt.findUnique({ where: { idempotencyKey: key } });
  if (existing?.status === "SENT") return false;
  const stale = existing?.status === "SENDING" && existing.startedAt != null && Date.now() - existing.startedAt.getTime() >= 2 * 60_000;
  if (existing?.status === "SENDING" && !stale) return false;
  if (existing && (existing.status === "UNKNOWN" || stale)) {
    const found = await findAlreadySentQuotation(input.recipient, input.subject);
    if (found === "inconclusive") return false;
    if (found) {
      await db.quoteSendAttempt.update({
        where: { idempotencyKey: key },
        data: { status: "SENT", gmailMessageId: found, completedAt: new Date(), lastError: "" },
      });
      await db.quote.updateMany({ where: { id: input.quoteId, status: "DRAFT" }, data: { status: "SENT", sentAt: new Date() } });
      await db.rfq.updateMany({ where: { id: input.rfqId }, data: { status: "SENT", lastError: "" } });
      return false;
    }
  }
  if (!existing) {
    try {
      await db.quoteSendAttempt.create({
        data: {
          idempotencyKey: key,
          quoteId: input.quoteId,
          quoteVersion: input.version,
          rfqId: input.rfqId,
          recipient: input.recipient,
          status: "SENDING",
          attemptCount: 1,
          startedAt: new Date(),
        },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }
  const claimed = await db.quoteSendAttempt.updateMany({
    where: { idempotencyKey: key, status: { in: ["FAILED_CONFIRMED", "UNKNOWN", "SENDING", "PENDING"] } },
    data: { status: "SENDING", attemptCount: { increment: 1 }, startedAt: new Date(), lastError: "", completedAt: null },
  });
  return claimed.count === 1;
}

async function findAlreadySentQuotation(recipient: string, subject: string) {
  const mailbox = await getDb().mailbox.findFirst({
    where: { provider: "GOOGLE", connectionStatus: "CONNECTED" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, workspaceId: true },
  });
  if (!mailbox) return "inconclusive" as const;
  try {
    const access = await accessTokenForMailbox(mailbox.id, mailbox.workspaceId);
    const safeSubject = subject.replaceAll("\"", "");
    const ids = await searchGmailIds(access.token, `in:sent to:${recipient} subject:"${safeSubject}" newer_than:14d`);
    if (ids == null) return "inconclusive" as const;
    return ids[0] ?? null;
  } catch {
    return "inconclusive" as const;
  }
}
