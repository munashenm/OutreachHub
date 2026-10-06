import assert from "node:assert/strict";
import test from "node:test";
import { displayedQuoteNumber, formatCurrency, formatQuoteDate, formatQuoteEmail, formatQuoteNumber, lineTotalCents, parseMoneyToCents, parseQuantity, quoteTotalCents, quoteValidUntil, snapshotQuoteLine, urbanFocusQuoteNumber } from "./quote";

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
  assert.equal(urbanFocusQuoteNumber(1, new Date("2026-10-06T08:00:00.000Z")), "UF-Q-261006-0001");
  assert.equal(urbanFocusQuoteNumber(1, new Date("2027-10-06T08:00:00.000Z")), "UF-Q-271006-0001");
  assert.equal(formatQuoteDate(new Date("2026-10-06T08:00:00.000Z")), "6 October 2026");
  assert.equal(displayedQuoteNumber(1, new Date("2026-10-06T08:00:00.000Z"), "UF-Q-20261006-0001.pdf"), "UF-Q-20261006-0001");
  assert.equal(formatCurrency(100), "R 100.00");
  assert.equal(formatCurrency(1250), "R 1,250.00");
  assert.equal(formatCurrency(24850.5), "R 24,850.50");
  assert.equal(formatCurrency(24999), "R 24,999.00");
  assert.match(body, /Quotation No: UF-Q-260929-0007/);
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

test("copies the catalogue specification and images onto a sent line", () => {
  const shot = snapshotQuoteLine({
    specifications: "24 gigabit ports",
    imageUrls: ["https://cdn.example/switch.jpg"],
  });
  assert.deepEqual(shot, {
    specifications: "24 gigabit ports",
    imageUrls: ["https://cdn.example/switch.jpg"],
  });
  assert.deepEqual(snapshotQuoteLine(null), { specifications: "", imageUrls: [] });
  shot.imageUrls.push("https://cdn.example/other.jpg");
  assert.deepEqual(snapshotQuoteLine({ specifications: "24 gigabit ports", imageUrls: ["https://cdn.example/switch.jpg"] }).imageUrls, ["https://cdn.example/switch.jpg"]);
});
