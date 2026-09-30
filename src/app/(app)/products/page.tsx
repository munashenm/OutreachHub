import Link from "next/link";
import { Badge, EmptyState, PageHeader, Panel, buttonPrimary } from "@/components/ui";
import { formatCents } from "@/lib/quote";
import { isShortStock, stockLeft } from "@/lib/stock";
import { requireSession } from "@/services/auth-service";
import { listProducts } from "@/services/product-service";
import { reservedByProduct, supplierTrackedProductIds } from "@/services/stock-sync-service";

export default async function ProductsPage() {
  const session = await requireSession();
  const [products, reserved, tracked] = await Promise.all([
    listProducts(session.workspace.id),
    reservedByProduct(session.workspace.id),
    supplierTrackedProductIds(session.workspace.id),
  ]);
  const rows = products.map((product) => {
    const holding = reserved.get(product.id) ?? 0;
    const left = stockLeft(product.stockOnHand, holding);
    return { product, holding, left, short: isShortStock(product.stockOnHand, holding, tracked.has(product.id)) };
  });
  const shortRows = rows.filter((row) => row.short);
  return (
    <div>
      <PageHeader
        title="Products"
        description="Stock is the supplier quantity. Left subtracts open quotations and website orders that are pending, processing, or on hold. The website receives the quantity left."
        actions={<Link className={buttonPrimary} href="/products/new">New product</Link>}
      />
      {shortRows.length > 0 ? (
        <Panel className="mb-4 p-5">
          <h2 className="font-semibold">Short stock</h2>
          <p className="mt-1 text-sm text-muted">These products have a supplier record or an open hold, and nothing is left to sell.</p>
          <ul className="mt-3 space-y-2 text-sm">
            {shortRows.map((row) => (
              <li key={row.product.id}>
                <Link className="font-medium hover:underline" href={`/products/${row.product.id}/edit`}>{row.product.sku}</Link>
                {" "}{row.product.name} · stock {row.product.stockOnHand} · holding {row.holding} · left 0
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <Panel>
        {products.length === 0 ? (
          <div className="p-4"><EmptyState title="No products yet" description="Add the products Urban Focus quotes. Prices stay on the product until someone changes them." /></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>SKU</th><th>Name</th><th>Price</th><th>Stock</th><th>Left</th><th>Images</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.product.id}>
                  <td><Link className="font-medium hover:underline" href={`/products/${row.product.id}/edit`}>{row.product.sku}</Link></td>
                  <td>{row.product.name}</td>
                  <td>{formatCents(row.product.unitPriceCents, row.product.currency)}</td>
                  <td>{row.product.stockOnHand}</td>
                  <td>{row.left} {row.short ? <Badge tone="amber">Short</Badge> : null}</td>
                  <td>{row.product.imageUrls.length > 0 ? row.product.imageUrls.length : "—"}</td>
                  <td>{row.product.active ? "Active" : "Inactive"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
