import { priceQuotation } from "../lib/automation";
import { getDb } from "../lib/db";
import {
  buildEnquiryJson,
  composeFollowUp,
  decideSalesResponse,
  funnelStage,
  quoteFollowUpAction,
  rankProductMatches,
  unpricedCatalogueNote,
  funnelRowsFromRfqs,
  salesFunnelMetrics,
  type RankedProduct,
} from "../lib/sales-response";
import { equivalentsRejected } from "../lib/rfq-match";
import type { ProductRequirement, SourcingCandidate } from "../lib/sourcing";
import { formatQuoteDate, lineTotalCents } from "../lib/quote";
import { displayedQuoteNumber, quotationEmailSubject } from "../lib/quotation-document";
import { sendCustomerResponse } from "./reply-service";

export { unpricedCatalogueNote };

type Margins = { minimumMarginPercent: number; autoQuoteMarginPercent: number; autoSendMarginPercent: number };

export function enquiryFromRequest(input: Parameters<typeof buildEnquiryJson>[0]) {
  return buildEnquiryJson(input);
}

export function pricedSalesMatches(requirement: ProductRequirement, candidates: readonly SourcingCandidate[], margins: Margins): RankedProduct[] {
  const quantity = Math.max(1, requirement.quantity ?? 1);
  return rankProductMatches(requirement, candidates).map((match) => {
    const candidate = candidates.find((item) => item.productId === match.productId && item.sku === match.sku) ?? candidates.find((item) => item.sku === match.sku && item.name === match.name);
    if (!candidate || candidate.costExVatCents == null || candidate.costExVatCents <= 0) return match;
    const decision = priceQuotation({
      costExVatCents: candidate.costExVatCents,
      markupPercent: candidate.markupPercent,
      minimumMarginPercent: margins.minimumMarginPercent,
      autoQuoteMarginPercent: margins.autoQuoteMarginPercent,
      autoSendMarginPercent: margins.autoSendMarginPercent,
      fresh: candidate.fresh,
      stockKnown: candidate.stockKnown,
      stockQty: candidate.stockQty,
      requestedQty: quantity,
      abnormalPriceChange: false,
    });
    if (decision.decision === "MARGIN_WARNING" || decision.sellExVatCents == null) return match;
    return { ...match, unitPriceCents: decision.sellExVatCents, marginPercent: decision.marginPercent };
  });
}

export function responseForRequirement(requirement: ProductRequirement, candidates: readonly SourcingCandidate[], margins: Margins, autoSendAllowed: boolean) {
  const matches = pricedSalesMatches(requirement, candidates, margins);
  const marginAllowed = matches.some((match) => match.unitPriceCents != null && (match.marginPercent ?? -1) >= margins.minimumMarginPercent);
  return decideSalesResponse({
    vague: false,
    requestedExact: Boolean(requirement.sku || requirement.mpn || requirement.model),
    requestedQuantity: Math.max(1, requirement.quantity ?? 1),
    matches,
    marginAllowed,
    autoSendAllowed,
    equivalentsRejected: equivalentsRejected(requirement.requestedText),
  });
}

export async function recordFunnel(input: {
  workspaceId: string;
  rfqId: string;
  status: string;
  note?: string;
  valueCents?: number;
  marginPercent?: number | null;
}) {
  const stage = funnelStage(input.status);
  const existing = await getDb().salesFunnelEvent.findFirst({ where: { rfqId: input.rfqId, stage } });
  if (existing) return existing;
  return getDb().salesFunnelEvent.create({
    data: {
      workspaceId: input.workspaceId,
      rfqId: input.rfqId,
      stage,
      note: input.note ?? "",
      valueCents: input.valueCents ?? 0,
      marginPercent: input.marginPercent ?? null,
    },
  });
}

export async function recordReplyStage(workspaceId: string, rfqId: string) {
  const existing = await getDb().salesFunnelEvent.findFirst({ where: { rfqId, stage: "REPLIED" } });
  if (existing) return existing;
  return getDb().salesFunnelEvent.create({ data: { workspaceId, rfqId, stage: "REPLIED" } });
}

export async function openSourcingTask(workspaceId: string, rfqId: string, requirement: string) {
  const text = requirement.trim().slice(0, 500) || "Unspecified product";
  return getDb().sourcingTask.upsert({
    where: { rfqId_requirement: { rfqId, requirement: text } },
    update: {},
    create: { workspaceId, rfqId, requirement: text },
  });
}

