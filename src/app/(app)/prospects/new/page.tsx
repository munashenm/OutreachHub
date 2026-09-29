import Link from "next/link";
import { ProspectForm } from "@/components/prospect-form";
import { PageHeader, Panel } from "@/components/ui";
import { requireSession } from "@/services/auth-service";
import { listCompanyOptions } from "@/services/company-service";

export default async function NewProspectPage() {
  const session = await requireSession();
  const companies = await listCompanyOptions(session.workspace.id);
  return (
    <div>
      <PageHeader title="New prospect" description="Duplicate emails in this workspace are rejected." actions={<Link href="/prospects" className="text-sm text-accent">Back</Link>} />
      <Panel className="p-5">
        <ProspectForm mode="create" companies={companies} />
      </Panel>
    </div>
  );
}
