import Link from "next/link";
import { notFound } from "next/navigation";
import { ProspectForm } from "@/components/prospect-form";
import { PageHeader, Panel } from "@/components/ui";
import { requireSession } from "@/services/auth-service";
import { listCompanyOptions } from "@/services/company-service";
import { getProspect } from "@/services/prospect-service";

export default async function EditProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const [prospect, companies] = await Promise.all([
    getProspect(session.workspace.id, id),
    listCompanyOptions(session.workspace.id),
  ]);
  if (!prospect) notFound();
  return (
    <div>
      <PageHeader title="Edit prospect" actions={<Link href={`/prospects/${prospect.id}`} className="text-sm text-accent">Back</Link>} />
      <Panel className="p-5">
        <ProspectForm
          mode="edit"
          id={prospect.id}
          companies={companies}
          initial={{
            firstName: prospect.firstName,
            lastName: prospect.lastName,
            jobTitle: prospect.jobTitle ?? "",
            email: prospect.email,
            phone: prospect.phone ?? "",
            companyId: prospect.companyId ?? "",
            website: prospect.website ?? "",
            industry: prospect.industry ?? "",
            country: prospect.country ?? "",
            province: prospect.province ?? "",
            city: prospect.city ?? "",
            source: prospect.source ?? "",
            linkedinUrl: prospect.linkedinUrl ?? "",
            notes: prospect.notes ?? "",
            leadStatus: prospect.leadStatus,
            marketingStatus: prospect.marketingStatus,
          }}
        />
      </Panel>
    </div>
  );
}
