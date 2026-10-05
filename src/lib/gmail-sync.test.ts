import assert from "node:assert/strict";
import test from "node:test";
import { extractPlainText, listGmailAttachments, parseEmailAddress, replyTargets } from "./gmail-message";
import {
  campaignLinkForInbound,
  canSendPromotional,
  canSendTransactionalReply,
  isHistoryExpired,
  isInvalidGrant,
  matchSender,
  ownedByWorkspace,
  planInboundInserts,
  rfqDraftFromMessage,
  shouldIngestGmailMessage,
} from "./gmail-sync";
import { leadStatusAfterReply } from "./sending-window";

test("skips spam and trash and accepts inbox mail", () => {
  assert.equal(shouldIngestGmailMessage(["INBOX"]), true);
  assert.equal(shouldIngestGmailMessage(["SPAM"]), false);
  assert.equal(shouldIngestGmailMessage(["CATEGORY_UPDATES", "TRASH"]), false);
});

test("does not insert a Gmail message that was already synced", () => {
  const existing = new Set(["m1"]);
  const first = planInboundInserts(existing, [{ externalId: "m1" }, { externalId: "m2" }]);
  assert.deepEqual(first.map((item) => item.externalId), ["m2"]);
  const second = planInboundInserts(new Set(["m1", "m2"]), [{ externalId: "m1" }, { externalId: "m2" }]);
  assert.equal(second.length, 0);
});

test("matches an existing prospect and leaves an unknown sender unmatched", () => {
  const prospects = [{ id: "p1", email: "ada@buyer.co.za", companyId: "c1" }];
  assert.equal(matchSender("Ada@buyer.co.za", prospects).kind, "matched");
  assert.equal(matchSender("new@buyer.co.za", prospects).kind, "unknown");
});

test("builds an RFQ from the original enquiry", () => {
  const draft = rfqDraftFromMessage({
    subject: "Quote for switches",
    body: "Please quote 10 units.",
    prospectId: "p1",
    companyId: "c1",
  });
  assert.equal(draft.subject, "Quote for switches");
  assert.equal(draft.prospectId, "p1");
  assert.equal(draft.description, "Please quote 10 units.");
});

test("keeps a reply on the original Gmail thread", () => {
  const target = replyTargets({
    threadId: "thread-1",
    internetMessageId: "<abc@mail.gmail.com>",
    subject: "Need a quote",
    fromEmail: "buyer@example.com",
  });
  assert.equal(target.threadId, "thread-1");
  assert.equal(target.inReplyTo, "<abc@mail.gmail.com>");
  assert.equal(target.subject, "Re: Need a quote");
  assert.equal(target.to, "buyer@example.com");
});

test("links a campaign reply and does not downgrade a qualified lead", () => {
  const link = campaignLinkForInbound("thread-9", [
    { id: "out-1", threadId: "thread-9", campaignId: "camp-1", prospectId: "p1" },
  ]);
  assert.equal(link?.campaignId, "camp-1");
  assert.equal(leadStatusAfterReply("CONTACTED"), "RESPONDED");
  assert.equal(leadStatusAfterReply("QUALIFIED"), null);
  assert.equal(leadStatusAfterReply("WON"), null);
});

test("blocks promotional mail for an opted-out prospect and still allows a transactional reply", () => {
  assert.equal(canSendPromotional("OPTED_OUT", false), false);
  assert.equal(canSendPromotional("CONSENTED", true), false);
  assert.equal(canSendPromotional("CONSENTED", false), true);
  assert.equal(canSendTransactionalReply(), true);
});

test("treats an expired history cursor and an invalid grant as recoverable mailbox errors", () => {
  assert.equal(isHistoryExpired(404), true);
  assert.equal(isHistoryExpired(200), false);
  assert.equal(isInvalidGrant("invalid_grant"), true);
  assert.equal(isInvalidGrant("Gmail refused the message."), false);
});

test("hides a mailbox, message, or RFQ from another workspace", () => {
  assert.equal(ownedByWorkspace({ id: "m1", workspaceId: "other" }, "urban"), null);
  assert.deepEqual(ownedByWorkspace({ id: "m1", workspaceId: "urban" }, "urban"), { id: "m1", workspaceId: "urban" });
});

test("reads the plain text part of a Gmail payload", () => {
  const text = extractPlainText({
    mimeType: "multipart/alternative",
    parts: [{ mimeType: "text/plain", body: { data: Buffer.from("Hello Ada", "utf8").toString("base64url") } }],
  });
  assert.equal(text, "Hello Ada");
  assert.equal(parseEmailAddress("Ada Buyer <ada@buyer.co.za>").email, "ada@buyer.co.za");
});

test("lists named Gmail attachments and keeps inline body text separate", () => {
  const files = listGmailAttachments({
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "text/plain", body: { data: Buffer.from("Please quote", "utf8").toString("base64url") } },
      { mimeType: "application/pdf", filename: "schedule.pdf", body: { attachmentId: "att-1" } },
    ],
  });
  assert.deepEqual(files, [{ filename: "schedule.pdf", contentType: "application/pdf", data: undefined, attachmentId: "att-1" }]);
});
