import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { classifyRecords, findSupplierItem, parserForSupplier, previewRows, rowsForSupplier, suggestMapping, tableFromCsv, tableFromXlsx } from "./supplier-file";

test("a later file updates the same supplier product by SKU, barcode, or part number", () => {
  const existing = [
    { id: "1", supplierSku: "OLD", manufacturerPartNumber: "MPN-1", barcode: "6001234567890" },
  ];
  assert.equal(findSupplierItem(existing, { supplierSku: "OLD", manufacturerPartNumber: "", barcode: "" })?.id, "1");
  assert.equal(findSupplierItem(existing, { supplierSku: "NEW", manufacturerPartNumber: "", barcode: "6001234567890" })?.id, "1");
  assert.equal(findSupplierItem(existing, { supplierSku: "NEW", manufacturerPartNumber: "MPN-1", barcode: "" })?.id, "1");
  assert.equal(findSupplierItem(existing, { supplierSku: "OTHER", manufacturerPartNumber: "MPN-2", barcode: "111" }), null);
});

test("Scoop column rules stay on Scoop", () => {
  const text = "sku,description,dealer price,cpt,jhb,dbn\nCAB-1,Cabinet,10.00,2,3,4";
  assert.equal(parserForSupplier("Rectron"), "generic");
  assert.equal(parserForSupplier("Scoop"), "scoop");
  const table = tableFromCsv(text);
  const generic = rowsForSupplier("Rectron", text, table.records, { sku: "sku", cost: "dealer price", stock: "cpt" });
  assert.equal(generic.parser, "generic");
  assert.equal(generic.offers[0]?.costCents, 1000);
  assert.equal(generic.offers[0]?.stockQty, 2);
  const scoop = rowsForSupplier("Scoop", text, table.records, {});
  assert.equal(scoop.parser, "scoop");
  assert.equal(scoop.offers[0]?.stockQty, 9);
});

test("an inclusive cost is stored exclusive and a preview shows ten rows", () => {
  const records = Array.from({ length: 12 }, (_, index) => ({
    Code: `SKU-${index + 1}`,
    Title: `Product ${index + 1}`,
    "Price incl": "R 1,150.00",
  }));
  const mapping = suggestMapping(["Code", "Title", "Price incl"]);
  assert.equal(mapping.sku, "Code");
  assert.equal(mapping.costInclusive, "Price incl");
  const classified = classifyRecords(records, mapping);
  assert.equal(classified.offers[0]?.costCents, 100000);
  assert.equal(previewRows(records).length, 10);
  assert.equal(classified.rejections.length, 0);
});

test("an xlsx sheet is read as supplier columns", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Prices");
  sheet.addRow(["SKU", "Name", "Stock"]);
  sheet.addRow(["ABC", "Switch", 4]);
  const data = await workbook.xlsx.writeBuffer();
  const table = await tableFromXlsx(new Uint8Array(data));
  assert.deepEqual(table.headers, ["SKU", "Name", "Stock"]);
  assert.equal(table.records[0]?.SKU, "ABC");
  assert.equal(table.records[0]?.Stock, "4");
});
