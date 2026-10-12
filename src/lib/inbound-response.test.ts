import assert from "node:assert/strict";
import test from "node:test";
import { ACKNOWLEDGEMENT, classifyInbound, isQuotationRequest } from "./automation";
import { autoRfqRepliesEnabled, determineInitialResponse, inboundIsHistorical, memoryProcessingStore, sendResponseOnce, sendsGenericRfqAcknowledgement, suppressAutomaticReply, threadCustomerAction, customerResponseAllowed, type InitialResponse, type ResponseFacts } from "./inbound-response";
import { asksToProceed } from "./rfq-match";
import { CLARIFICATION_REPLY, SOURCING_REPLY } from "./sourcing";

const facts = (overrides: Partial<ResponseFacts>): ResponseFacts => ({
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
  notify: true,
  ...overrides,
});

async function deliver(gmailMessageId: string, response: InitialResponse, store = memoryProcessingStore(), repliesEnabled?: boolean) {
  const sent: string[] = [];
  const logs: string[] = [];
  const result = await sendResponseOnce({
    gmailMessageId,
    threadId: "thread-1",
    response,
    store,
    repliesEnabled,
    log: (line) => logs.push(line),
    send: async () => {
      sent.push(response.autoReplyType === "QUOTATION" ? "QUOTATION" : response.message);
    },
  });
  return { sent, logs, result, store };
}

test("a verified quotation is the only automatic customer email", async () => {
  const response = determineInitialResponse(facts({ planKind: "QUOTE", planSend: true, salesAction: "AUTO_SEND", catalogueProductNamed: true }));
  assert.equal(response.decision, "QUOTE_READY");
  const delivery = await deliver("gmail-known", response, memoryProcessingStore(), true);
  assert.deepEqual(delivery.sent, ["QUOTATION"]);
  assert.equal(delivery.sent.includes(ACKNOWLEDGEMENT), false);
  assert.equal(delivery.sent.includes(SOURCING_REPLY), false);
});

test("an unsourced request is held for staff and is not acknowledged", async () => {
  const response = determineInitialResponse(facts({ planKind: "SOURCING", planMessage: SOURCING_REPLY, salesAction: "EXTERNAL_TASK" }));
  assert.equal(response.decision, "NO_RESPONSE");
  assert.equal(response.message, "");
  const delivery = await deliver("gmail-unknown", response, memoryProcessingStore(), true);
  assert.deepEqual(delivery.sent, []);
});

test("a priced draft without permission to send is not emailed", async () => {
  const response = determineInitialResponse(facts({ planKind: "QUOTE", planSend: false, catalogueProductNamed: true, planMessage: SOURCING_REPLY }));
  assert.equal(response.decision, "NO_RESPONSE");
  const delivery = await deliver("gmail-specs", response, memoryProcessingStore(), true);
  assert.deepEqual(delivery.sent, []);
});

test("incomplete specifications are not emailed to the customer", async () => {
  const response = determineInitialResponse(facts({ planKind: "CLARIFICATION", planMessage: CLARIFICATION_REPLY }));
  assert.equal(response.decision, "NO_RESPONSE");
  const delivery = await deliver("gmail-incomplete", response, memoryProcessingStore(), true);
  assert.deepEqual(delivery.sent, []);
});

test("the same Gmail message processed twice sends one response", async () => {
  const response = determineInitialResponse(facts({ planKind: "QUOTE", planSend: true, salesAction: "AUTO_SEND" }));
  const store = memoryProcessingStore();
  const first = await deliver("gmail-twice", response, store, true);
  const second = await deliver("gmail-twice", response, store, true);
  assert.deepEqual(first.sent, ["QUOTATION"]);
  assert.deepEqual(second.sent, []);
  assert.equal(second.result.blocked, true);
  assert.match(second.logs.join("\n"), /response blocked: already replied/);
});

test("two workers processing the same message send one response", async () => {
  const response = determineInitialResponse(facts({ planKind: "QUOTE", planSend: true, salesAction: "AUTO_SEND" }));
  const store = memoryProcessingStore();
  const sent: string[] = [];
  const run = () => sendResponseOnce({
    gmailMessageId: "gmail-concurrent",
    threadId: "thread-1",
    response,
    repliesEnabled: true,
    store,
    send: async () => {
      await Promise.resolve();
      sent.push("QUOTATION");
    },
  });
  const [left, right] = await Promise.all([run(), run()]);
  assert.equal(sent.length, 1);
  assert.equal(left.sent !== right.sent, true);
  assert.equal(left.blocked || right.blocked, true);
});

