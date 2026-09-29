import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, rowsToRecords, serializeCsv } from "./csv";

test("parses quoted commas and escaped quotes", () => {
  const rows = parseCsv('name,note\n"Ada, Lovelace","She said ""hello"""\n');
  const records = rowsToRecords(rows);
  assert.equal(records[0].name, "Ada, Lovelace");
  assert.equal(records[0].note, 'She said "hello"');
});

test("round-trips exported cells and guards spreadsheet formulas", () => {
  const csv = serializeCsv(["email", "notes"], [{ email: "ada@example.com", notes: "=cmd()" }]);
  const records = rowsToRecords(parseCsv(csv));
  assert.equal(records[0].email, "ada@example.com");
  assert.equal(records[0].notes, "'=cmd()");
});

test("rejects an unterminated quote", () => {
  assert.throws(() => parseCsv('name\n"Ada'), /unterminated/i);
});
