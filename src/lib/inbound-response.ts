import { ACKNOWLEDGEMENT } from "./automation";
import { QUANTITY_CLARIFICATION, SOURCING_REPLY } from "./sourcing";

export const INITIAL_DECISIONS = ["QUOTE_READY", "PRICING_PENDING", "SOURCING_REQUIRED", "NEEDS_CLARIFICATION", "NO_RESPONSE"] as const;
export type InitialDecision = (typeof INITIAL_DECISIONS)[number];
export const AUTO_REPLY_TYPES = ["QUOTATION", "PRICING_ACK", "SOURCING_ACK", "CLARIFICATION", "NONE"] as const;
export type AutoReplyType = (typeof AUTO_REPLY_TYPES)[number];

export type ResponseFacts = {
  quotationRequest: boolean;
  tenderPackage: boolean;
  planKind: "CLARIFICATION" | "SOURCING" | "STAFF_REVIEW" | "QUOTE" | "NONE";
  planSend: boolean;
  planMessage: string;
  salesAction: "" | "AUTO_SEND" | "CLARIFY" | "PREPARE" | "ALTERNATIVES" | "EXTERNAL_TASK";
  salesMessage: string;
  catalogueProductNamed: boolean;
  awaitingQuantity: boolean;
  documentBlocksAutoSend: boolean;
  notify: boolean;
};

export type InitialResponse = {
  decision: InitialDecision;
  autoReplyType: AutoReplyType;
  message: string;
};

export function customerResponseAllowed(input: { acknowledgementSent: boolean; decision: string }) {
  if (input.decision === "QUOTE_READY" || input.decision === "NEEDS_CLARIFICATION") return true;
  if (input.decision === "NO_RESPONSE") return false;
  return !input.acknowledgementSent;
}

const NONE: InitialResponse = { decision: "NO_RESPONSE", autoReplyType: "NONE", message: "" };

export function determineInitialResponse(facts: ResponseFacts): InitialResponse {
  if (!facts.notify || !facts.quotationRequest || facts.tenderPackage) return NONE;
  if (facts.planKind === "CLARIFICATION") return { decision: "NEEDS_CLARIFICATION", autoReplyType: "CLARIFICATION", message: facts.planMessage };
  if (facts.awaitingQuantity) return { decision: "NEEDS_CLARIFICATION", autoReplyType: "CLARIFICATION", message: QUANTITY_CLARIFICATION };
  if (facts.salesAction === "CLARIFY" && facts.salesMessage) return { decision: "NEEDS_CLARIFICATION", autoReplyType: "CLARIFICATION", message: facts.salesMessage };
  if (facts.planKind === "QUOTE" && facts.planSend && facts.salesAction === "AUTO_SEND" && !facts.documentBlocksAutoSend) {
    return { decision: "QUOTE_READY", autoReplyType: "QUOTATION", message: "" };
  }
  if (facts.salesAction === "ALTERNATIVES" && facts.salesMessage) {
    return { decision: "PRICING_PENDING", autoReplyType: "PRICING_ACK", message: facts.salesMessage };
  }
  if (facts.planKind === "SOURCING" && !facts.catalogueProductNamed) {
    return { decision: "SOURCING_REQUIRED", autoReplyType: "SOURCING_ACK", message: facts.planMessage || SOURCING_REPLY };
  }
  if (facts.planKind === "QUOTE" || facts.planKind === "STAFF_REVIEW" || facts.catalogueProductNamed || facts.documentBlocksAutoSend) {
    return { decision: "PRICING_PENDING", autoReplyType: "PRICING_ACK", message: ACKNOWLEDGEMENT };
  }
  return NONE;
}

export type ProcessingStatus = "CLAIMED" | "SENT" | "SKIPPED" | "FAILED";

export type ProcessingRow = {
  gmailMessageId: string;
  threadId: string;
  processingStatus: ProcessingStatus;
  decision: string;
  autoReplyType: string;
  autoReplySentAt: string | null;
  quoteId: string;
  processedAt: string | null;
};

export type ProcessingStore = {
  insert(row: ProcessingRow): Promise<"inserted" | "exists">;
  read(gmailMessageId: string): Promise<ProcessingRow | null>;
  save(gmailMessageId: string, from: ProcessingStatus, row: ProcessingRow): Promise<boolean>;
};

