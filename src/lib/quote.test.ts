import assert from "node:assert/strict";
import test from "node:test";
import { formatQuoteEmail, formatQuoteNumber, lineTotalCents, parseMoneyToCents, parseQuantity, quoteTotalCents, quoteValidUntil } from "./quote";

test("parses rand amounts and quantities", () => {
  assert.equal(parseMoneyToCents("1 299,50"), 129950);
  assert.equal(parseMoneyToCents("10.5"), 1050);
  assert.equal(parseMoneyToCents("-1"), null);
  assert.equal(parseQuantity("2.5"), 2.5);
  assert.equal(parseQuantity("0"), null);
});

test("totals quote lines in cents", () => {
  assert.equal(lineTotalCents(2, 19900), 39800);
  assert.equal(lineTotalCents(1.5, 1000), 1500);
  assert.equal(quoteTotalCents([{ quantity: 2, unitPriceCents: 1000 }, { quantity: 1, unitPriceCents: 250 }]), 2250);
});

test("formats a quotation email without marking it sent", () => {
  const issuedAt = new Date("2026-09-29T12:00:00.000Z");
  const body = formatQuoteEmail({
    subject: "Switches",
    currency: "ZAR",
    number: 7,
    issuedAt,
    validUntil: quoteValidUntil(issuedAt, 14),
    customerName: "Jane Smith",
    companyName: "Acme",
    notes: "Prices exclude delivery.",
    lines: [{ description: "24-port switch", quantity: 2, unitPriceCents: 250000 }],
  });
  assert.equal(formatQuoteNumber(7, issuedAt), "Q-2026-0007");
  assert.match(body, /Quotation Q-2026-0007/);
  assert.match(body, /Valid until 13 October 2026/);
  assert.match(body, /Jane Smith/);
  assert.match(body, /24-port switch/);
  assert.match(body, /ZAR 5 000\.00/);
  assert.match(body, /Prices exclude delivery/);
  assert.match(body, /not a promotional message/);
  assert.equal(body.includes("https://"), false);
  assert.equal(body.includes("QUOTE_SENT"), false);
  const detailed = formatQuoteEmail({
    subject: "Switches",
    currency: "ZAR",
    lines: [{
      description: "24-port switch",
      quantity: 1,
      unitPriceCents: 100,
      specifications: "24 gigabit ports",
      imageUrls: ["https://cdn.example/switch.jpg"],
    }],
  });
  assert.match(detailed, /24 gigabit ports/);
  assert.match(detailed, /https:\/\/cdn\.example\/switch\.jpg/);
});
