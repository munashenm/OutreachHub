import { Prisma } from "../generated/prisma/client";
import { createHash } from "node:crypto";
import {
  canAutoSend,
  classifyCustomerReply,
  classifyInbound,
  currentCustomerText,
  extractRfqRequest,
  factualReply,
  isQuotationRequest,
  matchesKnownSupplier,
  matchRfqLine,
  priceQuotation,
  type InboundKind,
} from "../lib/automation";
import { getDb, isUniqueViolation } from "../lib/db";
import { AppError } from "../lib/errors";
import { recordActivity } from "./activity-service";
import { assistProductSelection, selectionIsNeeded } from "../lib/ai/product-evidence";
import { sendQuote } from "./quote-service";
import { sendCustomerResponse } from "./reply-service";
import { extractProductRequirements, planSourcing, requirementAwaitingQuantity, requirementSummary, type OutstandingItem, type ProductRequirement, type SourcingCandidate, type SourcingPools } from "../lib/sourcing";
import { relevantStoreProducts, UrbanFocusCatalogueError, urbanFocusCandidate, urbanFocusSearchQueries, urbanFocusSupplies, readStoreCatalogueQuery } from "../lib/urban-focus-search";
import { loadStoreProvider } from "./store/load";
import { sourceExternalForRequirements } from "./external-sourcing-service";
import { enquiryFromRequest, openSourcingTask, recordFunnel, recordReplyStage, responseForRequirement, stopQuoteFollowUp, unpricedCatalogueNote } from "./sales-response-service";
import { analyseRfqDocuments, analysisTextForRfq, listTenderAnalyses, responseModeForRfq, saveAnalysisMatches } from "./document-analysis-service";
import { matchRequestedSpecification, UNPRICED_LINE, type AnalysisMatch } from "../lib/document-analysis";
import { determineInitialResponse, inboundIsHistorical, sendResponseOnce, customerResponseAllowed, threadCustomerAction, type InitialResponse, type ProcessingRow, type ProcessingStore, type ResponseFacts } from "../lib/inbound-response";
import { asksToProceed, requestStrictness } from "../lib/rfq-match";
import { retryDelayMs } from "../lib/quote-send";
import { analyzeInboundEmail, logAiUse, parseRfqAnalysis, type RfqAnalysis } from "../lib/ai/rfq-analyzer";
import { requirementsForSourcing } from "../lib/ai/rfq-requirements";
import { generateQuotePdf } from "./quotation-pdf-service";

const BATCH = 15;

export async function processInboundAutomation() {
  const messages = await getDb().message.findMany({
    where: { direction: "INBOUND", automationAt: null, ignored: false },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });
  const results: { messageId: string; action?: string; error?: string }[] = [];
  for (const message of messages) {
    const gmailMessageId = message.externalId || message.id;
    const gate = await getDb().inboundMessageProcessing.findUnique({ where: { gmailMessageId }, select: { nextRetryAt: true, attemptCount: true } });
    if (gate?.nextRetryAt && gate.nextRetryAt > new Date()) {
      // nextRetryAt can be 1 or 5 minutes, but this worker only runs every 15 minutes, so the retry waits for the next tick.
      results.push({ messageId: message.id, action: "retry-waiting" });
      continue;
    }
    try {
      results.push({ messageId: message.id, action: await processInboundMessage(message.id) });
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 300) : "The message could not be processed.";
      console.error(`RFQ processing failed for ${message.id}: ${reason}`);
      const attemptCount = (gate?.attemptCount ?? 0) + 1;
      const delay = retryDelayMs(attemptCount);
      if (delay == null) {
        await getDb().message.update({ where: { id: message.id }, data: { automationAt: new Date() } });
        await getDb().rfq.updateMany({ where: { sourceMessageId: message.id }, data: { status: "FAILED", lastError: reason } });
        results.push({ messageId: message.id, action: "stopped" });
        continue;
      }
      const nextRetryAt = new Date(Date.now() + delay);
      await getDb().inboundMessageProcessing.upsert({
        where: { gmailMessageId },
        create: { workspaceId: message.workspaceId, messageId: message.id, gmailMessageId, threadId: message.threadId ?? "", processingStatus: "FAILED", attemptCount, nextRetryAt, lastError: reason },
        update: { attemptCount, nextRetryAt, lastError: reason, processingStatus: "FAILED" },
      });
      await getDb().rfq.updateMany({ where: { OR: [{ sourceMessageId: message.id }, { threadId: message.threadId || "missing" }] }, data: { lastError: reason } });
      results.push({ messageId: message.id, action: "retry-scheduled" });
    }
  }
  return { processed: results.filter((result) => result.action && result.action !== "retry-waiting" && result.action !== "retry-scheduled" && result.action !== "stopped").length, failed: results.filter((result) => result.error).length, results };
}

export async function getAutomationReport(workspaceId: string) {
  const db = getDb();
  const [mailbox, inbound, rfqs, acknowledgements, store] = await Promise.all([
    db.mailbox.findFirst({
      where: { workspaceId, provider: "GOOGLE" },
      select: { email: true, lastInboundSyncAt: true, lastError: true },
    }),
    db.message.count({ where: { workspaceId, direction: "INBOUND" } }),
    db.rfq.groupBy({ by: ["status"], where: { workspaceId }, _count: { _all: true } }),
    db.rfq.count({ where: { workspaceId, acknowledgementSentAt: { not: null } } }),
    db.workspace.findFirst({
      where: { id: workspaceId },
      select: { storeLastError: true },
    }),
  ]);
  const statusCount = (status: string) => rfqs.find((row) => row.status === status)?._count._all ?? 0;
  return { mailbox, inbound, acknowledgements, store, statusCount, needsReplyReview: statusCount("NEGOTIATION") + statusCount("REVIEWING") };
}

