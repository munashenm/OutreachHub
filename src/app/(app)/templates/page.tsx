import Link from "next/link";
import { EmptyState, Notice, PageHeader, Panel, buttonPrimary } from "@/components/ui";
import { firstParam } from "@/lib/format";
import { requireSession } from "@/services/auth-service";
import { listTemplates } from "@/services/template-service";

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const templates = await listTemplates(session.workspace.id);
  const status = firstParam((await searchParams).status);
  return (
    <div>
      <PageHeader
        title="Templates"
        description="Reusable messages for campaigns. Draft one with AI, then review the merge tags before saving."
        actions={<Link className={buttonPrimary} href="/templates/new">New template</Link>}
      />
      {status === "deleted" ? <Notice tone="success">Template deleted.</Notice> : null}
      <Panel>
        {templates.length === 0 ? (
          <div className="p-4"><EmptyState title="No templates yet" description="Create a template before activating a campaign." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Subject</th></tr></thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id}>
                    <td><Link className="font-medium hover:underline" href={`/templates/${template.id}/edit`}>{template.name}</Link></td>
                    <td>{template.subject}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
