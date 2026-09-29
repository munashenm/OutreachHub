import Link from "next/link";
import { EmptyState, PageHeader, Panel, buttonPrimary } from "@/components/ui";
import { requireSession } from "@/services/auth-service";
import { listSuppliers } from "@/services/supplier-service";

export default async function SuppliersPage() {
  const session = await requireSession();
  const suppliers = await listSuppliers(session.workspace.id);
  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Upload a price file for products already in the catalogue. Unknown SKUs are skipped, and sell prices are not changed."
        actions={<Link className={buttonPrimary} href="/suppliers/new">New supplier</Link>}
      />
      <Panel>
        {suppliers.length === 0 ? (
          <div className="p-4"><EmptyState title="No suppliers yet" description="Add a supplier, then import a CSV of sku, supplierSku, and cost." /></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Prices</th></tr></thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <td><Link className="font-medium hover:underline" href={`/suppliers/${supplier.id}`}>{supplier.name}</Link></td>
                  <td>{supplier.email ?? "—"}</td>
                  <td>{supplier._count.prices}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
