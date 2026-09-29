import Link from "next/link";
import { TemplateForm } from "@/components/template-form";
import { PageHeader, Panel } from "@/components/ui";

export default function NewTemplatePage() {
  return (
    <div>
      <PageHeader title="New template" actions={<Link href="/templates" className="text-sm text-accent">Back</Link>} />
      <Panel className="p-5"><TemplateForm mode="create" /></Panel>
    </div>
  );
}
