import { Prisma } from "../generated/prisma/client";
import { createHash } from "node:crypto";
import {
  canAutoSend,
  classifyCustomerReply,
  classifyInbound,
  currentCustomerText,
  extractRfqRequest,
  factualReply,
  groundAiRfqExtraction,
  isQuotationRequest,
  matchRfqLine,
  mergeRfqExtraction,
  priceQuotation,
  type CatalogueHit,
  type InboundKind,
  type PriceDecision,
} from "../lib/automation";
import { nameKey } from "../lib/automation";
import { barcodeKey, brandModelKey, mpnKey, skuKey } from "../lib/catalogue-reconcile";
import { getDb, isUniqueViolation } from "../lib/db";
import { AppError } from "../lib/errors";
import { classFromScorecard, SCORECARD_FIELD_SELECT, supplierClassRank } from "../lib/supplier-scorecard";
import { recordActivity } from "./activity-service";
import { extractQuotationFields } from "./ai-service";
import { sendQuote } from "./quote-service";
import { sendCustomerResponse } from "./reply-service";
import { catalogueCommercialState, extractProductRequirements, planSourcing, QUANTITY_CLARIFICATION, requirementAwaitingQuantity, requirementSummary, requirementsFromSources, type SourcingCandidate, type SourcingPools } from "../lib/sourcing";
import { sourceExternalForRequirements } from "./external-sourcing-service";
import { enquiryFromRequest, openSourcingTask, recordFunnel, recordReplyStage, responseForRequirement, stopQuoteFollowUp, unpricedCatalogueNote } from "./sales-response-service";
import { analyseRfqDocuments, analysisTextForRfq, listTenderAnalyses, responseModeForRfq, saveAnalysisMatches } from "./document-analysis-service";
import { matchRequestedSpecification, UNPRICED_LINE, type AnalysisMatch } from "../lib/document-analysis";
import { determineInitialResponse, sendResponseOnce, customerResponseAllowed, type InitialResponse, type ProcessingRow, type ProcessingStore, type ResponseFacts } from "../lib/inbound-response";
import { asksToProceed, followUpChangesRequirements, requestStrictness } from "../lib/rfq-match";
import { retryDelayMs } from "../lib/quote-send";
import { analyzeInboundEmail, parseRfqAnalysis, type RfqAnalysis } from "../lib/ai/rfq-analyzer";
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
  const [mailbox, inbound, rfqs, acknowledgements, suppliers, products, store, scans] = await Promise.all([
    db.mailbox.findFirst({
      where: { workspaceId, provider: "GOOGLE" },
      select: { email: true, lastInboundSyncAt: true, lastError: true },
    }),
    db.message.count({ where: { workspaceId, direction: "INBOUND" } }),
    db.rfq.groupBy({ by: ["status"], where: { workspaceId }, _count: { _all: true } }),
    db.rfq.count({ where: { workspaceId, acknowledgementSentAt: { not: null } } }),
    db.supplier.findMany({
      where: { workspaceId },
      select: { id: true, name: true, lastStockSyncAt: true, lastPriceSyncAt: true, lastCatalogueSyncAt: true, lastStockSyncError: true, feedEnabled: true },
    }),
    db.product.groupBy({ by: ["reviewStatus"], where: { workspaceId }, _count: { _all: true } }),
    db.workspace.findFirst({
      where: { id: workspaceId },
      select: { storeLastSyncAt: true, storeLastError: true },
    }),
    db.catalogueAudit.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, action: true, summary: true, createdAt: true },
    }),
  ]);
  const statusCount = (status: string) => rfqs.find((row) => row.status === status)?._count._all ?? 0;
  const reviewCount = (status: string) => products.find((row) => row.reviewStatus === status)?._count._all ?? 0;
  return { mailbox, inbound, acknowledgements, suppliers, store, scans, statusCount, reviewCount, needsReplyReview: statusCount("NEGOTIATION") + statusCount("REVIEWING") };
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
  const kind = classifyInbound({ subject: message.subject, body: message.body, campaignReply: Boolean(message.campaignId) });
  await db.message.update({ where: { id: message.id }, data: { category: inboxCategory(kind) } });
  const existing = await rfqForThread(message.workspaceId, message.threadId, message.id);
  if (existing && message.threadId && existing.threadId !== message.threadId) {
    await db.rfq.update({ where: { id: existing.id }, data: { threadId: message.threadId } });
    existing.threadId = message.threadId;
  }
  if (existing) {
    const currentBody = currentCustomerText(message.body);
    const replyKind = classifyCustomerReply(currentBody);
    const quoteSent = existing.status === "QUOTE_SENT" || existing.status === "SENT" || existing.status === "WON" || existing.quotes.some((quote) => quote.status === "SENT");
    const specUpdate = followUpChangesRequirements(currentBody);
    const handledReply = replyKind === "QUOTE_ACCEPTED" || replyKind === "PURCHASE_ORDER" || replyKind === "NOT_INTERESTED" || replyKind === "PRICE_NEGOTIATION" || replyKind === "DELIVERY_QUESTION" || replyKind === "STOCK_QUESTION" || replyKind === "MORE_INFORMATION" || replyKind === "ALTERNATIVE_REQUEST" || asksToProceed(currentBody);
    if (quoteSent && !specUpdate && handledReply) {
      await handleQuoteReply(message, existing.id);
      return "reply";
    }
    if (!isQuotationRequest(classifyInbound({ subject: message.subject, body: currentBody, campaignReply: false }))) {
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
  const rfq = await createRfq(message, await analyzeInboundEmail({ subject: message.subject, body: message.body }));
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
  if (extracted.lines.length > 0) return extracted;
  if (analysis) {
    return mergeRfqExtraction(extracted, groundAiRfqExtraction({
      lines: analysis.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        manufacturer: item.brand,
        model: item.model,
        sku: item.sku,
        manufacturerPartNumber: item.mpn,
        specifications: item.specifications.join(", "),
      })),
    }, body));
  }
  try {
    const raw = await extractQuotationFields(body);
    if (!raw) return extracted;
    return mergeRfqExtraction(extracted, groundAiRfqExtraction(raw, body));
  } catch {
    return extracted;
  }
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
        matches.push({ lineNumber: item.lineNumber, match: "NO MATCH", explanation: "No catalogue or supplier product meets this line.", productId: null, productName: "", sku: "", sourceKind: "", sourceName: "", sourceUrl: "", observedPriceCents: null, vatIncluded: false, availability: "", observedAt, pricedFromSupplier: false, ...UNPRICED_LINE });
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
  const analysis = await rememberAiInterpretation(rfq);
  const documentText = await analysisTextForRfq(rfq.id);
  const threadText = await inboundThreadText(rfq);
  const parsed = requirementsFromSources(threadText, documentText);
  const requirements = parsed.length > 0 ? parsed : requirementsForSourcing(threadText, analysis);
  await db.rfq.update({ where: { id: rfq.id }, data: { status: "PARSING" } });
  await recordRfqEvent(workspace.id, rfq.id, "EMAIL_RECEIVED", "PARSING", "Requirements are being read from the thread.");
  await storeParsedRequirement(rfq, requirements[0], workspace.id);
  const margins = {
    minimumMarginPercent: workspace.minimumMarginPercent,
    autoQuoteMarginPercent: workspace.autoQuoteMarginPercent,
    autoSendMarginPercent: workspace.autoSendMarginPercent,
  };
  let pools = await sourcingPools(workspace.id);
  const strictness = requirements[0] ? requestStrictness(requirements[0].requestedText, Boolean(requirements[0].sku || requirements[0].mpn || requirements[0].model)) : "";
  const requirementsHash = createHash("sha256").update(requirements.map((requirement) => requirement.requestedText).join("\n")).digest("hex").slice(0, 16);
  await db.rfq.update({ where: { id: rfq.id }, data: { status: "MATCHING", strictness, requirementsHash } });
  await recordRfqEvent(workspace.id, rfq.id, "REQUIREMENTS_PARSED", "MATCHING", strictness || "No structured requirement.");
  let plan = planSourcing({ requirements, pools, ...margins });
  if (plan.kind === "SOURCING") {
    const live = await sourceExternalForRequirements(workspace.id, requirements);
    if (live.candidates.length > 0) {
      pools = { ...pools, external: [...pools.external, ...live.candidates] };
      plan = planSourcing({ requirements, pools, ...margins });
    }
    if (plan.kind === "SOURCING") plan = { ...plan, note: live.note };
  }
  if (requirementAwaitingQuantity(requirements[0]) && plan.kind === "SOURCING") {
    plan = { ...plan, message: QUANTITY_CLARIFICATION, note: "The specification was read. The quantity was not stated." };
  }
  if (plan.kind === "CLARIFICATION") {
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "NEEDS_CLARIFICATION", automationNote: plan.message } });
    await recordRfqEvent(workspace.id, rfq.id, "CLARIFICATION_SENT", "NEEDS_CLARIFICATION", plan.message);
    return respond({ planKind: "CLARIFICATION", planMessage: plan.message });
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
            matchNote: "Website catalogue. No supplier cost is on file.",
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
    if (sales?.action === "EXTERNAL_TASK") await openSourcingTask(workspace.id, rfq.id, requirement?.requestedText || rfq.subject);
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "SOURCING", automationNote: plan.note, quoteBlockedReason: plan.note } });
    await recordRfqEvent(workspace.id, rfq.id, "SOURCING_STARTED", "SOURCING", plan.note);
    return respond({ planKind: "SOURCING", planMessage: plan.message, salesAction: sales?.action === "EXTERNAL_TASK" ? "EXTERNAL_TASK" : "" });
  }
  if (plan.kind === "STAFF_REVIEW") {
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "REVIEWING", automationNote: plan.note } });
    return respond({ planKind: "STAFF_REVIEW" });
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
  if (rankedOptions.length > 1) {
    const alternativeNote = "These are alternative options. Choose one. The option totals are not added together.";
    await db.quote.update({ where: { id: draft.id }, data: { notes: [draft.notes, alternativeNote].filter(Boolean).join("\n") } });
  }
  for (const [index, option] of rankedOptions.entries()) {
    const tier = index === 0 ? "Value" : "Performance";
    await db.quoteLine.create({
      data: {
        workspaceId: workspace.id,
        quoteId: draft.id,
        productId: option.productId,
        description: rankedOptions.length > 1 ? `OPTION ${index + 1} – ${tier}: ${option.name}` : option.name,
        quantity: new Prisma.Decimal(option.quantity.toFixed(2)),
        unitPriceCents: option.unitPriceCents,
        specifications: option.specifications,
        sourceKind: option.sourceKind,
        sourceUrl: option.sourceUrl,
        sourceCheckedAt: option.checkedAt ? new Date(option.checkedAt) : null,
        matchGrade: option.match,
        costStatus: option.costStatus,
      },
    });
  }
  await db.rfq.update({ where: { id: rfq.id }, data: { status: "PRICED", lastPricedAt: new Date(), automationNote: plan.note } });
  await recordRfqEvent(workspace.id, rfq.id, "PRICED", "PRICED", plan.note);
  await generateQuotePdf(workspace.id, draft.id);
  await db.rfq.update({ where: { id: rfq.id }, data: { status: "QUOTE_READY", automationNote: plan.note } });
  await recordRfqEvent(workspace.id, rfq.id, "PDF_GENERATED", "QUOTE_READY", plan.note);
  if (requirementAwaitingQuantity(requirements[0])) {
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "NEEDS_CLARIFICATION", automationNote: QUANTITY_CLARIFICATION } });
    return respond({ planKind: "QUOTE", awaitingQuantity: true });
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