export async function sendResponseOnce(input: {
  gmailMessageId: string;
  threadId: string;
  response: InitialResponse;
  quoteId?: string;
  store: ProcessingStore;
  send: () => Promise<void>;
  log?: (line: string) => void;
  now?: () => string;
}) {
  const log = input.log ?? ((line: string) => console.info(line));
  const now = input.now ?? (() => new Date().toISOString());
  const quoteId = input.quoteId ?? "";
  log(`[RFQ] messageId=${input.gmailMessageId} decision=${input.response.decision}`);
  const claimed = await claimResponse(input.store, {
    gmailMessageId: input.gmailMessageId,
    threadId: input.threadId,
    decision: input.response.decision,
    autoReplyType: input.response.autoReplyType,
    quoteId,
  });
  if (!claimed) {
    const existing = await input.store.read(input.gmailMessageId);
    log(`[RFQ] messageId=${input.gmailMessageId} response blocked: already replied`);
    return { sent: false, blocked: true, finished: existing?.processingStatus === "SENT" || existing?.processingStatus === "SKIPPED" };
  }
  if (input.response.decision === "NO_RESPONSE" || input.response.autoReplyType === "NONE") {
    await input.store.save(input.gmailMessageId, "CLAIMED", {
      gmailMessageId: input.gmailMessageId,
      threadId: input.threadId,
      processingStatus: "SKIPPED",
      decision: input.response.decision,
      autoReplyType: "NONE",
      autoReplySentAt: null,
      quoteId,
      processedAt: now(),
    });
    log(`[RFQ] messageId=${input.gmailMessageId} response=NONE sent=false`);
    return { sent: false, blocked: false, finished: true };
  }
  try {
    await input.send();
    const sentAt = now();
    await input.store.save(input.gmailMessageId, "CLAIMED", {
      gmailMessageId: input.gmailMessageId,
      threadId: input.threadId,
      processingStatus: "SENT",
      decision: input.response.decision,
      autoReplyType: input.response.autoReplyType,
      autoReplySentAt: sentAt,
      quoteId,
      processedAt: sentAt,
    });
    log(`[RFQ] messageId=${input.gmailMessageId} response=${input.response.autoReplyType} sent=true`);
    return { sent: true, blocked: false, finished: true };
  } catch (error) {
    await input.store.save(input.gmailMessageId, "CLAIMED", {
      gmailMessageId: input.gmailMessageId,
      threadId: input.threadId,
      processingStatus: "FAILED",
      decision: input.response.decision,
      autoReplyType: input.response.autoReplyType,
      autoReplySentAt: null,
      quoteId,
      processedAt: null,
    });
    throw error;
  }
}

export async function claimResponse(store: ProcessingStore, input: { gmailMessageId: string; threadId: string; decision: string; autoReplyType: string; quoteId: string }) {
  const row: ProcessingRow = {
    gmailMessageId: input.gmailMessageId,
    threadId: input.threadId,
    processingStatus: "CLAIMED",
    decision: input.decision,
    autoReplyType: input.autoReplyType,
    autoReplySentAt: null,
    quoteId: input.quoteId,
    processedAt: null,
  };
  const inserted = await store.insert(row);
  if (inserted === "inserted") return true;
  const existing = await store.read(input.gmailMessageId);
  if (existing?.processingStatus === "FAILED") return store.save(input.gmailMessageId, "FAILED", row);
  return false;
}

export function memoryProcessingStore(): ProcessingStore & { rows: Map<string, ProcessingRow> } {
  const rows = new Map<string, ProcessingRow>();
  let tail = Promise.resolve();
  return {
    rows,
    async insert(row) {
      const run = tail.then(() => {
        if (rows.has(row.gmailMessageId)) return "exists" as const;
        rows.set(row.gmailMessageId, { ...row });
        return "inserted" as const;
      });
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
    async read(gmailMessageId) {
      const row = rows.get(gmailMessageId);
      return row ? { ...row } : null;
    },
    async save(gmailMessageId, from, row) {
      const current = rows.get(gmailMessageId);
      if (!current || current.processingStatus !== from) return false;
      rows.set(gmailMessageId, { ...row });
      return true;
    },
  };
}
