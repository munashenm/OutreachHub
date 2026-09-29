import Link from "next/link";
import { notFound } from "next/navigation";
import { CreateCustomerButton } from "@/components/order-actions";
import { PageHeader, Panel } from "@/components/ui";
import { formatDateTime, fullName } from "@/lib/format";
import { formatCents } from "@/lib/quote";
import { orderReservesStock } from "@/lib/store-order";
import { requireSession } from "@/services/auth-service";
import { getStoreOrder } from "@/services/store-order-service";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const order = await getStoreOrder(session.workspace.id, id);
  if (!order) notFound();
  const reserves = orderReservesStock(order.status);
  return (
    <div>
      <PageHeader
        title={`Order ${order.number}`}
        description={`${order.status} · placed ${formatDateTime(order.placedAt)}`}
        actions={<Link href="/orders" className="text-sm text-accent">Back to orders</Link>}
      />
      <Panel className="mb-4 grid gap-3 p-5 text-sm md:grid-cols-2">
        <p><span className="text-muted">Customer: </span>{order.customerName}</p>
        <p><span className="text-muted">Email: </span>{order.email}</p>
        <p><span className="text-muted">Company: </span>{order.companyName || "—"}</p>
        <p><span className="text-muted">Total: </span>{formatCents(order.totalCents, order.currency)}</p>
        <p>
          <span className="text-muted">Linked customer: </span>
          {order.prospect ? (
            <Link className="hover:underline" href={`/prospects/${order.prospect.id}`}>{fullName(order.prospect.firstName, order.prospect.lastName)}</Link>
          ) : (
            <CreateCustomerButton orderId={order.id} />
          )}
        </p>
      </Panel>
      <Panel>
        {order.lines.length === 0 ? (
          <div className="p-4 text-sm text-muted">This order has no line items.</div>
        ) : (
          <table className="data-table">
            <thead><tr><th>SKU</th><th>Catalogue</th><th>Qty</th><th>Stock</th></tr></thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.sku}</td>
                  <td>
                    {line.product ? (
                      <Link className="hover:underline" href={`/products/${line.product.id}/edit`}>{line.product.sku} · {line.product.name}</Link>
                    ) : "Not in the catalogue"}
                  </td>
                  <td>{line.quantity}</td>
                  <td>{reserves && line.productId ? "Holding stock" : "Not holding stock"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