async function processInboundMessage(messageId: string) {
  const db = getDb();
  const message = await db.message.findFirst({ where: { id: messageId, direction: "INBOUND", automationAt: null } });
  if (!message) return "already-processed";
  const workspace = await db.workspace.findFirst({
    where: { id: message.workspaceId },
    select: { id: true, minimumMarginPercent: true, autoQuoteMarginPercent: true, autoSendMarginPercent: true },
  });
  if (!workspace) return "skipped";
  if (inboundIsHistorical({ receivedAt: message.sentAt, cutoff: process.env.RFQ_PROCESS_AFTER })) {
    await db.message.update({ where: { id: message.id }, data: { automationAt: new Date() } });
    console.info(`[RFQ] messageId=${message.externalId || message.id} historical-skipped`);
    return "historical-skipped";
  }
  const kind = classifyInbound({ subject: message.subject, body: message.body, campaignReply: Boolean(message.campaignId) });
  await db.message.update({ where: { id: message.id }, data: { category: inboxCategory(kind) } });
  if (await knownSupplierSender(message.workspaceId, message.fromEmail)) {
    console.info(`[RFQ] messageId=${message.externalId || message.id} supplier-message`);
    const delivery = await sendResponseOnce({
      gmailMessageId: message.externalId || message.id,
      threadId: message.threadId ?? "",
      response: { decision: "NO_RESPONSE", autoReplyType: "NONE", message: "" },
      store: processingStore(message.workspaceId, message.id),
      send: async () => undefined,
    });
    if (!delivery.blocked || delivery.finished) await db.message.update({ where: { id: message.id }, data: { automationAt: new Date() } });
    return delivery.blocked ? "already-replied" : "supplier-message";
  }
  const existing = await rfqForThread(message.workspaceId, message.threadId, message.id);
  if (existing && message.threadId && existing.threadId !== message.threadId) {
    await db.rfq.update({ where: { id: existing.id }, data: { threadId: message.threadId } });
    existing.threadId = message.threadId;
  }
  if (existing) {
    const currentBody = currentCustomerText(message.body);
    const quoteSent = existing.status === "QUOTE_SENT" || existing.status === "SENT" || existing.status === "WON" || existing.quotes.some((quote) => quote.status === "SENT");
    const action = threadCustomerAction({
      kind: classifyInbound({ subject: message.subject, body: currentBody, campaignReply: false }),
      quoteSent,
      currentText: currentBody,
    });
    if (action === "quote-reply") {
      await handleQuoteReply(message, existing.id);
      return "reply";
    }
    if (action === "no-response") {
      const delivery = await sendResponseOnce({
        gmailMessageId: message.externalId || message.id,
        threadId: message.threadId ?? "",
        response: { decision: "NO_RESPONSE", autoReplyType: "NONE", message: "" },
        store: processingStore(message.workspaceId, message.id),
        send: async () => undefined,
      });
      if (!delivery.blocked || delivery.finished) await db.message.update({ where: { id: message.id }, data: { automationAt: new Date() } });
      return delivery.blocked ? "already-replied" : "thread-reply";
    }
    await analyseRfqDocuments(message.workspaceId, existing.id);
    const outcome = await quoteRfq(existing.id, workspace, { revise: true });
    return deliverRfqOutcome(message, existing.id, outcome);
  }
  if (!isQuotationRequest(kind)) {
    const delivery = await sendResponseOnce({
      gmailMessageId: message.externalId || message.id,
      threadId: message.threadId ?? "",
      response: { decision: "NO_RESPONSE", autoReplyType: "NONE", message: "" },
      store: processingStore(message.workspaceId, message.id),
      send: async () => undefined,
    });
    if (!delivery.blocked || delivery.finished) await db.message.update({ where: { id: message.id }, data: { automationAt: new Date() } });
    return delivery.blocked ? "already-replied" : kind;
  }
  const rfq = await createRfq(message, null);
  const documentMode = await analyseRfqDocuments(message.workspaceId, rfq.id);
  const outcome = documentMode === "TENDER_PACKAGE"
    ? await quoteRfq(rfq.id, workspace, { notify: false })
    : await quoteRfq(rfq.id, workspace);
  if (documentMode === "TENDER_PACKAGE") return "tender";
  return deliverRfqOutcome(message, rfq.id, outcome);
}

async function deliverRfqOutcome(
  message: { id: string; workspaceId: string; externalId: string | null; threadId: string | null; fromEmail: string | null; subject: string },
  rfqId: string,
  outcome: InitialResponse & { quoteId: string; quoteNotes: string },
) {
  const db = getDb();
  const rfq = await db.rfq.findFirst({ where: { id: rfqId }, select: { acknowledgementSentAt: true } });
  const response = customerResponseAllowed({ acknowledgementSent: Boolean(rfq?.acknowledgementSentAt), decision: outcome.decision })
    ? outcome
    : { ...outcome, decision: "NO_RESPONSE" as const, autoReplyType: "NONE" as const, message: "" };
  const delivery = await sendResponseOnce({
    gmailMessageId: message.externalId || message.id,
    threadId: message.threadId ?? "",
    response,
    quoteId: outcome.quoteId,
    store: processingStore(message.workspaceId, message.id),
    send: async () => {
      if (!message.fromEmail) return;
      if (response.decision === "QUOTE_READY") {
        await sendQuote({ userId: "system", workspaceId: message.workspaceId }, rfqId, { validDays: 14, notes: outcome.quoteNotes });
        return;
      }
      if (response.decision === "NO_RESPONSE") return;
      const outboundKey = response.decision === "NEEDS_CLARIFICATION"
        ? `CLARIFY:${rfqId}:${createHash("sha256").update(response.message).digest("hex").slice(0, 16)}`
        : `ACK:${rfqId}`;
      try {
        await db.rfqOutboundKey.create({ data: { key: outboundKey, rfqId } });
      } catch (error) {
        if (isUniqueViolation(error)) return;
        throw error;
      }
      await sendCustomerResponse(
        { userId: "system", workspaceId: message.workspaceId },
        { messageId: message.id, to: message.fromEmail, cc: "", subject: replySubject(message.subject), body: response.message },
      );
      if (response.autoReplyType === "SOURCING_ACK" || response.autoReplyType === "PRICING_ACK" || response.autoReplyType === "CLARIFICATION") {
        await db.rfq.update({ where: { id: rfqId }, data: { acknowledgementSentAt: new Date() } });
      }
    },
  });
  if (!delivery.blocked || delivery.finished) await db.message.update({ where: { id: message.id }, data: { automationAt: new Date() } });
  return delivery.blocked ? "already-replied" : "rfq";
}

async function knownSupplierSender(workspaceId: string, fromEmail: string | null) {
  if (!fromEmail) return false;
  const suppliers = await getDb().supplier.findMany({
    where: { workspaceId },
    select: { email: true },
  });
  return matchesKnownSupplier(fromEmail, suppliers.map((supplier) => supplier.email));
}

async function inboundThreadText(rfq: { workspaceId: string; threadId: string; subject: string; description: string; sourceMessage: { subject: string; body: string; threadId: string | null } | null }) {
  const threadId = rfq.threadId || rfq.sourceMessage?.threadId || "";
  if (!threadId) return `${rfq.sourceMessage?.subject ?? rfq.subject}\n${rfq.sourceMessage?.body || rfq.description}`;
  const messages = await getDb().message.findMany({
    where: { workspaceId: rfq.workspaceId, threadId, direction: "INBOUND" },
    orderBy: { createdAt: "asc" },
    select: { subject: true, body: true },
  });
  if (messages.length === 0) return `${rfq.subject}\n${rfq.description}`;
  return messages.map((message) => `${message.subject}\n${message.body}`).join("\n");
}

