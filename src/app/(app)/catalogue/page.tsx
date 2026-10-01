import Link from "next/link";
import { CatalogueReviewActions } from "@/components/catalogue-review-actions";
import { ReadCatalogueButton } from "@/components/catalogue-read-button";
import { EmptyState, PageHeader, Pagination, Panel, StatCard } from "@/components/ui";
import { firstParam, formatDateTime, withQuery } from "@/lib/format";
import { recommendedCatalogueAction } from "@/lib/catalogue-reconcile";
import { formatCents } from "@/lib/quote";
import { requireSession } from "@/services/auth-service";
import { getCatalogueReport } from "@/services/catalogue-service";
import { getStoreConnection } from "@/services/stock-sync-service";

const VIEWS = [
  ["all", "All"],
  ["duplicates", "Potential duplicates"],
  ["images", "Missing images"],
  ["identity", "Missing SKU and part number"],
  ["price", "Without price"],
  ["stock", "Zero stock"],
  ["review", "Needs review"],
  ["matched", "Matched"],
  ["ready", "Ready for supplier matching"],
] as const;

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const view = VIEWS.some(([id]) => id === firstParam(params.view)) ? firstParam(params.view) : "all";
  const page = Math.max(1, Number(firstParam(params.page)) || 1);
  const [report, store] = await Promise.all([
    getCatalogueReport(session.workspace.id, view, page),
    getStoreConnection(session.workspace.id),
  ]);
  const stats = report.stats;
  const query = { view: view === "all" ? "" : view };
  return (
    <div>
      <PageHeader
        title="Catalogue reconciliation"
        description="The Urban Focus website is the catalogue baseline. This read stores a copy for matching and does not change prices, stock, images, or products on the website."
        actions={<ReadCatalogueButton connected={Boolean(store?.connected)} />}
      />
      <Panel className="mb-4 p-4 text-sm text-muted">
        <p>Update store and publish stay off until this report is reviewed. Find image marks a product for review and does not download a picture. Supplier catalogues are not imported yet, so stock and price differences against a supplier are not available.</p>
        {report.running ? <p className="mt-2">A read is in progress: {report.running.imported.toLocaleString("en-GB")} of {(report.running.total ?? 0).toLocaleString("en-GB")} products.</p> : null}
        {report.scan?.finishedAt ? <p className="mt-2">Last read: {formatDateTime(report.scan.finishedAt)}. The website was not changed.</p> : null}
      </Panel>
      {stats ? (
        <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Existing store products" value={stats.total} hint={`${stats.withSku} with a SKU. ${stats.withoutSku} without a SKU.`} />
          <StatCard label="Duplicate SKUs" value={stats.duplicateSkuGroups} hint={`${stats.duplicateMpnGroups} duplicate part numbers, ${stats.duplicateBarcodeGroups} barcodes, and ${stats.duplicateBrandModelGroups} brand and model pairs.`} />
          <StatCard label="Missing images" value={stats.missingImages} hint={`${stats.withImages} products already have an image. No image was downloaded.`} />
          <StatCard label="Ready for supplier matching" value={stats.readyForSupplierMatching} hint={`${stats.withoutPrice} without a price. ${stats.zeroStock} with zero stock. ${stats.needsReview} need review.`} />
        </div>
      ) : null}
      {stats ? (
        <Panel className="mb-4 p-4 text-sm">
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>With a manufacturer part number: {stats.withMpn}</div>
            <div>With a barcode: {stats.withBarcode}</div>
            <div>Matched to a staff catalogue product: {stats.matchedToCatalogue}</div>
            <div>New products created: 0</div>
            <div>Stock differences: not compared yet</div>
            <div>Price differences: not compared yet</div>
          </dl>
        </Panel>
      ) : null}
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        {VIEWS.map(([id, label]) => (
          <Link key={id} className={id === view ? "font-semibold text-ink" : "text-accent"} href={withQuery("/catalogue", query, { view: id === "all" ? "" : id, page: "" })}>
            {label}
          </Link>
        ))}
      </div>
      <Panel>
        {report.items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={report.scan ? "No products in this view" : "No store baseline yet"}
              description={store?.connected ? "Read the store catalogue. The website is not changed." : "Connect the store under Settings, then read the catalogue."}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Store value</th>
                  <th>Supplier value</th>
                  <th>Recommended action</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {report.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted">SKU {item.sku || "—"} · Part {item.manufacturerPartNumber || "—"} · Barcode {item.barcode || "—"}</p>
                      <p className="text-xs text-muted">{item.brand || "No brand"} · Store id {item.storeProductId} · {item.published ? "Published" : "Unpublished"} · {item.reviewStatus}</p>
                    </td>
                    <td>
                      <p>{item.unitPriceCents > 0 ? formatCents(item.unitPriceCents, item.currency) : "No price"}{item.salePriceCents != null ? ` · sale ${formatCents(item.salePriceCents, item.currency)}` : ""}</p>
                      <p className="text-xs text-muted">{item.stockQuantity} in stock · {item.imageUrls.length} image{item.imageUrls.length === 1 ? "" : "s"}</p>
                      {item.url ? <a className="text-xs text-accent" href={item.url}>Website page</a> : null}
                    </td>
                    <td className="text-sm text-muted">Not compared yet</td>
                    <td className="max-w-xs text-sm">{recommendedCatalogueAction({ duplicateKinds: item.duplicateKinds, skuKey: item.skuKey, mpnKey: item.mpnKey, imageCount: item.imageUrls.length, unitPriceCents: item.unitPriceCents })}</td>
                    <td><CatalogueReviewActions itemId={item.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={report.page} pageCount={report.pageCount} path="/catalogue" query={query} />
          </div>
        )}
      </Panel>
      {report.audits.length > 0 ? (
        <Panel className="mt-4 p-4">
          <h2 className="font-semibold">Catalogue audit</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {report.audits.map((audit) => (
              <li key={audit.id}>{formatDateTime(audit.createdAt)} · {audit.summary}</li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