export async function scheduleQuoteFollowUp(workspaceId: string, quoteId: string, sentAt: Date) {
  const workspace = await getDb().workspace.findFirst({ where: { id: workspaceId }, select: { followUpAfterDays: true } });
  const days = Math.max(1, workspace?.followUpAfterDays ?? 3);
  await getDb().quote.update({
    where: { id: quoteId },
    data: { nextFollowUpAt: new Date(sentAt.getTime() + days * 24 * 60 * 60 * 1000), followUpStoppedReason: "" },
  });
}

export async function stopQuoteFollowUp(rfqId: string, reason: string) {
  await getDb().quote.updateMany({
    where: { rfqId, followUpStoppedReason: "" },
    data: { followUpStoppedReason: reason.slice(0, 120), nextFollowUpAt: null },
  });
}

export async function processQuoteFollowUps() {
  const now = new Date();
  const quotes = await getDb().quote.findMany({
    where: { status: "SENT", followUpStoppedReason: "", nextFollowUpAt: { lte: now } },
    include: {
      workspace: { select: { followUpAfterDays: true, followUpLimit: true } },
      rfq: { select: { id: true, workspaceId: true, subject: true, status: true, sourceMessageId: true, sourceMessage: { select: { fromEmail: true, threadId: true } } } },
    },
    take: 20,
  });
  let sent = 0;
  let stopped = 0;
  for (const quote of quotes) {
    const replied = await getDb().message.count({
      where: {
        workspaceId: quote.workspaceId,
        direction: "INBOUND",
        threadId: quote.rfq.sourceMessage.threadId,
        createdAt: { gt: quote.sentAt ?? quote.createdAt },
      },
    });
    const action = quoteFollowUpAction({
      sentAt: quote.sentAt ?? quote.createdAt,
      now,
      followUpCount: quote.followUpCount,
      followUpLimit: quote.workspace.followUpLimit,
      afterDays: quote.workspace.followUpAfterDays,
      customerReplied: replied > 0,
      rejected: quote.rfq.status === "LOST",
      ordered: quote.rfq.status === "WON",
    });
    if (action === "stop") {
      const reason = quote.rfq.status === "WON" ? "ordered" : quote.rfq.status === "LOST" ? "rejected" : replied > 0 ? "customer replied" : "follow-up limit";
      await stopQuoteFollowUp(quote.rfqId, reason);
      stopped += 1;
      continue;
    }
    if (action !== "send" || !quote.rfq.sourceMessage.fromEmail || quote.number == null || quote.issuedAt == null) continue;
    const quoteNumber = displayedQuoteNumber(quote.number, quote.issuedAt, quote.pdfFilename);
    const validUntil = quote.validUntil ? formatQuoteDate(quote.validUntil) : "";
    await sendCustomerResponse(
      { userId: "system", workspaceId: quote.workspaceId },
      {
        messageId: quote.rfq.sourceMessageId,
        to: quote.rfq.sourceMessage.fromEmail,
        cc: "",
        subject: quotationEmailSubject(quote.number, quote.issuedAt, quote.pdfFilename),
        body: composeFollowUp({ quoteNumber, validUntil }),
      },
    );
    const nextCount = quote.followUpCount + 1;
    const stopNow = nextCount >= quote.workspace.followUpLimit;
    await getDb().quote.update({
      where: { id: quote.id },
      data: {
        followUpCount: nextCount,
        nextFollowUpAt: stopNow ? null : new Date(now.getTime() + Math.max(1, quote.workspace.followUpAfterDays) * 24 * 60 * 60 * 1000),
        followUpStoppedReason: stopNow ? "follow-up limit" : "",
      },
    });
    sent += 1;
  }
  return { sent, stopped };
}

export async function salesFunnelReport(workspaceId: string) {
  const rfqs = await getDb().rfq.findMany({
    where: { workspaceId },
    select: {
      status: true,
      createdAt: true,
      respondedAt: true,
      lostReason: true,
      quotes: { where: { status: "SENT" }, select: { lines: { select: { quantity: true, unitPriceCents: true } } } },
    },
  });
  return salesFunnelMetrics(funnelRowsFromRfqs(rfqs.map((rfq) => ({
    status: rfq.status,
    createdAt: rfq.createdAt.toISOString(),
    respondedAt: rfq.respondedAt?.toISOString() ?? null,
    lostReason: rfq.lostReason,
    sentQuoteValueCents: rfq.quotes.reduce((sum, quote) => sum + quote.lines.reduce((lineSum, line) => lineSum + (lineTotalCents(Number(line.quantity), line.unitPriceCents) ?? 0), 0), 0),
  }))));
}