async function handleQuoteReply(message: { id: string; workspaceId: string; body: string; subject: string; fromEmail: string | null; externalId?: string | null; threadId?: string | null }, rfqId: string) {
  const db = getDb();
  const currentBody = currentCustomerText(message.body);
  const kind = classifyCustomerReply(currentBody);
  const proceed = asksToProceed(currentBody);
  const rfq = await db.rfq.findFirst({
    where: { id: rfqId, workspaceId: message.workspaceId },
    include: { quotes: { where: { status: "SENT" }, include: { lines: { include: { product: true } } }, orderBy: { sentAt: "desc" }, take: 1 } },
  });
  if (!rfq) return;
  await getDb().rfq.update({ where: { id: rfq.id }, data: { respondedAt: rfq.respondedAt ?? new Date() } });
  await recordReplyStage(message.workspaceId, rfq.id);
  await stopQuoteFollowUp(rfq.id, kind === "NOT_INTERESTED" ? "rejected" : kind === "PURCHASE_ORDER" || kind === "QUOTE_ACCEPTED" || proceed ? "ordered" : "customer replied");
  if (kind === "QUOTE_ACCEPTED" || kind === "PURCHASE_ORDER" || proceed) {
    if (rfq.status !== "WON") {
      await db.rfq.update({ where: { id: rfq.id }, data: { status: "WON", automationNote: kind === "PURCHASE_ORDER" ? "Purchase order received. Credit terms were not changed." : "The customer accepted the quotation." } });
      await recordFunnel({ workspaceId: message.workspaceId, rfqId: rfq.id, status: "WON" });
    }
  } else if (kind === "NOT_INTERESTED") {
    if (rfq.status !== "LOST") await db.rfq.update({ where: { id: rfq.id }, data: { status: "LOST", lostReason: "Customer declined", automationNote: "The customer is not interested." } });
    await recordFunnel({ workspaceId: message.workspaceId, rfqId: rfq.id, status: "LOST", note: "Customer declined" });
  } else if (kind === "PRICE_NEGOTIATION" || kind === "ALTERNATIVE_REQUEST" || kind === "DELIVERY_QUESTION") {
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "NEGOTIATION", automationNote: "A suggested reply needs approval. The price, substitute, and delivery terms were not changed." } });
    await recordFunnel({ workspaceId: message.workspaceId, rfqId: rfq.id, status: "NEGOTIATION" });
  } else {
    const quote = rfq.quotes[0];
    const line = quote?.lines[0];
    const reply = factualReply(kind, {
      stockQty: line?.product?.stockOnHand ?? null,
      validUntil: quote?.validUntil ? quote.validUntil.toISOString().slice(0, 10) : "",
      specifications: line?.specifications || line?.product?.specifications || "",
    });
    if (reply && message.fromEmail) {
      const delivery = await sendResponseOnce({
        gmailMessageId: message.externalId || message.id,
        threadId: message.threadId ?? "",
        response: { decision: "NEEDS_CLARIFICATION", autoReplyType: "CLARIFICATION", message: reply },
        store: processingStore(message.workspaceId, message.id),
        send: async () => {
          await sendCustomerResponse(
            { userId: "system", workspaceId: message.workspaceId },
            { messageId: message.id, to: message.fromEmail ?? "", cc: "", subject: replySubject(message.subject), body: reply },
          );
        },
      });
      if (!delivery.blocked || delivery.finished) await db.message.update({ where: { id: message.id }, data: { automationAt: new Date() } });
      return;
    }
    await db.rfq.update({ where: { id: rfq.id }, data: { automationNote: "The reply needs a person to answer it." } });
  }
  const delivery = await sendResponseOnce({
    gmailMessageId: message.externalId || message.id,
    threadId: message.threadId ?? "",
    response: { decision: "NO_RESPONSE", autoReplyType: "NONE", message: "" },
    store: processingStore(message.workspaceId, message.id),
    send: async () => undefined,
  });
  if (!delivery.blocked || delivery.finished) await db.message.update({ where: { id: message.id }, data: { automationAt: new Date() } });
}

async function extractInboundRfq(body: string, analysis: RfqAnalysis | null) {
  const extracted = extractRfqRequest(body);
  if (!analysis || analysis.items.length === 0) return extracted;
  const lines = requirementsForSourcing(body, analysis).flatMap((requirement) => {
    if (requirement.quantity == null) return [];
    const description = (requirement.requestedText.split(/\r?\n/).find((line) => line.trim()) || requirement.model || requirement.productType).slice(0, 300);
    if (description.length < 2) return [];
    return [{
      description,
      quantity: requirement.quantity,
      manufacturer: requirement.brandPreference,
      model: requirement.model,
      sku: requirement.sku,
      manufacturerPartNumber: requirement.mpn,
      specifications: requirement.requestedText.slice(0, 300),
    }];
  });
  return lines.length > 0 ? { ...extracted, lines } : extracted;
}

async function createRfq(message: { id: string; workspaceId: string; subject: string; body: string; fromEmail: string | null; fromName: string | null; prospectId: string | null; threadId?: string | null }, analysis: RfqAnalysis | null) {
  const extracted = await extractInboundRfq(message.body, analysis);
  const email = extracted.email || message.fromEmail || "";
  const prospect = message.prospectId
    ? await getDb().prospect.findFirst({ where: { id: message.prospectId, workspaceId: message.workspaceId }, select: { id: true, companyId: true } })
    : email
      ? await getDb().prospect.findFirst({ where: { workspaceId: message.workspaceId, email }, select: { id: true, companyId: true } })
      : null;
  try {
    const rfq = await getDb().rfq.create({
      data: {
        workspaceId: message.workspaceId,
        sourceMessageId: message.id,
        threadId: message.threadId ?? "",
        prospectId: prospect?.id ?? null,
        companyId: prospect?.companyId ?? null,
        subject: message.subject || "Quotation request",
        description: message.body.slice(0, 8000),
        customerReference: extracted.reference,
        deliveryLocation: extracted.deliveryLocation,
        requiredDate: extracted.requiredDate,
        notes: [extracted.customerName, extracted.companyName].filter(Boolean).join(", "),
        status: "RECEIVED",
        enquiryJson: {
          ...enquiryFromRequest({
            intent: classifyInbound({ subject: message.subject, body: message.body, campaignReply: false }),
            customerName: extracted.customerName,
            companyName: extracted.companyName,
            email,
            reference: extracted.reference,
            requirements: extractProductRequirements(`${message.subject}\n${message.body}`),
          }) as Record<string, unknown>,
          ...(analysis ? { ai: analysis } : {}),
        },
        lines: {
          create: extracted.lines.map((line) => ({
            workspaceId: message.workspaceId,
            description: line.description,
            quantity: line.quantity == null ? null : new Prisma.Decimal(line.quantity.toFixed(2)),
            manufacturer: line.manufacturer,
            modelName: line.model,
            sku: line.sku,
            manufacturerPartNumber: line.manufacturerPartNumber,
            specifications: line.specifications,
          })),
        },
      },
      include: { lines: true, quotes: true },
    });
    await recordActivity(getDb(), {
      workspaceId: message.workspaceId,
      type: "RFQ_CREATED",
      prospectId: prospect?.id ?? null,
      companyId: prospect?.companyId ?? null,
      summary: `Opened RFQ “${rfq.subject}” from inbound mail.`,
    });
    await recordFunnel({ workspaceId: message.workspaceId, rfqId: rfq.id, status: "NEW" });
    await recordFunnel({ workspaceId: message.workspaceId, rfqId: rfq.id, status: "REVIEWING" });
    return rfq;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await rfqForThread(message.workspaceId, null, message.id);
    if (!existing) throw error;
    return existing;
  }
}

