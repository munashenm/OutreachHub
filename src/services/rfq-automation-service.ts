import { Prisma } from "../generated/prisma/client";
import {
  ACKNOWLEDGEMENT,
  canAutoSend,
  classifyCustomerReply,
  classifyInbound,
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
import { chooseSupplierOffer, priceChangeNeedsApproval } from "../lib/supplier-connector";
import { recordActivity } from "./activity-service";
import { extractQuotationFields } from "./ai-service";
import { sendQuote } from "./quote-service";
import { sendThreadReply } from "./reply-service";

const BATCH = 15;

export async function processInboundAutomation() {
  const messages = await getDb().message.findMany({
    where: { direction: "INBOUND", automationAt: null, ignored: false },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });
  const results: { messageId: string; action?: string; error?: string }[] = [];
  for (const message of messages) {
    try {
      results.push({ messageId: message.id, action: await processInboundMessage(message.id) });
    } catch (error) {
      results.push({ messageId: message.id, error: error instanceof AppError ? error.message : "The message could not be processed." });
    }
  }
  return { processed: results.filter((result) => !result.error).length, failed: results.filter((result) => result.error).length, results };
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
  if (existing && (existing.status === "QUOTE_SENT" || existing.status === "NEGOTIATION" || existing.quotes.some((quote) => quote.status === "SENT"))) {
    await handleQuoteReply(message, existing.id);
    return "reply";
  }
  if (!isQuotationRequest(kind)) {
    await db.message.update({ where: { id: message.id }, data: { automationAt: new Date() } });
    return kind;
  }
  const rfq = existing ?? await createRfq(message);
  if (!rfq.acknowledgementSentAt && message.fromEmail) {
    await sendThreadReply(
      { userId: "system", workspaceId: message.workspaceId },
      { messageId: message.id, to: message.fromEmail, cc: "", subject: replySubject(message.subject), body: ACKNOWLEDGEMENT },
    );
    await db.rfq.update({ where: { id: rfq.id }, data: { acknowledgementSentAt: new Date() } });
  }
  await quoteRfq(rfq.id, workspace);
  await db.message.update({ where: { id: message.id }, data: { automationAt: new Date() } });
  return "rfq";
}

async function handleQuoteReply(message: { id: string; workspaceId: string; body: string; subject: string; fromEmail: string | null }, rfqId: string) {
  const db = getDb();
  const kind = classifyCustomerReply(`${message.subject}\n${message.body}`);
  const rfq = await db.rfq.findFirst({
    where: { id: rfqId, workspaceId: message.workspaceId },
    include: { quotes: { where: { status: "SENT" }, include: { lines: { include: { product: true } } }, orderBy: { sentAt: "desc" }, take: 1 } },
  });
  if (!rfq) return;
  if (kind === "QUOTE_ACCEPTED" || kind === "PURCHASE_ORDER") {
    if (rfq.status !== "WON") {
      await db.rfq.update({ where: { id: rfq.id }, data: { status: "WON", automationNote: kind === "PURCHASE_ORDER" ? "Purchase order received. Credit terms were not changed." : "The customer accepted the quotation." } });
    }
  } else if (kind === "NOT_INTERESTED") {
    if (rfq.status !== "LOST") await db.rfq.update({ where: { id: rfq.id }, data: { status: "LOST", automationNote: "The customer is not interested." } });
  } else if (kind === "PRICE_NEGOTIATION" || kind === "ALTERNATIVE_REQUEST" || kind === "DELIVERY_QUESTION") {
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "NEGOTIATION", automationNote: "A suggested reply needs approval. The price, substitute, and delivery terms were not changed." } });
  } else {
    const quote = rfq.quotes[0];
    const line = quote?.lines[0];
    const reply = factualReply(kind, {
      stockQty: line?.product?.stockOnHand ?? null,
      validUntil: quote?.validUntil ? quote.validUntil.toISOString().slice(0, 10) : "",
      specifications: line?.specifications || line?.product?.specifications || "",
    });
    if (reply && message.fromEmail) {
      await sendThreadReply(
        { userId: "system", workspaceId: message.workspaceId },
        { messageId: message.id, to: message.fromEmail, cc: "", subject: replySubject(message.subject), body: reply },
      );
    } else {
      await db.rfq.update({ where: { id: rfq.id }, data: { automationNote: "The reply needs a person to answer it." } });
    }
  }
  await db.message.update({ where: { id: message.id }, data: { automationAt: new Date() } });
}

