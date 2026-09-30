import assert from "node:assert/strict";
import test from "node:test";
import { orderReservesStock, parseStoreOrders } from "./store-order";

test("reads a website order and skips one without an email", () => {
  const parsed = parseStoreOrders([
    {
      id: 88,
      number: "1088",
      status: "processing",
      currency: "ZAR",
      total: "1299.50",
      date_created_gmt: "2026-09-29T10:00:00",
      billing: { first_name: "Jane", last_name: "Smith", email: "Jane@Client.co.za", company: "Acme" },
      line_items: [{ sku: "SW-24", quantity: 2, name: "Switch" }],
    },
    { id: 89, total: "10.00", date_created_gmt: "2026-09-29T10:00:00", billing: {} },
  ]);
  assert.equal(parsed.error, null);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.orders[0]?.email, "jane@client.co.za");
  assert.equal(parsed.orders[0]?.totalCents, 129950);
  assert.equal(parsed.orders[0]?.summary, "2 x SW-24");
  assert.equal(parsed.orders[0]?.customerName, "Jane Smith");
  assert.deepEqual(parsed.orders[0]?.lines, [{ sku: "SW-24", quantity: 2 }]);
  const native = parseStoreOrders({
    orders: [{
      id: "90",
      number: "1090",
      status: "pending",
      email: "buyer@urbanfocus.co.za",
      customerName: "Urban Buyer",
      companyName: "Urban Focus",
      totalCents: 5000,
      currency: "ZAR",
      placedAt: "2026-09-29T12:00:00.000Z",
      lines: [{ sku: "SW-24", quantity: 1 }],
    }],
  });
  assert.equal(native.orders[0]?.customerName, "Urban Buyer");
  assert.equal(native.orders[0]?.totalCents, 5000);
  assert.equal(orderReservesStock("processing"), true);
  assert.equal(orderReservesStock("completed"), false);
});