export async function rerunRfqSourcing(workspaceId: string, rfqId: string) {
  const workspace = await getDb().workspace.findFirst({
    where: { id: workspaceId },
    select: { id: true, minimumMarginPercent: true, autoQuoteMarginPercent: true, autoSendMarginPercent: true },
  });
  if (!workspace) return;
  await quoteRfq(rfqId, workspace, { notify: false });
}

export async function findDocumentProducts(workspaceId: string, rfqId: string) {
  const analyses = await listTenderAnalyses(workspaceId, rfqId);
  if (analyses.length === 0) return;
  const pools = await sourcingPools(workspaceId);
  const candidates = [...pools.catalogue, ...pools.supplierFeeds, ...pools.supplierApis, ...pools.external];
  const observedAt = new Date().toISOString();
  const matchesByAnalysis = new Map<string, AnalysisMatch[]>();
  for (const analysis of analyses) {
    const matches: AnalysisMatch[] = [];
    for (const item of analysis.record.items) {
      const ranked = candidates.map((candidate) => ({ candidate, result: matchRequestedSpecification(item, candidate) }))
        .filter((entry) => entry.result.match !== "NO MATCH")
        .sort((left, right) => matchRank(left.result.match) - matchRank(right.result.match));
      const best = ranked[0];
      if (!best) {
        matches.push({ lineNumber: item.lineNumber, match: "NO MATCH", explanation: "No Urban Focus product meets this line.", productId: null, productName: "", sku: "", sourceKind: "", sourceName: "", sourceUrl: "", observedPriceCents: null, vatIncluded: false, availability: "", observedAt, pricedFromSupplier: false, ...UNPRICED_LINE });
        continue;
      }
      const supplierPriced = best.candidate.sourceKind !== "EXTERNAL_SOURCE" && (best.candidate.costExVatCents ?? 0) > 0 && best.candidate.fresh;
      matches.push({
        lineNumber: item.lineNumber,
        match: best.result.match,
        explanation: best.result.explanation,
        productId: best.candidate.productId,
        productName: best.candidate.name,
        sku: best.candidate.sku,
        sourceKind: best.candidate.sourceKind,
        sourceName: best.candidate.sourceName,
        sourceUrl: best.candidate.sourceUrl,
        observedPriceCents: best.candidate.sourceKind === "EXTERNAL_SOURCE" ? best.candidate.listedPriceCents : null,
        vatIncluded: best.candidate.vatIncluded,
        availability: best.candidate.stockQty == null ? "" : `${best.candidate.stockQty} available`,
        observedAt,
        pricedFromSupplier: supplierPriced && best.result.match === "MATCH",
        ...UNPRICED_LINE,
        shippingCostCents: best.candidate.shippingCents > 0 ? best.candidate.shippingCents : null,
        otherCostCents: best.candidate.procurementCents + best.candidate.importCents > 0 ? best.candidate.procurementCents + best.candidate.importCents : null,
        supplierCostCents: supplierPriced ? best.candidate.costExVatCents : null,
      });
    }
    matchesByAnalysis.set(analysis.id, matches);
  }
  await saveAnalysisMatches(workspaceId, rfqId, matchesByAnalysis);
}

function matchRank(match: AnalysisMatch["match"]) {
  if (match === "MATCH") return 0;
  if (match === "PARTIAL MATCH") return 1;
  if (match === "NEEDS REVIEW") return 2;
  return 3;
}

async function recordRfqEvent(workspaceId: string, rfqId: string, type: string, status: string, reason: string) {
  await getDb().rfqEvent.create({ data: { workspaceId, rfqId, type, status, reason: reason.slice(0, 500) } });
}

async function recordOutstandingQuotation(workspaceId: string, rfq: { id: string; customerReference: string; quotes: { id: string; status: string }[] }, items: OutstandingItem[], note: string) {
  const db = getDb();
  let draft = rfq.quotes.find((quote) => quote.status === "DRAFT");
  if (!draft) {
    draft = await db.quote.create({ data: { workspaceId, rfqId: rfq.id, confidenceScore: 0, notes: rfq.customerReference ? `Customer reference ${rfq.customerReference}` : "" } });
  } else {
    await db.quoteLine.deleteMany({ where: { quoteId: draft.id } });
  }
  for (const item of items) {
    const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;
    await db.quoteLine.create({
      data: {
        workspaceId,
        quoteId: draft.id,
        description: item.label.slice(0, 500),
        quantity: new Prisma.Decimal(quantity.toFixed(2)),
        unitPriceCents: 0,
        specifications: item.reason.slice(0, 2000),
        requirementText: item.requestedText.slice(0, 2000),
        sourceUrl: item.sourceUrl,
        costStatus: "OUTSTANDING",
        availability: "Not quoted",
      },
    });
  }
  await generateQuotePdf(workspaceId, draft.id);
  await db.rfq.update({ where: { id: rfq.id }, data: { status: "REVIEWING", automationNote: note, quoteBlockedReason: note } });
  await recordRfqEvent(workspaceId, rfq.id, "REVIEW_REQUIRED", "REVIEWING", note);
}

