import { serializeCsv } from "@/lib/csv";

export function GET() {
  const body = serializeCsv(["sku", "supplierSku", "cost"], []);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"supplier-prices.csv\"",
    },
  });
}
