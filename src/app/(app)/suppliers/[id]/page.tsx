import Link from "next/link";
import { notFound } from "next/navigation";
import { SupplierFeedForm } from "@/components/supplier-feed-form";
import { SupplierPriceImport } from "@/components/supplier-price-import";
import { PageHeader, Panel } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { formatCents } from "@/lib/quote";
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
        <p className="mt-1 mb-4 text-sm text-muted">Pull cost and quantity from the supplier API. The sell price is the cost plus the markup. Unknown SKUs are skipped.</p>
        {supplier.lastStockSyncError ? <p className="mb-3 text-sm text-red-700">{supplier.lastStockSyncError}</p> : null}
        {supplier.lastStockSyncAt ? <p className="mb-3 text-sm text-muted">Last sync {formatDateTime(supplier.lastStockSyncAt)}</p> : null}
        <SupplierFeedForm supplierId={supplier.id} markupPercent={supplier.markupPercent} stockFeedUrl={supplier.stockFeedUrl ?? ""} hasKey={Boolean(supplier.stockFeedKeyEncrypted)} />
      </Panel>
      <Panel className="p-5">
        <h2 className="font-semibold">Import prices</h2>
        <p className="mt-1 mb-4 text-sm text-muted">Columns: sku, supplierSku, cost. A row is saved only when the SKU already exists in Products.</p>
        <SupplierPriceImport supplierId={supplier.id} />
      </Panel>
      <Panel>
        {supplier.prices.length === 0 ? <p className="p-5 text-sm text-muted">No prices imported.</p> : (
          <table className="data-table">
            <thead><tr><th>Catalogue SKU</th><th>Product</th><th>Supplier SKU</th><th>Cost</th><th>Stock</th><th>Sell price</th><th>Updated</th></tr></thead>
            <tbody>
              {supplier.prices.map((price) => (
                <tr key={price.id}>
                  <td>{price.product.sku}</td>
                  <td>{price.product.name}</td>
                  <td>{price.supplierSku}</td>
                  <td>{formatCents(price.costCents, price.product.currency)}</td>
                  <td>{price.stockQty}</td>
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
