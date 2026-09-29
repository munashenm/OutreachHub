import Link from "next/link";
import { CampaignForm } from "@/components/campaign-form";
import { PageHeader, Panel } from "@/components/ui";

export default function NewCampaignPage() {
  return (
    <div>
      <PageHeader title="New campaign" actions={<Link href="/campaigns" className="text-sm text-accent">Back</Link>} />
      <Panel className="p-5"><CampaignForm mode="create" /></Panel>
    </div>
  );
}
