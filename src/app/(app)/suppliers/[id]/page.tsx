import Link from "next/link";
import { notFound } from "next/navigation";
import { SupplierFeedForm } from "@/components/supplier-feed-form";
import { SupplierPriceImport } from "@/components/supplier-price-import";
import { PageHeader, Panel } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { formatCents } from "@/lib/quote";
import { readFieldMapping } from "@/lib/supplier-connector";
import { requireSession } from "@/services/auth-service";
import { getSupplier } from "@/services/supplier-service";

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const supplier = await getSupplier(session.workspace.id, id);
  if (!supplier) notFound();
  return (
    <div className="space-y-4">
      <PageHeader title={supplier.name} description={supplier.email ?? "No email"} actions={<Link href="/suppliers" className="text-sm text-accent">Back</Link>} />
      <Panel className="p-5">
        <h2 className="font-semibold">Stock feed</h2>
        <p className="mt-1 mb-4 text-sm text-muted">JSON, XML, and CSV addresses are read on sync. A supplier stays inactive until a feed address is saved. Unknown rows are skipped. The catalogue price and the stock quantity follow the fresh offer that can fill one unit, then cost, preference, and lead time. Stock is not a total of every supplier.</p>
        {supplier.lastStockSyncError ? <p className="mb-3 text-sm text-red-700">{supplier.lastStockSyncError}</p> : null}
        {supplier.lastStockSyncAt ? <p className="mb-3 text-sm text-muted">Last stock sync {formatDateTime(supplier.lastStockSyncAt)}</p> : null}
        {supplier.lastPriceSyncAt ? <p className="mb-3 text-sm text-muted">Last price sync {formatDateTime(supplier.lastPriceSyncAt)}</p> : null}
        <SupplierFeedForm
          supplierId={supplier.id}
          markupPercent={supplier.markupPercent}
          stockFeedUrl={supplier.stockFeedUrl ?? ""}
          hasKey={Boolean(supplier.stockFeedKeyEncrypted)}
          feedType={supplier.feedType}
          authType={supplier.authType}
          authHeaderName={supplier.authHeaderName}
          authUsername={supplier.authUsername}
          vatMode={supplier.vatMode}
          stockSyncIntervalMinutes={supplier.stockSyncIntervalMinutes}
          priceSyncIntervalMinutes={supplier.priceSyncIntervalMinutes}
          catalogueSyncIntervalMinutes={supplier.catalogueSyncIntervalMinutes}
          preference={supplier.preference}
          leadTimeDays={supplier.leadTimeDays}
          mapping={readFieldMapping(supplier.fieldMapping)}
        />
      </Panel>
      <Panel className="p-5">
        <h2 className="font-semibold">Import prices</h2>
        <p className="mt-1 mb-4 text-sm text-muted">Columns: sku, supplierSku, cost. Optional columns: manufacturerPartNumber, stock, name, brand, description, specifications, imageUrls, category, leadTimeDays. A row is saved only when the SKU or manufacturer part number already exists. The catalogue sell price is not changed.</p>
        <SupplierPriceImport supplierId={supplier.id} />
      </Panel>
      <Panel>
        {supplier.prices.length === 0 ? <p className="p-5 text-sm text-muted">No prices imported.</p> : (
          <table className="data-table">
            <thead><tr><th>Catalogue SKU</th><th>Product</th><th>Supplier SKU</th><th>Part number</th><th>Cost</th><th>Stock</th><th>Sell price</th><th>Updated</th></tr></thead>
            <tbody>
              {supplier.prices.map((price) => (
                <tr key={price.id}>
                  <td>{price.product.sku}</td>
                  <td>{price.product.name}</td>
                  <td>{price.supplierSku}</td>
                  <td>{price.manufacturerPartNumber || "—"}</td>
                  <td>{price.costKnown ? formatCents(price.costCents, price.product.currency) : "—"}</td>
                  <td>{price.stockKnown ? price.stockQty : "—"}</td>
                  <td>{formatCents(price.product.unitPriceCents, price.product.currency)}</td>
                  <td>{formatDateTime(price.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
