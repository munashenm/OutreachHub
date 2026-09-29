import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyForm } from "@/components/company-form";
import { PageHeader, Panel } from "@/components/ui";
import { requireSession } from "@/services/auth-service";
import { getCompany } from "@/services/company-service";

export default async function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const company = await getCompany(session.workspace.id, id);
  if (!company) notFound();
  return (
    <div>
      <PageHeader title="Edit company" actions={<Link href={`/companies/${company.id}`} className="text-sm text-accent">Back</Link>} />
      <Panel className="p-5">
        <CompanyForm
          mode="edit"
          id={company.id}
          initial={{
            companyName: company.companyName,
            website: company.website ?? "",
            industry: company.industry ?? "",
            companySize: company.companySize ?? "",
            phone: company.phone ?? "",
            country: company.country ?? "",
            province: company.province ?? "",
            city: company.city ?? "",
            notes: company.notes ?? "",
          }}
        />
      </Panel>
    </div>
  );
}