async function quoteRfq(rfqId: string, workspace: { id: string; minimumMarginPercent: number; autoQuoteMarginPercent: number; autoSendMarginPercent: number }, options?: { notify?: boolean; revise?: boolean }): Promise<InitialResponse & { quoteId: string; quoteNotes: string }> {
  const notify = options?.notify !== false;
  const none = { decision: "NO_RESPONSE" as const, autoReplyType: "NONE" as const, message: "", quoteId: "", quoteNotes: "" };
  const respond = (facts: Partial<ResponseFacts>, quoteId = ""): InitialResponse & { quoteId: string; quoteNotes: string } => ({
    ...determineInitialResponse({
      quotationRequest: true,
      tenderPackage: false,
      planKind: "NONE",
      planSend: false,
      planMessage: "",
      salesAction: "",
      salesMessage: "",
      catalogueProductNamed: false,
      awaitingQuantity: false,
      documentBlocksAutoSend: false,
      notify,
      ...facts,
    }),
    quoteId,
    quoteNotes: "",
  });
  const db = getDb();
  const rfq = await db.rfq.findFirst({
    where: { id: rfqId, workspaceId: workspace.id },
    include: { lines: true, quotes: true, sourceMessage: true },
  });
  if (!rfq || (!options?.revise && rfq.quotes.some((quote) => quote.status === "SENT"))) return none;
  const documentText = await analysisTextForRfq(rfq.id);
  const threadText = await inboundThreadText(rfq);
  const source = `${threadText}\n${documentText}`.trim().slice(0, 12000);
  const analysis = await rememberAiInterpretation(rfq, source);
  const requirements = requirementsForSourcing(source, analysis);
  await db.rfq.update({ where: { id: rfq.id }, data: { status: "PARSING" } });
  await recordRfqEvent(workspace.id, rfq.id, "EMAIL_RECEIVED", "PARSING", analysis ? "OpenAI extraction is the quotation record." : "OpenAI was unavailable. The RFQ was kept for internal processing.");
  await storeParsedRequirements(rfq, requirements, workspace.id, { authoritative: Boolean(analysis && analysis.items.length > 0) });
  if (!analysis || analysis.items.length === 0) {
    const note = analysis
      ? "OpenAI did not return a grounded product list. The RFQ was kept for internal processing and was not quoted automatically."
      : "OpenAI was unavailable. The RFQ was kept for internal processing and was not quoted automatically.";
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "REVIEWING", automationNote: note } });
    await recordRfqEvent(workspace.id, rfq.id, "REVIEW_REQUIRED", "REVIEWING", note);
    await openSourcingTask(workspace.id, rfq.id, note);
    return respond({ planKind: "STAFF_REVIEW" });
  }
  const margins = {
    minimumMarginPercent: workspace.minimumMarginPercent,
    autoQuoteMarginPercent: workspace.autoQuoteMarginPercent,
    autoSendMarginPercent: workspace.autoSendMarginPercent,
  };
  let pools: SourcingPools;
  try {
    pools = await sourcingPools(workspace.id, requirements);
  } catch (error) {
    if (!(error instanceof UrbanFocusCatalogueError)) throw error;
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "REVIEWING", automationNote: error.message, quoteBlockedReason: error.message } });
    await recordRfqEvent(workspace.id, rfq.id, "REVIEW_REQUIRED", "REVIEWING", error.message);
    return respond({ planKind: "STAFF_REVIEW" });
  }
  const strictness = requirements[0] ? requestStrictness(requirements[0].requestedText, Boolean(requirements[0].sku || requirements[0].mpn || requirements[0].model)) : "";
  const requirementsHash = createHash("sha256").update(requirements.map((requirement) => requirement.requestedText).join("\n")).digest("hex").slice(0, 16);
  await db.rfq.update({ where: { id: rfq.id }, data: { status: "MATCHING", strictness, requirementsHash } });
  await recordRfqEvent(workspace.id, rfq.id, "REQUIREMENTS_PARSED", "MATCHING", strictness || "No structured requirement.");
  const suppliedByUrbanFocus = (requirement: ProductRequirement) => urbanFocusSupplies(requirement, pools.catalogue);
  const catalogueCoversRequest = requirements.length > 0 && requirements.every(suppliedByUrbanFocus);
  let searchedOnline = false;
  const retrieved = [...pools.catalogue, ...pools.supplierFeeds, ...pools.supplierApis, ...pools.external];
  if (!catalogueCoversRequest && selectionIsNeeded(requirements, retrieved)) {
    const unmatchedRequirements = [...requirements];
    const assisted = await assistProductSelection({
      requirements,
      evidence: retrieved,
      searchOnline: async (query) => {
        const marker = (item: ProductRequirement) => (item.productType || item.model || item.sku).toLowerCase();
        const index = unmatchedRequirements.findIndex((item) => {
          const name = marker(item);
          return name.length >= 4 && query.toLowerCase().includes(name);
        });
        const requirement = index >= 0 ? unmatchedRequirements.splice(index, 1)[0] : unmatchedRequirements.shift();
        if (!requirement || urbanFocusSupplies(requirement, pools.catalogue)) return [];
        const live = await sourceExternalForRequirements(workspace.id, [requirement], query);
        return live.candidates;
      },
    });
    searchedOnline = assisted.searched;
    if (!assisted.ok) await openSourcingTask(workspace.id, rfq.id, assisted.reviewReason);
    if (assisted.ok && assisted.accepted.length > 0) {
      pools = {
        catalogue: assisted.accepted.filter((candidate) => candidate.sourceKind === "URBAN_FOCUS_CATALOGUE" && candidate.vatKnown !== false),
        supplierFeeds: assisted.accepted.filter((candidate) => candidate.sourceKind === "SUPPLIER_FEED" && candidate.vatKnown !== false),
        supplierApis: assisted.accepted.filter((candidate) => candidate.sourceKind === "SUPPLIER_API" && candidate.vatKnown !== false),
        external: assisted.accepted.filter((candidate) => candidate.sourceKind === "EXTERNAL_SOURCE" && candidate.vatKnown !== false),
      };
    }
    const seenSources = new Set(pools.external.map((candidate) => candidate.sourceUrl).filter(Boolean));
    const added = assisted.retrieved.filter((candidate) => !candidate.sourceUrl || !seenSources.has(candidate.sourceUrl));
    if (added.length > 0) pools = { ...pools, external: [...pools.external, ...added] };
    const withheld = assisted.accepted.filter((candidate) => candidate.vatKnown === false && candidate.listedPriceCents);
    if (withheld.length > 0) {
      const note = withheld.map((candidate) => `${candidate.name} was retrieved from ${candidate.sourceUrl}. The listed amount is ${candidate.listedPriceCents} cents in ZAR. VAT treatment was not stated, so no selling price was calculated.`).join(" ");
      await openSourcingTask(workspace.id, rfq.id, note);
    }
  }
  let plan = planSourcing({ requirements, pools, ...margins });
  if (!searchedOnline) {
    let pending: ProductRequirement[] = [];
    if (plan.kind === "QUOTE") {
      const outstanding = plan.outstanding;
      pending = requirements.filter((requirement) => outstanding.some((item) => item.requestedText === requirement.requestedText));
    } else if (plan.kind === "SOURCING") {
      pending = requirements.filter((requirement) => requirement.quantity != null);
    }
    pending = pending.filter((requirement) => !urbanFocusSupplies(requirement, pools.catalogue));
    if (pending.length > 0) {
      const live = await sourceExternalForRequirements(workspace.id, pending.slice(0, 4));
      if (live.candidates.length > 0) {
        pools = { ...pools, external: [...pools.external, ...live.candidates] };
        plan = planSourcing({ requirements, pools, ...margins });
      }
      if (plan.kind === "SOURCING") plan = { ...plan, note: live.note };
      if (plan.kind === "QUOTE" && plan.outstanding.length > 0 && live.note) {
        const evidence = live.note.replace(/\s+/g, " ").slice(0, 500);
        plan = {
          ...plan,
          outstanding: plan.outstanding.map((item) => ({ ...item, reason: `${item.reason} ${evidence}`.slice(0, 500) })),
          note: `${plan.note} ${evidence}`.slice(0, 2000),
        };
      }
    }
  }
  if (plan.kind === "CLARIFICATION" || plan.kind === "STAFF_REVIEW") {
    const note = plan.kind === "CLARIFICATION" ? plan.message : plan.note;
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "REVIEWING", automationNote: note } });
    await recordRfqEvent(workspace.id, rfq.id, "REVIEW_REQUIRED", "REVIEWING", note);
    await openSourcingTask(workspace.id, rfq.id, note);
    return respond({ planKind: "STAFF_REVIEW" });
  }
  const requirement = requirements[0];
  const sales = requirement
    ? responseForRequirement(requirement, [...pools.catalogue, ...pools.supplierFeeds, ...pools.supplierApis], margins, plan.kind === "QUOTE" && plan.send)
    : null;
  if (plan.kind === "SOURCING" && requirement && sales) {
    const catalogueNote = unpricedCatalogueNote(requirement, sales.matches);
    if (catalogueNote) {
      const note = requirementAwaitingQuantity(requirement) ? `${catalogueNote} The quantity was not stated.` : catalogueNote;
      const chosen = sales.matches.find((match) => catalogueNote.startsWith(match.name));
      const line = rfq.lines[0];
      if (line && chosen) {
        await db.rfqLine.update({
          where: { id: line.id },
          data: {
            sourcedName: chosen.name,
            sourceKind: "URBAN_FOCUS_CATALOGUE",
            matchGrade: chosen.method,
            matchStatus: "MATCHED",
            matchNote: "Urban Focus catalogue. No verified cost was returned with the product.",
            costStatus: "",
            productId: null,
            stockNote: chosen.stockQty == null ? "" : `${chosen.stockQty} on the website`,
          },
        });
      }
      await db.rfq.update({ where: { id: rfq.id }, data: { status: "REVIEWING", automationNote: note } });
      return respond({ planKind: "SOURCING", catalogueProductNamed: true, awaitingQuantity: requirementAwaitingQuantity(requirement) });
    }
  }
  if (plan.kind === "SOURCING" && sales && (sales.action === "ALTERNATIVES" || sales.action === "PREPARE") && sales.matches.some((match) => (match.unitPriceCents ?? 0) > 0)) {
    await rememberAlternativeQuote(rfq, sales.matches, workspace.id, Math.max(1, requirement?.quantity ?? 1), sales.confidence);
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "READY_TO_QUOTE", automationNote: sales.action === "ALTERNATIVES" ? "The exact product is unavailable. Verified alternatives are waiting for approval." : "A verified supplier price is waiting for approval." } });
    return respond({ planKind: "SOURCING", catalogueProductNamed: true, salesAction: sales.action === "ALTERNATIVES" ? "ALTERNATIVES" : "PREPARE", salesMessage: sales.message });
  }
  if (plan.kind === "SOURCING") {
    if (plan.outstanding && plan.outstanding.length > 0) {
      await recordOutstandingQuotation(workspace.id, rfq, plan.outstanding, plan.note);
      return respond({ planKind: "SOURCING", planMessage: plan.message });
    }
    if (sales?.action === "EXTERNAL_TASK") await openSourcingTask(workspace.id, rfq.id, requirement?.requestedText || rfq.subject);
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "SOURCING", automationNote: plan.note, quoteBlockedReason: plan.note } });
    await recordRfqEvent(workspace.id, rfq.id, "SOURCING_STARTED", "SOURCING", plan.note);
    return respond({ planKind: "SOURCING", planMessage: plan.message, salesAction: sales?.action === "EXTERNAL_TASK" ? "EXTERNAL_TASK" : "" });
  }
  const rankedOptions = plan.options;
  const recommended = rankedOptions[0];
  if (recommended && rfq.lines[0]) {
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "MATCHED", lastMatchedAt: new Date(), quoteBlockedReason: "" } });
    await recordRfqEvent(workspace.id, rfq.id, "MATCH_COMPLETED", "MATCHED", plan.note);
    await db.rfqLine.update({
      where: { id: rfq.lines[0].id },
      data: {
        sourcedName: recommended.name,
        sourceKind: recommended.sourceKind,
        matchGrade: recommended.match,
        costStatus: recommended.costStatus,
        stockNote: recommended.stockQty == null ? "" : `${recommended.stockQty} available`,
        matchStatus: "MATCHED",
        matchNote: recommended.match,
        productId: recommended.productId,
      },
    });
  }
  let draft = rfq.quotes.find((quote) => quote.status === "DRAFT");
  if (!draft) {
    draft = await db.quote.create({ data: { workspaceId: workspace.id, rfqId: rfq.id, confidenceScore: sales?.confidence ?? 0, notes: rfq.customerReference ? `Customer reference ${rfq.customerReference}` : "" } });
  } else {
    await db.quoteLine.deleteMany({ where: { quoteId: draft.id } });
    if (sales) await db.quote.update({ where: { id: draft.id }, data: { confidenceScore: sales.confidence } });
  }
  const lineKeys = new Set(rankedOptions.map((option) => option.lineKey).filter(Boolean));
  const alternatives = lineKeys.size <= 1 && rankedOptions.length > 1;
  if (alternatives) {
    const alternativeNote = "These are alternative options. Choose one. The option totals are not added together.";
    await db.quote.update({ where: { id: draft.id }, data: { notes: [draft.notes, alternativeNote].filter(Boolean).join("\n") } });
  }
  for (const [index, option] of rankedOptions.entries()) {
    const tier = index === 0 ? "Value" : "Performance";
    const pictured = [...pools.catalogue, ...pools.supplierFeeds, ...pools.supplierApis, ...pools.external].find((candidate) => candidate.name === option.name && candidate.sourceKind === option.sourceKind);
    await db.quoteLine.create({
      data: {
        workspaceId: workspace.id,
        quoteId: draft.id,
        productId: option.productId,
        description: alternatives ? `OPTION ${index + 1} – ${tier}: ${option.name}` : option.name,
        sku: pictured?.sku ?? "",
        modelName: pictured?.model ?? "",
        manufacturerPartNumber: pictured?.mpn ?? "",
        quantity: new Prisma.Decimal(option.quantity.toFixed(2)),
        unitPriceCents: option.unitPriceCents,
        specifications: option.specifications,
        imageUrls: pictured?.imageUrls ?? [],
        sourceKind: option.sourceKind,
        sourceUrl: option.sourceUrl,
        sourceCheckedAt: option.checkedAt ? new Date(option.checkedAt) : null,
        matchGrade: option.match,
        costStatus: option.costStatus,
      },
    });
  }
  for (const item of plan.outstanding) {
    await db.quoteLine.create({
      data: {
        workspaceId: workspace.id,
        quoteId: draft.id,
        description: item.label.slice(0, 500),
        quantity: new Prisma.Decimal((item.quantity ?? 0).toFixed(2)),
        unitPriceCents: 0,
        specifications: item.reason.slice(0, 2000),
        requirementText: item.requestedText.slice(0, 2000),
        sourceUrl: item.sourceUrl,
        costStatus: "OUTSTANDING",
        availability: "Not quoted",
      },
    });
  }
  await db.rfq.update({ where: { id: rfq.id }, data: { status: "PRICED", lastPricedAt: new Date(), automationNote: plan.note } });
  await recordRfqEvent(workspace.id, rfq.id, "PRICED", "PRICED", plan.note);
  await generateQuotePdf(workspace.id, draft.id);
  if (plan.outstanding.length > 0) {
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "REVIEWING", automationNote: plan.note, quoteBlockedReason: plan.note } });
    await recordRfqEvent(workspace.id, rfq.id, "REVIEW_REQUIRED", "REVIEWING", plan.note);
    return respond({ planKind: "QUOTE", planSend: false, catalogueProductNamed: true });
  }
  await db.rfq.update({ where: { id: rfq.id }, data: { status: "QUOTE_READY", automationNote: plan.note } });
  await recordRfqEvent(workspace.id, rfq.id, "PDF_GENERATED", "QUOTE_READY", plan.note);
  if (requirements.some((requirement) => requirement.quantity == null)) {
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "REVIEWING", automationNote: "A quantity was not tied to every item. The draft was kept for internal review and was not emailed." } });
    return respond({ planKind: "STAFF_REVIEW" });
  }
  const documentMode = await responseModeForRfq(rfq.id);
  if (documentMode && documentMode !== "AUTO_SEND") {
    await db.rfq.update({
      where: { id: rfq.id },
      data: {
        status: "REVIEWING",
        automationNote: documentMode === "TENDER_PACKAGE"
          ? "This tender requires the official submission method. No quotation email was sent."
          : documentMode === "CANNOT_QUOTE"
            ? "A mandatory specification is missing or cannot be satisfied."
            : "The document needs approval before a quotation is sent.",
      },
    });
    return respond({ planKind: "QUOTE", planSend: true, salesAction: "AUTO_SEND", documentBlocksAutoSend: true, catalogueProductNamed: true });
  }
  if (!plan.send || !notify) {
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "QUOTE_READY", automationNote: plan.note } });
    return notify ? respond({ planKind: "QUOTE", planSend: false, catalogueProductNamed: true }) : none;
  }
  return { ...respond({ planKind: "QUOTE", planSend: true, salesAction: "AUTO_SEND" }, draft.id), quoteNotes: draft.notes };
}