async function rememberAiInterpretation(rfq: { id: string; subject: string; description: string; enquiryJson: unknown; sourceMessage: { subject: string; body: string } | null }) {
  const stored = storedAnalysis(rfq.enquiryJson);
  if (stored) return stored;
  const analysis = await analyzeInboundEmail({
    subject: rfq.sourceMessage?.subject ?? rfq.subject,
    body: rfq.sourceMessage?.body || rfq.description,
  });
  if (!analysis) return null;
  const base = rfq.enquiryJson && typeof rfq.enquiryJson === "object" && !Array.isArray(rfq.enquiryJson) ? rfq.enquiryJson as Record<string, unknown> : {};
  await getDb().rfq.update({ where: { id: rfq.id }, data: { enquiryJson: { ...base, ai: analysis } } });
  return analysis;
}

function storedAnalysis(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return parseRfqAnalysis((value as Record<string, unknown>).ai);
}

export async function sourcingPools(workspaceId: string): Promise<SourcingPools> {
  const db = getDb();
  const now = Date.now();
  const freshAfter = new Date(now - 24 * 60 * 60 * 1000);
  const [products, offers, feedItems, external] = await Promise.all([
    db.product.findMany({ where: { workspaceId, active: true }, select: { id: true, sku: true, name: true, brand: true, manufacturerPartNumber: true, specifications: true, stockOnHand: true, unitPriceCents: true } }),
    db.supplierPrice.findMany({ where: { workspaceId }, include: { supplier: { select: { name: true, markupPercent: true, authType: true, priceSyncIntervalMinutes: true, scorecard: { select: SCORECARD_FIELD_SELECT } } } } }),
    db.supplierFeedItem.findMany({
      where: { workspaceId },
      include: { supplier: { select: { name: true, markupPercent: true, authType: true, priceSyncIntervalMinutes: true, leadTimeDays: true, scorecard: { select: SCORECARD_FIELD_SELECT } } } },
    }),
    db.externalSourceOffer.findMany({ where: { workspaceId, checkedAt: { gte: freshAfter }, sourceUrl: { not: "" } } }),
  ]);
  const bestOffer = new Map<string, (typeof offers)[number]>();
  for (const offer of offers) {
    if (!offer.costKnown || offer.costCents <= 0 || classFromScorecard(offer.supplier.scorecard) === "REJECT") continue;
    const current = bestOffer.get(offer.productId);
    const rank = current ? supplierClassRank(classFromScorecard(offer.supplier.scorecard)) - supplierClassRank(classFromScorecard(current.supplier.scorecard)) : -1;
    if (!current || rank < 0 || (rank === 0 && offer.costCents < current.costCents)) bestOffer.set(offer.productId, offer);
  }
  const catalogue: SourcingCandidate[] = products.map((product) => {
    const offer = bestOffer.get(product.id);
    const commercial = catalogueCommercialState({
      stockOnHand: product.stockOnHand,
      listedPriceCents: product.unitPriceCents,
      costCents: offer?.costCents ?? null,
      costKnown: offer?.costKnown ?? false,
      costUpdatedAt: offer?.updatedAt ?? null,
      nowMs: now,
    });
    return {
      sourceKind: "URBAN_FOCUS_CATALOGUE",
      sourceName: "Urban Focus",
      sourceUrl: "",
      sourceType: "INTERNAL",
      productId: product.id,
      name: product.name,
      brand: product.brand,
      model: product.manufacturerPartNumber,
      sku: product.sku,
      mpn: product.manufacturerPartNumber,
      specifications: product.specifications || product.name,
      costExVatCents: commercial.costExVatCents,
      listedPriceCents: commercial.listedPriceCents,
      vatIncluded: false,
      shippingCents: 0,
      procurementCents: 0,
      importCents: 0,
      riskPercent: 0,
      markupPercent: offer?.supplier.markupPercent ?? 0,
      stockQty: commercial.stockQty,
      stockKnown: commercial.stockKnown,
      fresh: commercial.fresh,
      checkedAt: offer?.updatedAt.toISOString() ?? null,
      reputable: true,
      supplierClass: offer ? classFromScorecard(offer.supplier.scorecard) : undefined,
    };
  });
  const supplierFeeds: SourcingCandidate[] = [];
  const supplierApis: SourcingCandidate[] = [];
  for (const offer of offers) {
    const fresh = now - offer.updatedAt.getTime() <= offer.supplier.priceSyncIntervalMinutes * 60 * 1000;
    const row: SourcingCandidate = {
      sourceKind: offer.supplier.authType === "NONE" ? "SUPPLIER_FEED" : "SUPPLIER_API",
      sourceName: offer.supplier.name,
      sourceUrl: "",
      sourceType: "DISTRIBUTOR",
      productId: offer.productId,
      name: offer.offerName || offer.supplierSku,
      brand: offer.brand,
      model: offer.manufacturerPartNumber,
      sku: offer.supplierSku,
      mpn: offer.manufacturerPartNumber,
      specifications: offer.specifications || offer.description || offer.offerName,
      costExVatCents: offer.costKnown ? offer.costCents : null,
      listedPriceCents: null,
      vatIncluded: false,
      shippingCents: 0,
      procurementCents: 0,
      importCents: 0,
      riskPercent: 0,
      markupPercent: offer.supplier.markupPercent,
      stockQty: offer.stockQty,
      stockKnown: offer.stockKnown,
      fresh,
      checkedAt: offer.updatedAt.toISOString(),
      reputable: true,
      supplierClass: classFromScorecard(offer.supplier.scorecard),
    };
    if (row.sourceKind === "SUPPLIER_API") supplierApis.push(row);
    else supplierFeeds.push(row);
  }
  const linked = new Set(offers.map((offer) => `${offer.supplierId}:${offer.productId}`));
  for (const item of feedItems) {
    if (item.productId && linked.has(`${item.supplierId}:${item.productId}`)) continue;
    const fresh = now - item.updatedAt.getTime() <= item.supplier.priceSyncIntervalMinutes * 60 * 1000;
    const row: SourcingCandidate = {
      sourceKind: item.supplier.authType === "NONE" ? "SUPPLIER_FEED" : "SUPPLIER_API",
      sourceName: item.supplier.name,
      sourceUrl: "",
      sourceType: "DISTRIBUTOR",
      productId: item.productId,
      name: item.name || item.supplierSku,
      brand: item.brand,
      model: item.manufacturerPartNumber,
      sku: item.supplierSku,
      mpn: item.manufacturerPartNumber,
      specifications: item.specifications || item.description || item.name,
      costExVatCents: item.costKnown ? item.costCents : null,
      listedPriceCents: null,
      vatIncluded: false,
      shippingCents: 0,
      procurementCents: 0,
      importCents: 0,
      riskPercent: 0,
      markupPercent: item.supplier.markupPercent,
      stockQty: item.stockKnown ? item.stockQty : null,
      stockKnown: item.stockKnown,
      fresh,
      checkedAt: item.updatedAt.toISOString(),
      reputable: true,
      supplierClass: classFromScorecard(item.supplier.scorecard),
    };
    if (row.sourceKind === "SUPPLIER_API") supplierApis.push(row);
    else supplierFeeds.push(row);
  }
  const storeItems = await db.storeCatalogueItem.findMany({
    where: { workspaceId, published: true },
    select: { productId: true, sku: true, name: true, brand: true, manufacturerPartNumber: true, specifications: true, description: true, stockQuantity: true, unitPriceCents: true },
  });
  const seenSkus = new Set(catalogue.map((item) => item.sku.toLowerCase()).filter(Boolean));
  const costBySku = new Map<string, { costCents: number; markupPercent: number; fresh: boolean }>();
  for (const offer of offers) {
    if (!offer.costKnown || offer.costCents <= 0 || !offer.supplierSku) continue;
    const fresh = now - offer.updatedAt.getTime() <= offer.supplier.priceSyncIntervalMinutes * 60 * 1000;
    const key = offer.supplierSku.toLowerCase();
    const current = costBySku.get(key);
    if (!current || (fresh && !current.fresh) || offer.costCents < current.costCents) costBySku.set(key, { costCents: offer.costCents, markupPercent: offer.supplier.markupPercent, fresh });
  }
  for (const item of storeItems) {
    const sku = item.sku.trim();
    if (!sku) continue;
    const existing = catalogue.find((entry) => entry.sku.toLowerCase() === sku.toLowerCase());
    if (existing) {
      if ((existing.listedPriceCents ?? 0) <= 0 && item.unitPriceCents > 0) existing.listedPriceCents = item.unitPriceCents;
      continue;
    }
    seenSkus.add(sku.toLowerCase());
    const cost = costBySku.get(sku.toLowerCase());
    catalogue.push({
      sourceKind: "URBAN_FOCUS_CATALOGUE",
      sourceName: "Urban Focus",
      sourceUrl: "",
      sourceType: "INTERNAL",
      productId: item.productId,
      name: item.name,
      brand: item.brand,
      model: item.manufacturerPartNumber,
      sku,
      mpn: item.manufacturerPartNumber,
      specifications: [item.specifications, item.description, item.name].filter(Boolean).join("\n"),
      costExVatCents: cost?.fresh ? cost.costCents : null,
      listedPriceCents: item.unitPriceCents > 0 ? item.unitPriceCents : null,
      vatIncluded: false,
      shippingCents: 0,
      procurementCents: 0,
      importCents: 0,
      riskPercent: 0,
      markupPercent: cost?.markupPercent ?? 0,
      stockQty: item.stockQuantity,
      stockKnown: true,
      fresh: item.stockQuantity > 0,
      checkedAt: null,
      reputable: true,
    });
  }
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
  return { catalogue, supplierFeeds, supplierApis, external: externalCandidates };
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

async function storeParsedRequirement(rfq: { id: string; lines: { id: string; specifications: string }[] }, requirement: Parameters<typeof requirementSummary>[0] | undefined, workspaceId: string) {
  const summary = requirement ? requirementSummary(requirement) : "";
  if (!summary) return;
  const db = getDb();
  const line = rfq.lines[0];
  if (!line) {
    const created = await db.rfqLine.create({
      data: {
        workspaceId,
        rfqId: rfq.id,
        description: summary,
        specifications: summary,
        quantity: requirement?.quantity == null ? null : new Prisma.Decimal(requirement.quantity.toFixed(2)),
      },
    });
    rfq.lines.unshift({ id: created.id, specifications: summary });
    return;
  }
  if (line.specifications !== summary) {
    await db.rfqLine.update({
      where: { id: line.id },
      data: {
        specifications: summary,
        description: summary,
        quantity: requirement?.quantity == null ? null : new Prisma.Decimal(requirement.quantity.toFixed(2)),
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

function reviewNote(decisions: PriceDecision[]) {
  if (decisions.includes("MARGIN_WARNING")) return "The margin is below the minimum, so the quotation was not created.";
  if (decisions.includes("STALE")) return "The supplier price or stock is not fresh, so the quotation was not created.";
  if (decisions.includes("STOCK_REVIEW")) return "Stock cannot cover the requested quantity, so the quotation was not created.";
  if (decisions.includes("PRICE_REVIEW")) return "The supplier price changed enough to need a review.";
  return "The quotation needs a review.";
}

async function catalogueHits(workspaceId: string): Promise<CatalogueHit[]> {
  const db = getDb();
  const scan = await db.storeCatalogueScan.findFirst({
    where: { workspaceId, status: "COMPLETE" },
    orderBy: { finishedAt: "desc" },
    select: { id: true },
  });
  const items = scan
    ? await db.storeCatalogueItem.findMany({
      where: { workspaceId, scanId: scan.id },
      select: { storeProductId: true, sku: true, skuKey: true, mpnKey: true, barcodeKey: true, brandModelKey: true, name: true, productId: true, specifications: true },
    })
    : [];
  const products = await db.product.findMany({
    where: { workspaceId },
    select: { id: true, sku: true, manufacturerPartNumber: true, barcode: true, brand: true, name: true, storeProductId: true, specifications: true },
  });
  const productBySku = new Map(products.map((product) => [skuKey(product.sku), product.id]));
  const specificationsByProduct = new Map(products.map((product) => [product.id, product.specifications]));
  const hits: CatalogueHit[] = items.map((item) => {
    const productId = item.productId ?? productBySku.get(item.skuKey) ?? null;
    return {
      id: item.storeProductId,
      productId,
      sku: item.sku,
      skuKey: item.skuKey,
      mpnKey: item.mpnKey,
      barcodeKey: item.barcodeKey,
      brandModelKey: item.brandModelKey,
      nameKey: nameKey(item.name),
      name: item.name,
      specifications: item.specifications || (productId ? specificationsByProduct.get(productId) ?? "" : ""),
    };
  });
  for (const product of products) {
    if (hits.some((hit) => hit.productId === product.id)) continue;
    hits.push({
      id: product.storeProductId ?? product.id,
      productId: product.id,
      sku: product.sku,
      skuKey: skuKey(product.sku),
      mpnKey: mpnKey(product.manufacturerPartNumber),
      barcodeKey: barcodeKey(product.barcode),
      brandModelKey: brandModelKey(product.brand, product.manufacturerPartNumber),
      nameKey: nameKey(product.name),
      name: product.name,
      specifications: product.specifications,
    });
  }
  return hits;
}

async function confirmedSupplierMap(workspaceId: string) {
  const links = await getDb().supplierPrice.findMany({
    where: { workspaceId, product: { storeProductId: { not: null } } },
    select: { supplierSku: true, product: { select: { storeProductId: true, id: true } } },
  });
  const confirmed = new Map<string, string>();
  for (const link of links) {
    const key = skuKey(link.supplierSku);
    if (key && link.product.storeProductId && !confirmed.has(key)) confirmed.set(key, link.product.storeProductId);
  }
  return confirmed;
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
