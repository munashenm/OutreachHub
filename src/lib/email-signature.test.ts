import assert from "node:assert/strict";
import test from "node:test";
import { buildRawEmail } from "./email-mime";
import { URBAN_FOCUS_LOGO_CID, urbanFocusLogoInline, withClientSignature } from "./email-signature";

test("adds the Urban Focus signature once to a client email", () => {
  const signed = withClientSignature("Good day Munashe,\n\nPlease find the quotation attached.");
  assert.match(signed.body, /Urban Focus Sales Team/);
  assert.match(signed.body, /087 550 1813/);
  assert.match(signed.body, /sales@urbanfocus\.co\.za/);
  assert.match(signed.body, /www\.urbanfocus\.co\.za/);
  assert.match(signed.body, /Samrand Business Park/);
  assert.match(signed.body, /confidential information/);
  assert.equal(signed.body.split("confidential information").length, 2);
  const again = withClientSignature(signed.body);
  assert.equal(again.body.split("confidential information").length, 2);
  assert.match(signed.html, /cid:urban-focus-logo/);
  assert.match(signed.html, /facebook\.com\/urbanfocusonline/);
  assert.match(signed.html, /instagram\.com\/urbanfocusonline/);
  assert.match(signed.html, /x\.com\/urbanfocusza/);
  assert.match(signed.html, /tiktok\.com\/@urbanfocussa/);
  assert.equal(signed.html.includes("<script"), false);
});

test("keeps the signature beside a quotation PDF", () => {
  const signed = withClientSignature("Please find the quotation attached.");
  const logo = urbanFocusLogoInline();
  assert.ok(logo);
  const raw = Buffer.from(buildRawEmail({
    from: "sales@urbanfocus.co.za",
    to: "buyer@example.com",
    subject: "Quotation UF-Q-20261005-0001",
    body: signed.body,
    html: signed.html,
    inlineImages: [logo],
    attachments: [{ filename: "UF-Q-20261005-0001.pdf", contentType: "application/pdf", data: Buffer.from("%PDF-1.4") }],
  }), "base64url").toString("utf8");
  assert.match(raw, /text\/html/);
  assert.match(raw, new RegExp(`Content-ID: <${URBAN_FOCUS_LOGO_CID}>`));
  assert.match(raw, /filename="UF-Q-20261005-0001\.pdf"/);
  assert.match(raw, /application\/pdf/);
  assert.match(raw, /sales@urbanfocus\.co\.za/);
});
