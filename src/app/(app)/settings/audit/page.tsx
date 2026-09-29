import Link from "next/link";
import { PageHeader, Pagination, Panel } from "@/components/ui";
import { ACTIVITY_LABELS } from "@/lib/labels";
import { firstParam, formatDateTime } from "@/lib/format";
import { countActivities, listActivities } from "@/services/activity-service";
import { requireSession } from "@/services/auth-service";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const page = Math.max(1, Number(firstParam((await searchParams).page) || "1") || 1);
  const pageSize = 25;
  const [items, total] = await Promise.all([
    listActivities({ workspaceId: session.workspace.id, take: pageSize, skip: (page - 1) * pageSize }),
    countActivities(session.workspace.id),
  ]);
  return (
    <div>
      <PageHeader title="Audit trail" description="Workspace activity recorded for compliance review." actions={<Link href="/settings" className="text-sm text-accent">Settings</Link>} />
      <Panel>
        {items.length === 0 ? <p className="p-5 text-sm text-muted">No activity recorded.</p> : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>When</th><th>Event</th><th>Summary</th><th>User</th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>{ACTIVITY_LABELS[item.type]}</td>
                    <td>{item.summary}</td>
                    <td>{item.actor?.name || "System"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageCount={Math.max(1, Math.ceil(total / pageSize))} path="/settings/audit" query={{}} />
      </Panel>
    </div>
  );
}
