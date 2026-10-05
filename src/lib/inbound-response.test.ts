import assert from "node:assert/strict";
import test from "node:test";
import { ACKNOWLEDGEMENT } from "./automation";
import { determineInitialResponse, memoryProcessingStore, sendResponseOnce, type InitialResponse, type ResponseFacts } from "./inbound-response";
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

async function deliver(gmailMessageId: string, response: InitialResponse, store = memoryProcessingStore()) {
  const sent: string[] = [];
  const logs: string[] = [];
  const result = await sendResponseOnce({
    gmailMessageId,
    threadId: "thread-1",
    response,
    store,
    log: (line) => logs.push(line),
    send: async () => {
      sent.push(response.autoReplyType === "QUOTATION" ? "QUOTATION" : response.message);
    },
  });
  return { sent, logs, result, store };
}

test("a known catalogue item sends the quotation and not an acknowledgement", async () => {
  const response = determineInitialResponse(facts({ planKind: "QUOTE", planSend: true, salesAction: "AUTO_SEND", catalogueProductNamed: true }));
  assert.equal(response.decision, "QUOTE_READY");
  const delivery = await deliver("gmail-known", response);
  assert.deepEqual(delivery.sent, ["QUOTATION"]);
  assert.equal(delivery.sent.includes(ACKNOWLEDGEMENT), false);
  assert.equal(delivery.sent.includes(SOURCING_REPLY), false);
});

test("an unknown catalogue item sends one sourcing acknowledgement", async () => {
  const response = determineInitialResponse(facts({ planKind: "SOURCING", planMessage: SOURCING_REPLY, salesAction: "EXTERNAL_TASK" }));
  assert.equal(response.decision, "SOURCING_REQUIRED");
  assert.equal(response.message, SOURCING_REPLY);
  const delivery = await deliver("gmail-unknown", response);
  assert.deepEqual(delivery.sent, [SOURCING_REPLY]);
  assert.equal(delivery.sent.includes(ACKNOWLEDGEMENT), false);
});

test("specifications with no confirmed price send one pricing acknowledgement", async () => {
  const response = determineInitialResponse(facts({ planKind: "SOURCING", catalogueProductNamed: true, planMessage: SOURCING_REPLY }));
  assert.equal(response.decision, "PRICING_PENDING");
  assert.equal(response.message, ACKNOWLEDGEMENT);
  const delivery = await deliver("gmail-specs", response);
  assert.deepEqual(delivery.sent, [ACKNOWLEDGEMENT]);
  assert.equal(delivery.sent.includes(SOURCING_REPLY), false);
});

test("incomplete specifications send one clarification", async () => {
  const response = determineInitialResponse(facts({ planKind: "CLARIFICATION", planMessage: CLARIFICATION_REPLY }));
  assert.equal(response.decision, "NEEDS_CLARIFICATION");
  const delivery = await deliver("gmail-incomplete", response);
  assert.deepEqual(delivery.sent, [CLARIFICATION_REPLY]);
  assert.equal(delivery.sent.length, 1);
});

test("the same Gmail message processed twice sends one response", async () => {
  const response = determineInitialResponse(facts({ planKind: "SOURCING", planMessage: SOURCING_REPLY }));
  const store = memoryProcessingStore();
  const first = await deliver("gmail-twice", response, store);
  const second = await deliver("gmail-twice", response, store);
  assert.deepEqual(first.sent, [SOURCING_REPLY]);
  assert.deepEqual(second.sent, []);
  assert.equal(second.result.blocked, true);
  assert.match(second.logs.join("\n"), /response blocked: already replied/);
});

test("two workers processing the same message send one response", async () => {
  const response = determineInitialResponse(facts({ planKind: "SOURCING", planMessage: SOURCING_REPLY }));
  const store = memoryProcessingStore();
  const sent: string[] = [];
  const run = () => sendResponseOnce({
    gmailMessageId: "gmail-concurrent",
    threadId: "thread-1",
    response,
    store,
    send: async () => {
      await Promise.resolve();
      sent.push(response.message);
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
  const first = await deliver("gmail-retry", response, store);
  assert.equal(store.rows.get("gmail-retry")?.processingStatus, "SENT");
  const retry = await deliver("gmail-retry", response, store);
  assert.deepEqual(first.sent, ["QUOTATION"]);
  assert.deepEqual(retry.sent, []);
  assert.equal(retry.result.blocked, true);
  assert.equal(retry.result.finished, true);
});
