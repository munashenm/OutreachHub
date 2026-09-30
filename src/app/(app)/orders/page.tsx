import Link from "next/link";
import { CreateCustomerButton, SyncOrdersButton } from "@/components/order-actions";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { formatDateTime, fullName } from "@/lib/format";
import { formatCents } from "@/lib/quote";
import { requireSession } from "@/services/auth-service";
import { listStoreOrders } from "@/services/store-order-service";

export default async function OrdersPage() {
  const session = await requireSession();
  const orders = await listStoreOrders(session.workspace.id);
  return (
    <div>
      <PageHeader
        title="Orders"
        description="Recent Urban Focus website orders. Pending, processing, and on-hold lines reduce the stock left for matching catalogue SKUs. An order is linked when the billing email already belongs to a customer."
        actions={<SyncOrdersButton />}
      />
      <Panel>
        {orders.length === 0 ? (
          <div className="p-4"><EmptyState title="No website orders yet" description="Connect the store under Settings, then sync orders." /></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Order</th><th>Customer</th><th>Email</th><th>Items</th><th>Total</th><th>Status</th><th>Placed</th><th></th></tr></thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td><Link className="font-medium hover:underline" href={`/orders/${order.id}`}>{order.number}</Link></td>
                  <td>{order.customerName}</td>
                  <td>{order.email}</td>
                  <td>{order.summary || "—"}</td>
                  <td>{formatCents(order.totalCents, order.currency)}</td>
                  <td>{order.status}</td>
                  <td>{formatDateTime(order.placedAt)}</td>
                  <td>
                    {order.prospect ? (
                      <Link className="hover:underline" href={`/prospects/${order.prospect.id}`}>{fullName(order.prospect.firstName, order.prospect.lastName)}</Link>
                    ) : (
                      <CreateCustomerButton orderId={order.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