async function rememberAiInterpretation(rfq: { id: string; subject: string; description: string; enquiryJson: unknown; sourceMessage: { subject: string; body: string } | null }, source: string) {
  const sourceHash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const stored = storedAnalysis(rfq.enquiryJson);
  const previousHash = rfq.enquiryJson && typeof rfq.enquiryJson === "object" && !Array.isArray(rfq.enquiryJson) ? String((rfq.enquiryJson as Record<string, unknown>).aiSourceHash ?? "") : "";
  if (stored && previousHash === sourceHash) {
    logAiUse({ purpose: "extraction", invoked: false, success: true, reviewReason: "unchanged" });
    return stored;
  }
  const analysis = await analyzeInboundEmail({ subject: "", body: source });
  if (!analysis) return null;
  const base = rfq.enquiryJson && typeof rfq.enquiryJson === "object" && !Array.isArray(rfq.enquiryJson) ? rfq.enquiryJson as Record<string, unknown> : {};
  const previousLog = Array.isArray(base.aiLog) ? base.aiLog.slice(-7) : [];
  await getDb().rfq.update({
    where: { id: rfq.id },
    data: {
      enquiryJson: {
        ...base,
        ai: analysis,
        aiSourceHash: sourceHash,
        aiLog: [...previousLog, { at: new Date().toISOString(), purpose: "extraction", success: analysis.items.length > 0, sourceHash }],
      },
    },
  });
  return analysis;
}

