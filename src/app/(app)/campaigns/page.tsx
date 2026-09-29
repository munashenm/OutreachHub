import Link from "next/link";
import { EmptyState, Notice, PageHeader, Panel, buttonPrimary } from "@/components/ui";
import { firstParam, formatDateTime } from "@/lib/format";
import { CAMPAIGN_STATUS_LABELS } from "@/lib/labels";
import { requireSession } from "@/services/auth-service";
import { listCampaigns } from "@/services/campaign-service";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const campaigns = await listCampaigns(session.workspace.id);
  const status = firstParam((await searchParams).status);
  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Plan campaigns, attach a mailbox and template, then send to eligible prospects."
        actions={<Link className={buttonPrimary} href="/campaigns/new">New campaign</Link>}
      />
      {status === "deleted" ? <Notice tone="success">Campaign deleted.</Notice> : null}
      <Panel>
        {campaigns.length === 0 ? (
          <div className="p-4"><EmptyState title="No campaigns yet" description="Create a draft campaign and add prospects whose marketing status allows contact." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Campaign</th><th>Status</th><th>Prospects</th><th>Window</th><th>Updated</th></tr></thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td><Link className="font-medium hover:underline" href={`/campaigns/${campaign.id}`}>{campaign.name}</Link></td>
                    <td>{CAMPAIGN_STATUS_LABELS[campaign.status]}</td>
                    <td>{campaign._count.prospects}</td>
                    <td>{campaign.sendingStartTime}–{campaign.sendingEndTime} {campaign.timezone}</td>
                    <td>{formatDateTime(campaign.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
