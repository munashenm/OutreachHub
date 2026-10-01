import Link from "next/link";
import { PageHeader, Panel, StatCard } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireSession } from "@/services/auth-service";
import { getAutomationReport } from "@/services/rfq-automation-service";

export default async function AutomationPage() {
  const session = await requireSession();
  const report = await getAutomationReport(session.workspace.id);
  const staleFeeds = report.suppliers.filter((supplier) => supplier.feedEnabled && supplier.lastStockSyncError).length;
  return (
    <div>
      <PageHeader title="Automation" description="Inbound mail, quotations, supplier feeds, and the website stay in separate steps. A failed step is recorded and does not repeat a send." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Gmail last sync" value={report.mailbox?.lastInboundSyncAt ? 1 : 0} hint={report.mailbox ? `${report.mailbox.email} · ${report.mailbox.lastInboundSyncAt ? formatDateTime(report.mailbox.lastInboundSyncAt) : "not yet"}${report.mailbox.lastError ? ` · ${report.mailbox.lastError}` : ""}` : "No Google mailbox connected."} />
        <StatCard label="Inbound messages" value={report.inbound} hint="Messages stored from the mailbox." />
        <StatCard label="Acknowledgements sent" value={report.acknowledgements} hint="One acknowledgement is kept per RFQ." />
        <StatCard label="Replies needing review" value={report.needsReplyReview} hint="Reviewing and negotiation RFQs." />
        <StatCard label="New RFQs" value={report.statusCount("NEW")} hint="Opened and not yet reviewed." />
        <StatCard label="Ready for approval" value={report.statusCount("READY_TO_QUOTE")} hint="Quoted, not sent automatically." />
        <StatCard label="Quotes sent" value={report.statusCount("QUOTE_SENT")} hint="Sent in the customer thread." />
        <StatCard label="Won" value={report.statusCount("WON")} hint="Accepted quotation or purchase order." />
        <StatCard label="Lost" value={report.statusCount("LOST")} hint="Customer is not interested." />
        <StatCard label="Negotiation" value={report.statusCount("NEGOTIATION")} hint="Price, substitute, or delivery changes wait for approval." />
        <StatCard label="Feed failures" value={staleFeeds} hint="Enabled suppliers whose last feed read failed." />
        <StatCard label="New product review" value={report.reviewCount("NEW_PRODUCT_REVIEW_REQUIRED")} hint="Held off the website." />
        <StatCard label="Image review" value={report.reviewCount("IMAGE_REVIEW_REQUIRED")} hint="No verified image, so not published." />
        <StatCard label="Ready to publish" value={report.reviewCount("PUBLISH")} hint="Passed the duplicate, price, content, and image checks." />
        <StatCard label="Store last sync" value={report.store?.storeLastSyncAt ? 1 : 0} hint={report.store?.storeLastSyncAt ? formatDateTime(report.store.storeLastSyncAt) : "No website sync yet."} />
        <StatCard label="Store errors" value={report.store?.storeLastError ? 1 : 0} hint={report.store?.storeLastError || "No store error is stored."} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <h2 className="font-semibold">Suppliers</h2>
          {report.suppliers.length === 0 ? <p className="mt-3 text-sm text-muted">No suppliers yet.</p> : (
            <ul className="mt-3 space-y-3 text-sm">
              {report.suppliers.map((supplier) => (
                <li key={supplier.id}>
                  <Link className="font-medium text-accent" href={`/suppliers/${supplier.id}`}>{supplier.name}</Link>
                  <p className="text-muted">Stock {supplier.lastStockSyncAt ? formatDateTime(supplier.lastStockSyncAt) : "not synced"} · Price {supplier.lastPriceSyncAt ? formatDateTime(supplier.lastPriceSyncAt) : "not synced"} · Catalogue {supplier.lastCatalogueSyncAt ? formatDateTime(supplier.lastCatalogueSyncAt) : "not synced"}</p>
                  {supplier.lastStockSyncError ? <p className="text-red-700">{supplier.lastStockSyncError}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel className="p-5">
          <h2 className="font-semibold">Catalogue actions</h2>
          {report.scans.length === 0 ? <p className="mt-3 text-sm text-muted">No catalogue audit entries yet.</p> : (
            <ul className="mt-3 space-y-3 text-sm">
              {report.scans.map((item) => (
                <li key={item.id}>
                  <p>{item.summary}</p>
                  <p className="text-xs text-muted">{item.action} · {formatDateTime(item.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-sm"><Link className="text-accent" href="/catalogue">Open the catalogue baseline</Link></p>
        </Panel>
      </div>
    </div>
  );
}
