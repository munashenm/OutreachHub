import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteCampaignAction } from "@/actions/campaign-actions";
import { CampaignForm } from "@/components/campaign-form";
import { CampaignMembers } from "@/components/campaign-members";
import { SendCampaignButton } from "@/components/send-campaign-button";
import { ConfirmButton, Notice, PageHeader, Panel } from "@/components/ui";
import { replyRate } from "@/lib/delivery";
import { firstParam, fullName } from "@/lib/format";
import { requireSession } from "@/services/auth-service";
import { getCampaignDelivery } from "@/services/dashboard-service";
import { getCampaign, listEligibleProspects } from "@/services/campaign-service";
import { listMailboxes } from "@/services/mailbox-service";
import { suppressedEmailSet } from "@/services/suppression-service";
import { listTemplates } from "@/services/template-service";

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
  const [candidates, mailboxes, templates, delivery] = await Promise.all([
    listEligibleProspects(session.workspace.id, campaign.id),
    listMailboxes(session.workspace.id),
    listTemplates(session.workspace.id),
    getCampaignDelivery(session.workspace.id, campaign.id),
  ]);
  const suppressed = await suppressedEmailSet(session.workspace.id, candidates.map((item) => item.email));
  const rate = replyRate(delivery);
  const status = firstParam((await searchParams).status);
  return (
    <div className="space-y-4">
      <PageHeader
        title={campaign.name}
        description="Active campaigns send through the selected mailbox during the sending window."
        actions={<ConfirmButton action={deleteCampaignAction.bind(null, campaign.id)} label="Delete" confirm="Delete this campaign and its prospect links?" />}
      />
      {status === "created" ? <Notice tone="success">Campaign created.</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-4">
        <Panel className="p-4 text-sm"><p className="text-muted">Sent</p><p className="text-xl font-semibold">{delivery.sent}</p></Panel>
        <Panel className="p-4 text-sm"><p className="text-muted">Replies</p><p className="text-xl font-semibold">{delivery.replies}</p><p className="text-xs text-muted">{rate === null ? "No sends yet" : `${Math.round(rate * 100)}% of sent`}</p></Panel>
        <Panel className="p-4 text-sm"><p className="text-muted">Failed</p><p className="text-xl font-semibold">{delivery.failed}</p></Panel>
        <Panel className="p-4 text-sm"><p className="text-muted">Skipped</p><p className="text-xl font-semibold">{delivery.skipped}</p></Panel>
      </div>
      <Panel className="p-5">
        <SendCampaignButton campaignId={campaign.id} />
      </Panel>
      <Panel className="p-5">
        <CampaignForm
          mode="edit"
          id={campaign.id}
          mailboxes={mailboxes}
          templates={templates.map((template) => ({ id: template.id, name: template.name }))}
          initial={{
            name: campaign.name,
            description: campaign.description ?? "",
            status: campaign.status,
            mailboxId: campaign.mailboxId ?? "",
            templateId: campaign.templateId ?? "",
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
