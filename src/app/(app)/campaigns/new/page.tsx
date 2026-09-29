import Link from "next/link";
import { CampaignForm } from "@/components/campaign-form";
import { PageHeader, Panel } from "@/components/ui";
import { requireSession } from "@/services/auth-service";
import { listMailboxes } from "@/services/mailbox-service";
import { listTemplates } from "@/services/template-service";

export default async function NewCampaignPage() {
  const session = await requireSession();
  const [mailboxes, templates] = await Promise.all([
    listMailboxes(session.workspace.id),
    listTemplates(session.workspace.id),
  ]);
  return (
    <div>
      <PageHeader title="New campaign" actions={<Link href="/campaigns" className="text-sm text-accent">Back</Link>} />
      <Panel className="p-5">
        <CampaignForm mode="create" mailboxes={mailboxes} templates={templates.map((template) => ({ id: template.id, name: template.name }))} />
      </Panel>
    </div>
  );
}