function storedAnalysis(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return parseRfqAnalysis((value as Record<string, unknown>).ai);
}

export async function sourcingPools(workspaceId: string, requirements: ProductRequirement[] = []): Promise<SourcingPools> {
  const db = getDb();
  const now = new Date();
  const freshAfter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [external, catalogue] = await Promise.all([
    db.externalSourceOffer.findMany({ where: { workspaceId, checkedAt: { gte: freshAfter }, sourceUrl: { not: "" } }, take: 100, orderBy: { checkedAt: "desc" } }),
    urbanFocusCatalogue(workspaceId, requirements, now),
  ]);
  const externalCandidates: SourcingCandidate[] = external.map((offer) => ({
    sourceKind: "EXTERNAL_SOURCE",
    sourceName: offer.sourceName,
    sourceUrl: offer.sourceUrl,
    sourceType: offer.sourceType === "MANUFACTURER" || offer.sourceType === "DISTRIBUTOR" || offer.sourceType === "RETAILER" || offer.sourceType === "INTERNAL" ? offer.sourceType : "OTHER",
    productId: null,
    name: offer.productName,
    brand: offer.brand,
    model: offer.model,
    sku: offer.sku,
    mpn: offer.mpn,
    specifications: offer.specifications,
    costExVatCents: null,
    listedPriceCents: offer.listedPriceCents,
    vatIncluded: offer.vatIncluded,
    shippingCents: offer.shippingCents,
    procurementCents: 0,
    importCents: 0,
    riskPercent: 5,
    markupPercent: 25,
    stockQty: offer.stockQty,
    stockKnown: offer.stockQty != null,
    fresh: true,
    checkedAt: offer.checkedAt.toISOString(),
    reputable: offer.sourceType !== "OTHER",
  }));
  return { catalogue, supplierFeeds: [], supplierApis: [], external: externalCandidates };
}

async function urbanFocusCatalogue(workspaceId: string, requirements: ProductRequirement[], now: Date): Promise<SourcingCandidate[]> {
  const queries = urbanFocusSearchQueries(requirements);
  if (queries.length === 0) return [];
  const loaded = await loadStoreProvider(workspaceId);
  if (!loaded) throw new UrbanFocusCatalogueError("The Urban Focus catalogue connection is not available. The request was held and was not quoted from another source.");
  const seen = new Set<string>();
  const candidates: SourcingCandidate[] = [];
  for (const query of queries) {
    const read = await readStoreCatalogueQuery(() => loaded.provider.searchCatalogue(query));
    if (read.hold !== null) throw new UrbanFocusCatalogueError(read.hold);
    for (const product of relevantStoreProducts(read.products, query)) {
      if (!product.published || seen.has(product.storeProductId)) continue;
      seen.add(product.storeProductId);
      candidates.push(urbanFocusCandidate(product, now.toISOString()));
    }
  }
  return candidates.slice(0, 80);
}


