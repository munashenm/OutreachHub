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
import { extractProductRequirements, planSourcing, type SourcingCandidate, type SourcingPools } from "../lib/sourcing";

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
  const requirements = extractProductRequirements(`${rfq.sourceMessage?.subject ?? rfq.subject}\n${rfq.sourceMessage?.body || rfq.description}`);
  const plan = planSourcing({
    requirements,
    pools: await sourcingPools(workspace.id),
    minimumMarginPercent: workspace.minimumMarginPercent,
    autoQuoteMarginPercent: workspace.autoQuoteMarginPercent,
    autoSendMarginPercent: workspace.autoSendMarginPercent,
  });
  if (plan.kind === "CLARIFICATION") {
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "NEEDS_INFORMATION", automationNote: plan.message } });
    await sendSourcingReply(rfq, plan.message);
    return;
  }
  if (plan.kind === "SOURCING") {
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "SOURCING", automationNote: plan.note } });
    await sendSourcingReply(rfq, plan.message);
    return;
  }
  if (plan.kind === "STAFF_REVIEW") {
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "REVIEWING", automationNote: plan.note } });
    return;
  }
  const recommended = plan.options[0];
  if (recommended && rfq.lines[0]) {
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
    draft = await db.quote.create({ data: { workspaceId: workspace.id, rfqId: rfq.id, notes: rfq.customerReference ? `Customer reference ${rfq.customerReference}` : "" } });
    for (const [index, option] of plan.options.entries()) {
      await db.quoteLine.create({
        data: {
          workspaceId: workspace.id,
          quoteId: draft.id,
          productId: option.productId,
          description: plan.options.length > 1 ? `Option ${index + 1} — ${option.role}: ${option.name}` : option.name,
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
  }
  if (!plan.send) {
    await db.rfq.update({ where: { id: rfq.id }, data: { status: "READY_TO_QUOTE", automationNote: plan.note } });
    return;
  }
  await sendQuote({ userId: "system", workspaceId: workspace.id }, rfq.id, { validDays: 14, notes: draft.notes });
}

async function sourcingPools(workspaceId: string): Promise<SourcingPools> {
  const db = getDb();
  const now = Date.now();
  const freshAfter = new Date(now - 24 * 60 * 60 * 1000);
  const [products, offers, external] = await Promise.all([
    db.product.findMany({ where: { workspaceId, active: true }, select: { id: true, sku: true, name: true, brand: true, manufacturerPartNumber: true, specifications: true, stockOnHand: true } }),
    db.supplierPrice.findMany({ where: { workspaceId }, include: { supplier: { select: { name: true, markupPercent: true, authType: true, priceSyncIntervalMinutes: true } } } }),
    db.externalSourceOffer.findMany({ where: { workspaceId, checkedAt: { gte: freshAfter }, sourceUrl: { not: "" } } }),
  ]);
  const bestOffer = new Map<string, (typeof offers)[number]>();
  for (const offer of offers) {
    if (!offer.costKnown || offer.costCents <= 0) continue;
    const current = bestOffer.get(offer.productId);
    if (!current || offer.costCents < current.costCents) bestOffer.set(offer.productId, offer);
  }
  const catalogue: SourcingCandidate[] = products.map((product) => {
    const offer = bestOffer.get(product.id);
    const fresh = offer ? now - offer.updatedAt.getTime() <= offer.supplier.priceSyncIntervalMinutes * 60 * 1000 : false;
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
      costExVatCents: offer?.costCents ?? null,
      listedPriceCents: null,
      vatIncluded: false,
      shippingCents: 0,
      procurementCents: 0,
      importCents: 0,
      riskPercent: 0,
      markupPercent: offer?.supplier.markupPercent ?? 0,
      stockQty: offer?.stockKnown ? offer.stockQty : product.stockOnHand,
      stockKnown: offer ? offer.stockKnown : true,
      fresh: offer ? fresh : product.stockOnHand > 0,
      checkedAt: offer?.updatedAt.toISOString() ?? null,
      reputable: true,
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
    };
    if (row.sourceKind === "SUPPLIER_API") supplierApis.push(row);
    else supplierFeeds.push(row);
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

async function sendSourcingReply(rfq: { workspaceId: string; sourceMessageId: string; subject: string; automationNote: string; sourceMessage: { fromEmail: string | null } }, message: string) {
  if (!rfq.sourceMessage.fromEmail || rfq.automationNote === message) return;
  await sendThreadReply(
    { userId: "system", workspaceId: rfq.workspaceId },
    { messageId: rfq.sourceMessageId, to: rfq.sourceMessage.fromEmail, cc: "", subject: replySubject(rfq.subject), body: message },
  );
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