async function extractInboundRfq(body: string) {
  const extracted = extractRfqRequest(body);
  if (extracted.lines.length > 0) return extracted;
  try {
    const raw = await extractQuotationFields(body);
    if (!raw) return extracted;
    return mergeRfqExtraction(extracted, groundAiRfqExtraction(raw, body));
  } catch {
    return extracted;
  }
}

async function createRfq(message: { id: string; workspaceId: string; subject: string; body: string; fromEmail: string | null; fromName: string | null; prospectId: string | null }) {
  const extracted = await extractInboundRfq(message.body);
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
        prospectId: prospect?.id ?? null,
        companyId: prospect?.companyId ?? null,
        subject: message.subject || "Quotation request",
        description: message.body.slice(0, 8000),
        customerReference: extracted.reference,
        deliveryLocation: extracted.deliveryLocation,
        requiredDate: extracted.requiredDate,
        notes: [extracted.customerName, extracted.companyName].filter(Boolean).join(", "),
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
    return rfq;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await rfqForThread(message.workspaceId, null, message.id);
    if (!existing) throw error;
    return existing;
  }
}

async function quoteRfq(rfqId: string, workspace: { id: string; minimumMarginPercent: number; autoQuoteMarginPercent: number; autoSendMarginPercent: number }) {
  const db = getDb();
  const rfq = await db.rfq.findFirst({
    where: { id: rfqId, workspaceId: workspace.id },
    include: { lines: true, quotes: true, sourceMessage: true },
  });
  if (!rfq || rfq.quotes.some((quote) => quote.status === "SENT")) return;
  if (rfq.lines.length === 0 || rfq.lines.some((line) => line.quantity == null)) {
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "REVIEWING", automationNote: "A product or quantity was not stated, so no quotation was created." } });
    return;
  }
  const hits = await catalogueHits(workspace.id);
  const confirmed = await confirmedSupplierMap(workspace.id);
  const matches = [];
  for (const line of rfq.lines) {
    const match = matchRfqLine({
      sku: line.sku,
      manufacturerPartNumber: line.manufacturerPartNumber || line.modelName,
      manufacturer: line.manufacturer,
      model: line.modelName,
      description: line.description,
    }, hits, confirmed);
    matches.push({ line, match });
    await db.rfqLine.update({
      where: { id: line.id },
      data: { matchStatus: match.status, matchNote: match.reason, productId: match.productId, storeProductId: match.storeProductId },
    });
  }
  if (matches.some((item) => item.match.status !== "MATCHED" || !item.match.productId)) {
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "REVIEWING", automationNote: "A line needs a product review before a quotation can be created." } });
    return;
  }
  const productIds = matches.map((item) => item.match.productId).filter((id): id is string => Boolean(id));
  const offers = await db.supplierPrice.findMany({
    where: { workspaceId: workspace.id, productId: { in: productIds } },
    include: { supplier: { select: { markupPercent: true, preference: true, leadTimeDays: true, priceSyncIntervalMinutes: true } } },
  });
  const products = await db.product.findMany({ where: { workspaceId: workspace.id, id: { in: productIds } }, select: { id: true, unitPriceCents: true, specifications: true } });
  const now = new Date();
  const priced = matches.map((item) => {
    const rows = offers.filter((offer) => offer.productId === item.match.productId);
    const chosen = chooseSupplierOffer(rows.map((row) => ({
      supplierId: row.supplierId,
      costCents: row.costCents,
      costKnown: row.costKnown,
      stockQty: row.stockQty,
      stockKnown: row.stockKnown,
      updatedAt: row.updatedAt,
      preference: row.supplier.preference,
      leadTimeDays: row.leadTimeDays ?? row.supplier.leadTimeDays,
      priceFreshMs: row.supplier.priceSyncIntervalMinutes * 60 * 1000,
    })), Number(item.line.quantity), now);
    const source = chosen ? rows.find((row) => row.supplierId === chosen.supplierId) : null;
    const current = products.find((product) => product.id === item.match.productId)?.unitPriceCents ?? 0;
    const sellPreview = source && chosen?.costCents != null ? priceQuotation({
      costExVatCents: chosen.costCents,
      markupPercent: source.supplier.markupPercent,
      minimumMarginPercent: workspace.minimumMarginPercent,
      autoQuoteMarginPercent: workspace.autoQuoteMarginPercent,
      autoSendMarginPercent: workspace.autoSendMarginPercent,
      fresh: true,
      stockKnown: true,
      stockQty: chosen.stockQty,
      requestedQty: Number(item.line.quantity),
      abnormalPriceChange: false,
    }).sellExVatCents : null;
    const decision = priceQuotation({
      costExVatCents: chosen?.costCents ?? null,
      markupPercent: source?.supplier.markupPercent ?? 0,
      minimumMarginPercent: workspace.minimumMarginPercent,
      autoQuoteMarginPercent: workspace.autoQuoteMarginPercent,
      autoSendMarginPercent: workspace.autoSendMarginPercent,
      fresh: Boolean(chosen),
      stockKnown: Boolean(chosen),
      stockQty: chosen?.stockQty ?? null,
      requestedQty: Number(item.line.quantity),
      abnormalPriceChange: sellPreview != null && priceChangeNeedsApproval(current, sellPreview),
    });
    return { ...item, decision, specifications: products.find((product) => product.id === item.match.productId)?.specifications ?? "" };
  });
  const blocked = priced.some((item) => item.decision.decision === "STALE" || item.decision.decision === "STOCK_REVIEW" || item.decision.decision === "MARGIN_WARNING" || item.decision.decision === "PRICE_REVIEW");
  if (blocked || priced.some((item) => item.decision.sellExVatCents == null)) {
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "REVIEWING", automationNote: reviewNote(priced.map((item) => item.decision.decision)) } });
    return;
  }
  let draft = rfq.quotes.find((quote) => quote.status === "DRAFT");
  if (!draft) {
    draft = await db.quote.create({ data: { workspaceId: workspace.id, rfqId: rfq.id, notes: rfq.customerReference ? `Customer reference ${rfq.customerReference}` : "" } });
    for (const item of priced) {
      await db.quoteLine.create({
        data: {
          workspaceId: workspace.id,
          quoteId: draft.id,
          productId: item.match.productId,
          description: item.line.description,
          quantity: item.line.quantity ?? new Prisma.Decimal(0),
          unitPriceCents: item.decision.sellExVatCents ?? 0,
          specifications: item.specifications,
        },
      });
    }
  }
  const decisions = priced.map((item) => item.decision.decision);
  const autoSend = canAutoSend({
    decisions,
    matchesHighConfidence: true,
    specificationClear: priced.every((item) => item.line.description.trim().length >= 3),
    autoSendMarginMet: priced.every((item) => (item.decision.marginPercent ?? -1) >= workspace.autoSendMarginPercent),
  });
  if (!autoSend) {
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "READY_TO_QUOTE", automationNote: "The quotation is ready for approval." } });
    return;
  }
  await sendQuote({ userId: "system", workspaceId: workspace.id }, rfq.id, { validDays: 14, notes: draft.notes });
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
      select: { storeProductId: true, sku: true, skuKey: true, mpnKey: true, barcodeKey: true, brandModelKey: true, name: true, productId: true },
    })
    : [];
  const products = await db.product.findMany({
    where: { workspaceId },
    select: { id: true, sku: true, manufacturerPartNumber: true, barcode: true, brand: true, name: true, storeProductId: true },
  });
  const productBySku = new Map(products.map((product) => [skuKey(product.sku), product.id]));
  const hits: CatalogueHit[] = items.map((item) => ({
    id: item.storeProductId,
    productId: item.productId ?? productBySku.get(item.skuKey) ?? null,
    sku: item.sku,
    skuKey: item.skuKey,
    mpnKey: item.mpnKey,
    barcodeKey: item.barcodeKey,
    brandModelKey: item.brandModelKey,
    nameKey: nameKey(item.name),
    name: item.name,
  }));
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
