import Link from "next/link";
import { addSouthAfricanDistributorsAction } from "@/actions/supplier-actions";
import { EmptyState, PageHeader, Panel, buttonPrimary, buttonSecondary } from "@/components/ui";
import { missingDistributors } from "@/lib/distributors";
import { requireSession } from "@/services/auth-service";
import { listSuppliers } from "@/services/supplier-service";

export default async function SuppliersPage() {
  const session = await requireSession();
  const suppliers = await listSuppliers(session.workspace.id);
  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Add each supplier, then connect that supplier's JSON, XML, or CSV feed, or upload a CSV. Every saved feed is searched when a quotation is prepared. Suppliers from China and Europe use the same form with their country or region."
        actions={<Link className={buttonPrimary} href="/suppliers/new">New supplier</Link>}
      />
      <DistributorRoster names={suppliers.map((supplier) => supplier.name)} />
      <Panel>
        {suppliers.length === 0 ? (
          <div className="p-4"><EmptyState title="No suppliers yet" description="Add a supplier, then save a JSON, XML, or CSV feed address, or upload a CSV." /></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Country</th><th>Feed</th><th>Prices</th></tr></thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <td><Link className="font-medium hover:underline" href={`/suppliers/${supplier.id}`}>{supplier.name}</Link></td>
                  <td>{supplier.email ?? "—"}</td>
                  <td>{supplier.country || "—"}</td>
                  <td>{supplier.feedEnabled ? supplier.feedType : "Not active"}</td>
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

function DistributorRoster({ names }: { names: string[] }) {
  const missing = missingDistributors(names);
  return (
    <Panel className="mb-4 p-5">
      <h2 className="font-semibold">South African distributors</h2>
      {missing.length === 0 ? (
        <p className="mt-1 text-sm text-muted">Miro, Scoop, Pinnacle, Frontosa, SMD Technologies, Mustek, Astrum, DCC, Axiz, Rectron, Tarsus, Linkqage, First Distribution, and Syntech are on this list. A feed stays off until its price-list address is saved.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">Add {missing.map((distributor) => distributor.name).join(", ")}. No feed address is saved, so stock sync does not run for them yet.</p>
          <form action={addSouthAfricanDistributorsAction} className="mt-3">
            <button className={buttonSecondary}>Add South African distributors</button>
          </form>
        </>
      )}
    </Panel>
  );
}
