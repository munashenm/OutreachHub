import Link from "next/link";
import { notFound } from "next/navigation";
import { SupplierFeedForm } from "@/components/supplier-feed-form";
import { SupplierManualImport } from "@/components/supplier-manual-import";
import { SupplierTabs } from "@/components/supplier-tabs";
import { PageHeader, Panel } from "@/components/ui";
import { distributorKey } from "@/lib/distributors";
import { formatDateTime } from "@/lib/format";
import { formatCents } from "@/lib/quote";
import { readFieldMapping } from "@/lib/supplier-connector";
import { IMPORT_COLUMNS } from "@/lib/supplier-file";
import { requireSession } from "@/services/auth-service";
import { getSupplier } from "@/services/supplier-service";

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const supplier = await getSupplier(session.workspace.id, id);
  if (!supplier) notFound();
  const mapping = readFieldMapping(supplier.fieldMapping);
  const savedMapping = Object.fromEntries(IMPORT_COLUMNS.flatMap((column) => {
    const value = mapping[column.key];
    return value ? [[column.key, value]] : [];
  }));
  const scoop = distributorKey(supplier.name) === "scoop";
  const frontosa = distributorKey(supplier.name) === "frontosa";
  const form = {
    supplierId: supplier.id,
    markupPercent: supplier.markupPercent,
    stockFeedUrl: supplier.stockFeedUrl ?? "",
    hasKey: Boolean(supplier.stockFeedKeyEncrypted),
    feedType: supplier.feedType,
    authType: supplier.authType,
    authHeaderName: supplier.authHeaderName,
    authUsername: supplier.authUsername,
    vatMode: supplier.vatMode,
    stockSyncIntervalMinutes: supplier.stockSyncIntervalMinutes,
    priceSyncIntervalMinutes: supplier.priceSyncIntervalMinutes,
    catalogueSyncIntervalMinutes: supplier.catalogueSyncIntervalMinutes,
    preference: supplier.preference,
    leadTimeDays: supplier.leadTimeDays,
    mapping,
  };
  return (
    <div className="space-y-4">
      <PageHeader title={supplier.name} description={[supplier.country, supplier.email].filter(Boolean).join(" · ") || "No email"} actions={<Link href="/suppliers" className="text-sm text-accent">Back</Link>} />
      <SupplierTabs
        feed={
          <Panel className="p-5">
            <h2 className="font-semibold">Automatic feed</h2>
            <p className="mt-1 mb-4 text-sm text-muted">
              {scoop
                ? "Scoop uses its own price list. Dealer price excluding VAT is the supplier cost, and total stock is the available stock."
                : frontosa
                  ? "Frontosa uses its catalogue and stock JSON feeds and a token. Other suppliers use the column mapping on this page."
                  : "Connect a JSON, CSV, or XML address, or an API endpoint. Rows are stored as supplier products and used for sourcing. They are not published to the website from this import."}
            </p>
            {supplier.lastStockSyncError ? <p className="mb-3 text-sm text-red-700">{supplier.lastStockSyncError}</p> : null}
            <p className="mb-3 text-sm text-muted">Last successful sync {supplier.lastStockSyncAt ? formatDateTime(supplier.lastStockSyncAt) : "has not run"}. {supplier._count.feedItems} products imported.</p>
            <SupplierFeedForm {...form} />
          </Panel>
        }
        upload={
          <Panel className="p-5">
            <h2 className="font-semibold">Manual file upload</h2>
            <p className="mt-1 mb-4 text-sm text-muted">Upload a CSV, XML, or XLSX file. No feed address is required. A successful import makes this supplier active. The same supplier SKU, or otherwise the same barcode or manufacturer part number, updates the existing row.</p>
            <SupplierManualImport supplierId={supplier.id} savedMapping={savedMapping} />
          </Panel>
        }
        products={
          <Panel>
            {supplier.feedItems.length === 0 ? <p className="p-5 text-sm text-muted">No supplier products yet.</p> : (
              <table className="data-table">
                <thead><tr><th>Supplier SKU</th><th>Name</th><th>Brand</th><th>Part number</th><th>Cost</th><th>Stock</th><th>Last seen</th></tr></thead>
                <tbody>
                  {supplier.feedItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.supplierSku}</td>
                      <td>{item.name || "—"}</td>
                      <td>{item.brand || "—"}</td>
                      <td>{item.manufacturerPartNumber || "—"}</td>
                      <td>{item.costKnown ? formatCents(item.costCents, "ZAR") : "—"}</td>
                      <td>{item.stockKnown ? item.stockQty : "—"}</td>
                      <td>{item.lastSeenAt ? formatDateTime(item.lastSeenAt) : formatDateTime(item.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        }
        history={
          <Panel>
            {supplier.imports.length === 0 ? <p className="p-5 text-sm text-muted">No files have been imported.</p> : (
              <table className="data-table">
                <thead><tr><th>File</th><th>Uploaded</th><th>Read</th><th>Created</th><th>Updated</th><th>Rejected</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {supplier.imports.map((row) => (
                    <tr key={row.id}>
                      <td>{row.filename}</td>
                      <td>{formatDateTime(row.uploadedAt)}</td>
                      <td>{row.rowsRead}</td>
                      <td>{row.rowsCreated}</td>
                      <td>{row.rowsUpdated}</td>
                      <td>{row.rowsRejected}</td>
                      <td>{row.status === "COMPLETED" ? "Completed" : "Failed"}{row.errorMessage ? ` — ${row.errorMessage}` : ""}</td>
                      <td>{row.rowsRejected > 0 ? <a className="text-accent" href={`/api/suppliers/${supplier.id}/imports/${row.id}/errors`}>Download errors</a> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        }
        settings={
          <Panel className="p-5">
            <h2 className="font-semibold">Settings</h2>
            <p className="mt-1 mb-4 text-sm text-muted">Markup, VAT treatment, sync intervals, preference, and lead time for this supplier.</p>
            <SupplierFeedForm {...form} mode="settings" />
          </Panel>
        }
      />
    </div>
  );
}
