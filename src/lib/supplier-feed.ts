import { parseMoneyToCents } from "./quote";

export type SupplierFeedRejection = { row: number; sku: string; reason: string };

export type PlannedSupplierPrice = {
  row: number;
  sku: string;
  productId: string;
  supplierSku: string;
  costCents: number;
};

export function planSupplierPriceImport(
  records: Record<string, string>[],
  productsBySku: Map<string, string>,
) {
  const ready: PlannedSupplierPrice[] = [];
  const rejected: SupplierFeedRejection[] = [];
  const seen = new Set<string>();

  records.forEach((record, index) => {
    const row = index + 2;
    const sku = (record.sku ?? "").trim();
    if (!sku) {
      rejected.push({ row, sku, reason: "SKU is required." });
      return;
    }
    const key = sku.toLowerCase();
    if (seen.has(key)) {
      rejected.push({ row, sku, reason: "This SKU is duplicated in the file." });
      return;
    }
    seen.add(key);
    const productId = productsBySku.get(key);
    if (!productId) {
      rejected.push({ row, sku, reason: "No catalogue product uses this SKU. The row was not added." });
      return;
    }
    const costCents = parseMoneyToCents(record.cost ?? "");
    if (costCents === null) {
      rejected.push({ row, sku, reason: "Enter a cost in rands, such as 899.00." });
      return;
    }
    ready.push({
      row,
      sku,
      productId,
      supplierSku: (record.suppliersku ?? "").trim() || sku,
      costCents,
    });
  });

  return { ready, rejected };
}

export function lowestCostCents(costs: number[]) {
  if (costs.length === 0) return null;
  return Math.min(...costs);
}

export function sellPriceAfterSupplierFeed(currentSellCents: number) {
  return currentSellCents;
}
