import Link from "next/link";
import { addSouthAfricanDistributorsAction } from "@/actions/supplier-actions";
import { Badge, EmptyState, PageHeader, Panel, buttonPrimary, buttonSecondary } from "@/components/ui";
import { missingDistributors } from "@/lib/distributors";
import { SUPPLIER_CLASS_LABELS, SUPPLIER_CLASS_TONE, classifySupplier, scoresFrom } from "@/lib/supplier-scorecard";
import { requireSession } from "@/services/auth-service";
import { listSuppliers } from "@/services/supplier-service";

export default async function SuppliersPage() {
  const session = await requireSession();
  const suppliers = await listSuppliers(session.workspace.id);
  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Add each supplier, then connect a JSON, CSV, or XML feed, or upload a CSV, XML, or XLSX file. Saved rows are searched when a quotation is prepared. A file import does not need a feed address."
        actions={<Link className={buttonPrimary} href="/suppliers/new">New supplier</Link>}
      />
      <DistributorRoster names={suppliers.map((supplier) => supplier.name)} />
      <Panel>
        {suppliers.length === 0 ? (
          <div className="p-4"><EmptyState title="No suppliers yet" description="Add a supplier, then save a feed address or upload a CSV, XML, or XLSX file." /></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Country</th><th>Class</th><th>Source</th><th>Products</th></tr></thead>
            <tbody>
              {suppliers.map((supplier) => {
                const result = classifySupplier(scoresFrom(supplier.scorecard));
                return (
                <tr key={supplier.id}>
                  <td><Link className="font-medium hover:underline" href={`/suppliers/${supplier.id}`}>{supplier.name}</Link></td>
                  <td>{supplier.email ?? "—"}</td>
                  <td>{supplier.country || "—"}</td>
                  <td><Badge tone={SUPPLIER_CLASS_TONE[result.supplierClass]}>{SUPPLIER_CLASS_LABELS[result.supplierClass]}</Badge></td>
                  <td>{supplier.feedEnabled ? (supplier.stockFeedUrl ? supplier.feedType : "Manual file") : "Not active"}</td>
                  <td>{supplier._count.feedItems}</td>
                </tr>
                );
              })}
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
        <p className="mt-1 text-sm text-muted">Miro, Scoop, Pinnacle, Frontosa, SMD Technologies, Mustek, Astrum, DCC, Axiz, Rectron, Tarsus, Linkqage, First Distribution, and Syntech are on this list. Each one stays inactive until a feed address is saved or a file is imported.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">Add {missing.map((distributor) => distributor.name).join(", ")}. Stock sync does not run until a feed address is saved. A file can be uploaded without an address.</p>
          <form action={addSouthAfricanDistributorsAction} className="mt-3">
            <button className={buttonSecondary}>Add South African distributors</button>
          </form>
        </>
      )}
    </Panel>
  );
}