test("a Gmail sync retry after successful processing does not send again", async () => {
  const response = determineInitialResponse(facts({ planKind: "QUOTE", planSend: true, salesAction: "AUTO_SEND" }));
  const store = memoryProcessingStore();
  const first = await deliver("gmail-retry", response, store, true);
  assert.equal(store.rows.get("gmail-retry")?.processingStatus, "SENT");
  const retry = await deliver("gmail-retry", response, store, true);
  assert.deepEqual(first.sent, ["QUOTATION"]);
  assert.deepEqual(retry.sent, []);
  assert.equal(retry.result.blocked, true);
  assert.equal(retry.result.finished, true);
});

test("a follow-up does not send a second acknowledgement or sourcing email", () => {
  assert.equal(customerResponseAllowed({ acknowledgementSent: true, decision: "SOURCING_REQUIRED" }), false);
  assert.equal(customerResponseAllowed({ acknowledgementSent: true, decision: "QUOTE_READY" }), true);
  assert.equal(customerResponseAllowed({ acknowledgementSent: false, decision: "SOURCING_REQUIRED" }), true);
});

test("a purchase order or proceed note does not get a new RFQ acknowledgement", () => {
  const freshPo = classifyInbound({ subject: "Purchase order", body: "Please find attached our PO.", campaignReply: false });
  assert.equal(freshPo, "ORDER_OR_PO");
  assert.equal(isQuotationRequest(freshPo), false);
  assert.equal(sendsGenericRfqAcknowledgement("no-response"), false);
  const poAfterQuote = threadCustomerAction({ kind: freshPo, quoteSent: true, currentText: "Please find attached our PO." });
  assert.equal(poAfterQuote, "quote-reply");
  assert.equal(sendsGenericRfqAcknowledgement(poAfterQuote), false);
  const proceed = "Please proceed.";
  assert.equal(asksToProceed(proceed), true);
  const proceedAfterQuote = threadCustomerAction({ kind: "OTHER", quoteSent: true, currentText: proceed });
  assert.equal(proceedAfterQuote, "quote-reply");
  assert.equal(sendsGenericRfqAcknowledgement(proceedAfterQuote), false);
  const proceedWithoutQuote = threadCustomerAction({ kind: classifyInbound({ subject: "Re: Quotation", body: proceed, campaignReply: false }), quoteSent: false, currentText: proceed });
  assert.equal(proceedWithoutQuote, "no-response");
  assert.equal(sendsGenericRfqAcknowledgement(proceedWithoutQuote), false);
});

test("automatic customer mail stays off until it is explicitly enabled", async () => {
  assert.equal(autoRfqRepliesEnabled({}), false);
  assert.equal(autoRfqRepliesEnabled({ AUTO_RFQ_REPLIES_ENABLED: "true" }), true);
  assert.equal(autoRfqRepliesEnabled({ AUTO_RFQ_REPLIES_ENABLED: "false" }), false);
  const quotation = determineInitialResponse(facts({ planKind: "QUOTE", planSend: true, salesAction: "AUTO_SEND" }));
  const clarification = determineInitialResponse(facts({ planKind: "CLARIFICATION", planMessage: CLARIFICATION_REPLY }));
  assert.equal(clarification.decision, "NO_RESPONSE");
  assert.equal(suppressAutomaticReply(quotation, false).decision, "NO_RESPONSE");
  const quote = await deliver("gmail-flag-quote", quotation, memoryProcessingStore(), false);
  assert.deepEqual(quote.sent, []);
  assert.equal(quote.logs.some((line) => line.includes("automatic replies disabled")), true);
  assert.equal(inboundIsHistorical({ receivedAt: new Date("2026-10-01T00:00:00.000Z"), cutoff: "2026-10-12T00:00:00.000Z" }), true);
  assert.equal(inboundIsHistorical({ receivedAt: new Date("2026-10-13T00:00:00.000Z"), cutoff: "2026-10-12T00:00:00.000Z" }), false);
  assert.equal(inboundIsHistorical({ receivedAt: new Date("2026-01-01T00:00:00.000Z"), cutoff: "" }), false);
});
