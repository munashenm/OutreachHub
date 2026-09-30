import { Prisma } from "../generated/prisma/client";
import { getDb } from "../lib/db";
import { AppError } from "../lib/errors";
import { formatQuoteEmail, formatQuoteNumber, parseMoneyToCents, parseQuantity, quoteValidUntil } from "../lib/quote";
import { ownedByWorkspace } from "../lib/gmail-sync";
import { recordActivity } from "./activity-service";
import { getRfq } from "./rfq-service";
import { sendThreadReply } from "./reply-service";
import { queueStockForWebsite } from "./stock-sync-service";
import type { Actor } from "./types";

export async function quotesForRfq(workspaceId: string, rfqId: string) {
  return getDb().quote.findMany({
    where: { workspaceId, rfqId },
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
    include: {
      lines: { orderBy: { id: "asc" }, include: { product: { select: { specifications: true, imageUrls: true } } } },
      rfq: { include: { prospect: true, company: true, sourceMessage: true } },
    },
  });
}

export async function sendQuote(actor: Actor, rfqId: string, terms: { validDays: number; notes: string }) {
  const rfq = await getRfq(actor.workspaceId, rfqId);
  if (!rfq) throw new AppError("RFQ not found.", 404, "NOT_FOUND");
  const quote = await getDb().quote.findFirst({
    where: { workspaceId: actor.workspaceId, rfqId: rfq.id, status: "DRAFT" },
    include: { lines: true },
  });
  if (!quote || quote.lines.length === 0) throw new AppError("Add at least one line before sending the quote.");
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
    return tx.quote.update({
      where: { id: quote.id },
      data: {
        number,
        issuedAt,
        validDays: terms.validDays,
        notes: terms.notes,
        validUntil: quoteValidUntil(issuedAt, terms.validDays),
      },
      include: { lines: { include: { product: { select: { specifications: true, imageUrls: true } } } } },
    });
  });
  if (prepared.number == null || prepared.issuedAt == null || prepared.validUntil == null) {
    throw new AppError("The quotation number could not be assigned.");
  }
  const quoteNumber = prepared.number;
  const quoteIssuedAt = prepared.issuedAt;
  const body = formatQuoteEmail({
    subject: rfq.subject,
    currency: prepared.currency,
    number: quoteNumber,
    issuedAt: quoteIssuedAt,
    validUntil: prepared.validUntil,
    customerName: rfq.prospect ? `${rfq.prospect.firstName} ${rfq.prospect.lastName}`.trim() : "",
    companyName: rfq.company?.companyName ?? "",
    notes: prepared.notes,
    lines: prepared.lines.map((line) => ({
      description: line.description,
      quantity: Number(line.quantity),
      unitPriceCents: line.unitPriceCents,
      specifications: line.product?.specifications ?? "",
      imageUrls: line.product?.imageUrls ?? [],
    })),
  });
  await sendThreadReply(actor, {
    messageId: rfq.sourceMessageId,
    to,
    cc: "",
    subject: rfq.subject.toLowerCase().startsWith("re:") ? rfq.subject : `Re: ${rfq.subject}`,
    body,
  });
  await getDb().$transaction(async (tx) => {
    await tx.quote.update({ where: { id: prepared.id }, data: { status: "SENT", sentAt: new Date() } });
    await tx.rfq.update({ where: { id: rfq.id }, data: { status: "QUOTE_SENT" } });
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      prospectId: rfq.prospectId,
      companyId: rfq.companyId,
      type: "QUOTE_SENT",
      summary: `Sent quotation ${formatQuoteNumber(quoteNumber, quoteIssuedAt)} for “${rfq.subject}”.`,
    });
    await queueStockForWebsite(tx, actor.workspaceId, prepared.lines.map((line) => line.productId ?? ""));
  });
}
