import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteTemplateAction } from "@/actions/template-actions";
import { TemplateForm } from "@/components/template-form";
import { ConfirmButton, Notice, PageHeader, Panel } from "@/components/ui";
import { firstParam } from "@/lib/format";
import { requireSession } from "@/services/auth-service";
import { getTemplate } from "@/services/template-service";

export default async function EditTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const template = await getTemplate(session.workspace.id, id);
  if (!template) notFound();
  const status = firstParam((await searchParams).status);
  return (
    <div>
      <PageHeader
        title={template.name}
        actions={
          <>
            <Link href="/templates" className="text-sm text-accent">Back</Link>
            <ConfirmButton action={deleteTemplateAction.bind(null, template.id)} label="Delete" confirm="Delete this template? Campaigns using it will keep their other settings." />
          </>
        }
      />
      {status === "created" ? <Notice tone="success">Template created.</Notice> : null}
      <Panel className="p-5">
        <TemplateForm mode="edit" id={template.id} initial={{ name: template.name, subject: template.subject, body: template.body, htmlBody: template.htmlBody }} />
      </Panel>
    </div>
  );
}
