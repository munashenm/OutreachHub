import Link from "next/link";
import { EmptyState, PageHeader, Panel, StatCard } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { CAMPAIGN_STATUS_LABELS, LEAD_STATUS_LABELS } from "@/lib/labels";
import { isShortStock } from "@/lib/stock";
import { requireSession } from "@/services/auth-service";
import { getDashboard } from "@/services/dashboard-service";
import { listProducts } from "@/services/product-service";
import { reservedByProduct, supplierTrackedProductIds } from "@/services/stock-sync-service";

export default async function DashboardPage() {
  const session = await requireSession();
  const [data, products, reserved, tracked] = await Promise.all([
    getDashboard(session.workspace.id),
    listProducts(session.workspace.id),
    reservedByProduct(session.workspace.id),
    supplierTrackedProductIds(session.workspace.id),
  ]);
  const shortStock = products.filter((product) => isShortStock(product.stockOnHand, reserved.get(product.id) ?? 0, tracked.has(product.id))).length;
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
        <StatCard label="Campaign emails sent today" value={data.campaignSentToday} hint="Promotional sends since midnight in Johannesburg." />
        <StatCard label="Interested or responded" value={data.respondedLeads} hint="Responded, qualified, quoting, negotiating, or won." />
        <StatCard label="Quotes requested" value={data.quotesRequested} hint="Prospects currently at quote requested." />
        <StatCard label="Active campaigns" value={data.activeCampaigns} hint="Campaigns with status Active." />
        <StatCard label="Mailbox" value={data.mailbox ? 1 : 0} hint={data.mailbox ? `${data.mailbox.email} · ${data.mailbox.connectionStatus}${data.mailbox.lastError ? ` · ${data.mailbox.lastError}` : ""}` : "No Google mailbox connected."} />
        <StatCard label="Short stock" value={shortStock} hint="Tracked products with nothing left after open quotations and open website orders." />
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
          <h2 className="text-base font-semibold">Campaign performance</h2>
          <p className="mt-1 text-xs text-muted">Prospect membership. Sent and reply counts live on the dashboard cards.</p>
          {data.campaigns.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No campaigns yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {data.campaigns.map((campaign) => (
                <li key={campaign.id} className="flex items-center justify-between py-3 text-sm">
                  <Link href={`/campaigns/${campaign.id}`} className="font-medium hover:underline">{campaign.name}</Link>
                  <span className="text-muted">{CAMPAIGN_STATUS_LABELS[campaign.status]} · {campaign._count.prospects} prospects · {data.deliveryByCampaign[campaign.id]?.sent ?? 0} sent · {data.deliveryByCampaign[campaign.id]?.replies ?? 0} replies</span>
                </li>
              ))}
            </ul>
          )}
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