async function rememberAlternativeQuote(rfq: { id: string; lines: { id: string }[]; quotes: { id: string; status: string }[] }, matches: { productId: string | null; name: string; sku: string; unitPriceCents: number | null; method: string }[], workspaceId: string, quantity: number, confidence: number) {
  const db = getDb();
  const usable = matches.filter((match) => match.unitPriceCents != null && match.unitPriceCents > 0);
  if (usable.length === 0) return;
  let draft = rfq.quotes.find((quote) => quote.status === "DRAFT");
  if (!draft) draft = await db.quote.create({ data: { workspaceId, rfqId: rfq.id, confidenceScore: confidence, notes: "" } });
  else await db.quote.update({ where: { id: draft.id }, data: { confidenceScore: confidence } });
  for (const match of usable) {
    await db.quoteLine.create({
      data: {
        workspaceId,
        quoteId: draft.id,
        productId: match.productId,
        description: `Alternative: ${match.name}`,
        sku: match.sku,
        quantity: new Prisma.Decimal(quantity.toFixed(2)),
        unitPriceCents: match.unitPriceCents ?? 0,
        matchGrade: match.method,
        costStatus: "VERIFIED",
      },
    });
  }
  const line = rfq.lines[0];
  const first = usable[0];
  if (line && first?.productId) {
    await db.rfqLine.update({
      where: { id: line.id },
      data: { productId: first.productId, sourcedName: first.name, matchStatus: "MATCHED", matchGrade: first.method, matchNote: "Closest available alternative." },
    });
  }
}

async function storeParsedRequirements(rfq: { id: string; lines: { id: string; specifications: string }[] }, requirements: ProductRequirement[], workspaceId: string, options?: { authoritative?: boolean }) {
  const useful = requirements.filter((requirement) => requirementSummary(requirement) || requirement.productType);
  if (useful.length === 0) return;
  const db = getDb();
  if (options?.authoritative && rfq.lines.length > useful.length) {
    const extra = rfq.lines.slice(useful.length);
    await db.rfqLine.deleteMany({ where: { id: { in: extra.map((line) => line.id) } } });
    rfq.lines.splice(useful.length);
  }
  for (const [index, requirement] of useful.entries()) {
    const summary = requirementSummary(requirement) || requirement.productType;
    const quantity = requirement.quantity == null ? null : new Prisma.Decimal(requirement.quantity.toFixed(2));
    const specifications = (requirement.requestedText || summary).slice(0, 800);
    const line = rfq.lines[index];
    if (!line) {
      const created = await db.rfqLine.create({
        data: {
          workspaceId,
          rfqId: rfq.id,
          description: summary,
          specifications,
          quantity,
          manufacturer: requirement.brandPreference,
          modelName: requirement.model,
          sku: requirement.sku,
          manufacturerPartNumber: requirement.mpn,
        },
      });
      rfq.lines.push({ id: created.id, specifications: summary });
      continue;
    }
    await db.rfqLine.update({
      where: { id: line.id },
      data: {
        description: summary,
        specifications,
        ...(quantity != null ? { quantity } : {}),
        ...(requirement.model ? { modelName: requirement.model } : {}),
        ...(requirement.sku ? { sku: requirement.sku } : {}),
        ...(requirement.mpn ? { manufacturerPartNumber: requirement.mpn } : {}),
      },
    });
    line.specifications = summary;
  }
}

function processingStore(workspaceId: string, messageId: string): ProcessingStore {
  const db = getDb();
  return {
    async insert(row: ProcessingRow) {
      try {
        await db.inboundMessageProcessing.create({
          data: {
            workspaceId,
            messageId,
            gmailMessageId: row.gmailMessageId,
            threadId: row.threadId,
            processingStatus: row.processingStatus,
            decision: row.decision,
            autoReplyType: row.autoReplyType,
            quoteId: row.quoteId,
          },
        });
        return "inserted";
      } catch (error) {
        if (isUniqueViolation(error)) return "exists";
        throw error;
      }
    },
    async read(gmailMessageId) {
      const row = await db.inboundMessageProcessing.findUnique({ where: { gmailMessageId } });
      if (!row) return null;
      return {
        gmailMessageId: row.gmailMessageId,
        threadId: row.threadId,
        processingStatus: row.processingStatus as ProcessingRow["processingStatus"],
        decision: row.decision,
        autoReplyType: row.autoReplyType,
        autoReplySentAt: row.autoReplySentAt?.toISOString() ?? null,
        quoteId: row.quoteId,
        processedAt: row.processedAt?.toISOString() ?? null,
      };
    },
    async save(gmailMessageId, from, row) {
      const updated = await db.inboundMessageProcessing.updateMany({
        where: { gmailMessageId, processingStatus: from },
        data: {
          threadId: row.threadId,
          processingStatus: row.processingStatus,
          decision: row.decision,
          autoReplyType: row.autoReplyType,
          autoReplySentAt: row.autoReplySentAt ? new Date(row.autoReplySentAt) : null,
          quoteId: row.quoteId,
          processedAt: row.processedAt ? new Date(row.processedAt) : null,
        },
      });
      return updated.count === 1;
    },
  };
}

async function rfqForThread(workspaceId: string, threadId: string | null, messageId: string) {
  const db = getDb();
  if (threadId) {
    const byThread = await db.rfq.findFirst({
      where: { workspaceId, threadId },
      include: { lines: true, quotes: true },
    });
    if (byThread) return byThread;
  }
  const direct = await db.rfq.findFirst({
    where: { workspaceId, sourceMessageId: messageId },
    include: { lines: true, quotes: true },
  });
  if (direct) return direct;
  if (!threadId) return null;
  const ids = await db.message.findMany({ where: { workspaceId, threadId }, select: { id: true } });
  if (ids.length === 0) return null;
  return db.rfq.findFirst({
    where: { workspaceId, sourceMessageId: { in: ids.map((item) => item.id) } },
    include: { lines: true, quotes: true },
  });
}

function replySubject(subject: string) {
  return subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject || "Your enquiry"}`;
}

function inboxCategory(kind: InboundKind) {
  if (kind === "RFQ") return "RFQ" as const;
  if (kind === "PRICE_ENQUIRY" || kind === "PRICE_NEGOTIATION") return "PRICING_REQUEST" as const;
  if (kind === "STOCK_ENQUIRY") return "PRODUCT_ENQUIRY" as const;
  if (kind === "ORDER_OR_PO" || kind === "QUOTE_ACCEPTED") return "ORDER_ENQUIRY" as const;
  if (kind === "GENERAL_ENQUIRY") return "NEW_ENQUIRY" as const;
  if (kind === "CAMPAIGN_REPLY") return "CAMPAIGN_REPLY" as const;
  return "OTHER" as const;
}
