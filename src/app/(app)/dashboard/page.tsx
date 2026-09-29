import Link from "next/link";
import { EmptyState, PageHeader, Panel, StatCard } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { CAMPAIGN_STATUS_LABELS, LEAD_STATUS_LABELS } from "@/lib/labels";
import { requireSession } from "@/services/auth-service";
import { getDashboard } from "@/services/dashboard-service";

export default async function DashboardPage() {
  const session = await requireSession();
  const data = await getDashboard(session.workspace.id);
  const maxPipeline = Math.max(...data.pipeline.map((item) => item.count), 1);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={session.workspace.isDemo ? "This workspace is marked as demo data." : "Live counts from this workspace. No sample metrics are invented."}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total prospects" value={data.totalProspects} hint="People stored in this workspace." />
        <StatCard label="Active campaigns" value={data.activeCampaigns} hint="Campaigns with status Active." />
        <StatCard label="Emails sent" value={data.emailsSent} hint="Outbound messages recorded. Sending is not enabled yet." />
        <StatCard label="Replies" value={data.replies} hint="Inbound messages recorded. Inbox sync is not enabled yet." />
        <StatCard label="Interested leads" value={data.interestedLeads} hint="Qualified, quoting, negotiating, or won." />
        <StatCard label="Quotes requested" value={data.quotesRequested} hint="Prospects currently at quote requested." />
        <StatCard label="Won opportunities" value={data.wonOpportunities} hint="Prospects currently marked won." />
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
          <p className="mt-1 text-xs text-muted">Prospect membership only. Open and reply rates are not shown because email sending is not enabled.</p>
          {data.campaigns.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No campaigns yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {data.campaigns.map((campaign) => (
                <li key={campaign.id} className="flex items-center justify-between py-3 text-sm">
                  <Link href={`/campaigns/${campaign.id}`} className="font-medium hover:underline">{campaign.name}</Link>
                  <span className="text-muted">{CAMPAIGN_STATUS_LABELS[campaign.status]} · {campaign._count.prospects} prospects</span>
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
