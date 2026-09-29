import Link from "next/link";
import { EmptyState, PageHeader, Panel, buttonPrimary } from "@/components/ui";
import { formatCents } from "@/lib/quote";
import { requireSession } from "@/services/auth-service";
import { listProducts } from "@/services/product-service";

export default async function ProductsPage() {
  const session = await requireSession();
  const products = await listProducts(session.workspace.id);
  return (
    <div>
      <PageHeader
        title="Products"
        description="Catalogue prices used when a quote is prepared by hand. Supplier feeds are not connected."
        actions={<Link className={buttonPrimary} href="/products/new">New product</Link>}
      />
      <Panel>
        {products.length === 0 ? (
          <div className="p-4"><EmptyState title="No products yet" description="Add the products Urban Focus quotes. Prices stay on the product until someone changes them." /></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>SKU</th><th>Name</th><th>Price</th><th>Status</th></tr></thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td><Link className="font-medium hover:underline" href={`/products/${product.id}/edit`}>{product.sku}</Link></td>
                  <td>{product.name}</td>
                  <td>{formatCents(product.unitPriceCents, product.currency)}</td>
                  <td>{product.active ? "Active" : "Inactive"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
