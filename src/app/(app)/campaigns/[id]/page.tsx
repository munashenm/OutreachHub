import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteCampaignAction } from "@/actions/campaign-actions";
import { CampaignForm } from "@/components/campaign-form";
import { CampaignMembers } from "@/components/campaign-members";
import { ConfirmButton, Notice, PageHeader, Panel } from "@/components/ui";
import { firstParam, fullName } from "@/lib/format";
import { requireSession } from "@/services/auth-service";
import { getCampaign, listEligibleProspects } from "@/services/campaign-service";
import { suppressedEmailSet } from "@/services/suppression-service";

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const campaign = await getCampaign(session.workspace.id, id);
  if (!campaign) notFound();
  const candidates = await listEligibleProspects(session.workspace.id, campaign.id);
  const suppressed = await suppressedEmailSet(session.workspace.id, candidates.map((item) => item.email));
  const status = firstParam((await searchParams).status);
  return (
    <div className="space-y-4">
      <PageHeader
        title={campaign.name}
        description="Campaign settings are saved here. No messages are sent."
        actions={<ConfirmButton action={deleteCampaignAction.bind(null, campaign.id)} label="Delete" confirm="Delete this campaign and its prospect links?" />}
      />
      {status === "created" ? <Notice tone="success">Campaign created.</Notice> : null}
      <Panel className="p-5">
        <CampaignForm
          mode="edit"
          id={campaign.id}
          initial={{
            name: campaign.name,
            description: campaign.description ?? "",
            status: campaign.status,
            senderAccount: campaign.senderAccount ?? "",
            dailyLimit: String(campaign.dailyLimit),
            timezone: campaign.timezone,
            sendingStartTime: campaign.sendingStartTime,
            sendingEndTime: campaign.sendingEndTime,
          }}
        />
      </Panel>
      <Panel className="p-5">
        <CampaignMembers
          campaignId={campaign.id}
          suppressedEmails={[...suppressed]}
          members={campaign.prospects.map((item) => ({
            id: item.id,
            prospectId: item.prospectId,
            name: fullName(item.prospect.firstName, item.prospect.lastName),
            email: item.prospect.email,
            marketingStatus: item.prospect.marketingStatus,
          }))}
          candidates={candidates}
        />
      </Panel>
      <Link href="/campaigns" className="inline-block text-sm text-accent">Back to campaigns</Link>
    </div>
  );
}
