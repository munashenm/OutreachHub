import { EmptyState, PageHeader, Panel, StatCard } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { LEAD_STATUS_LABELS } from "@/lib/labels";
import { requireSession } from "@/services/auth-service";
import { getDashboard } from "@/services/dashboard-service";
import { getStoreConnection } from "@/services/stock-sync-service";

export default async function DashboardPage() {
  const session = await requireSession();
  const [data, store] = await Promise.all([
    getDashboard(session.workspace.id),
    getStoreConnection(session.workspace.id),
  ]);
  const mailboxHint = data.mailbox
    ? `${data.mailbox.email} · last inbound ${data.mailbox.lastInboundSyncAt ? formatDateTime(data.mailbox.lastInboundSyncAt) : "not yet"}${data.mailbox.lastError ? ` · ${data.mailbox.lastError}` : ""}`
    : "No Google mailbox connected.";
  const storeHint = store?.connected
    ? store.lastError ? store.lastError : "Urban Focus API is connected for product search."
    : "Urban Focus API is not connected.";
  const maxPipeline = Math.max(...data.pipeline.map((item) => item.count), 1);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={session.workspace.isDemo ? "This workspace is marked as demo data." : "Live counts from this workspace. No sample metrics are invented."}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="New enquiries" value={data.newEnquiries} hint="Inbound mail still uncategorised or marked as a new enquiry." />
        <StatCard label="RFQs awaiting review" value={data.rfqsAwaitingReview} hint="RFQs at New or Reviewing." />
        <StatCard label="Replies today" value={data.repliesToday} hint="Inbound messages since midnight in Johannesburg." />
        <StatCard label="Quotes waiting to send" value={data.quotesRequested} hint="Prepared quotations stay in review until someone sends them." />
        <StatCard label="Interested or responded" value={data.respondedLeads} hint="Responded, qualified, quoting, negotiating, or won." />
        <StatCard label="Mailbox" value={data.mailbox ? 1 : 0} hint={mailboxHint} />
        <StatCard label="Urban Focus" value={store?.connected ? 1 : 0} hint={storeHint} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <h2 className="text-base font-semibold">Recent activity</h2>
          {data.recentActivity.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No activity yet. Create a prospect or company to start the audit trail.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {data.recentActivity.map((item) => (
                <li key={item.id} className="text-sm">
                  <p>{item.summary}</p>
                  <p className="text-xs text-muted">{item.actor?.name ?? "System"} · {formatDateTime(item.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel className="p-5">
          <h2 className="text-base font-semibold">Quotations</h2>
          <p className="mt-3 text-sm text-muted">Each RFQ is matched to Urban Focus. Missing products are researched online. A complete quotation stays in review until you send it.</p>
        </Panel>
      </div>
      <Panel className="mt-4 p-5">
        <h2 className="text-base font-semibold">Pipeline overview</h2>
        {data.totalProspects === 0 ? (
          <div className="mt-4">
            <EmptyState title="No prospects yet" description="Add a prospect or import a CSV. The pipeline fills from real records only." />
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {data.pipeline.map((item) => (
              <li key={item.status} className="grid grid-cols-[9rem_1fr_2rem] items-center gap-3 text-sm">
                <span>{LEAD_STATUS_LABELS[item.status]}</span>
                <span className="h-2 rounded-full bg-slate-100">
                  <span className="block h-2 rounded-full bg-accent" style={{ width: `${(item.count / maxPipeline) * 100}%` }} />
                </span>
                <span className="text-right text-muted">{item.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
