import Link from "next/link";
import { CompanyForm } from "@/components/company-form";
import { PageHeader, Panel } from "@/components/ui";

export default function NewCompanyPage() {
  return (
    <div>
      <PageHeader title="New company" actions={<Link href="/companies" className="text-sm text-accent">Back</Link>} />
      <Panel className="p-5"><CompanyForm mode="create" /></Panel>
    </div>
  );
}
