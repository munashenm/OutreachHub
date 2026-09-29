import Link from "next/link";
import { removeSuppressionAction } from "@/actions/settings-actions";
import { SuppressionForm } from "@/components/suppression-form";
import { ConfirmButton, PageHeader, Panel } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireSession } from "@/services/auth-service";
import { listCampaignOptions } from "@/services/campaign-service";
import { listSuppressions } from "@/services/suppression-service";

export default async function SuppressionPage() {
  const session = await requireSession();
  const [rows, campaigns] = await Promise.all([
    listSuppressions(session.workspace.id),
    listCampaignOptions(session.workspace.id),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Suppression list"
        description="Opted-out and blocked prospects are added here automatically. Campaigns cannot send marketing to these addresses."
        actions={<Link href="/settings" className="text-sm text-accent">Settings</Link>}
      />
      <Panel className="p-5">
        <SuppressionForm campaigns={campaigns} />
      </Panel>
      <Panel>
        {rows.length === 0 ? <p className="p-5 text-sm text-muted">No suppressed addresses.</p> : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Email</th><th>Reason</th><th>Source</th><th>Campaign</th><th>User</th><th>Date</th><th></th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.email}</td>
                    <td>{row.reason}</td>
                    <td>{row.source || "—"}</td>
                    <td>{row.campaign?.name || "—"}</td>
                    <td>{row.user?.name || "—"}</td>
                    <td>{formatDateTime(row.createdAt)}</td>
                    <td><ConfirmButton action={removeSuppressionAction.bind(null, row.id)} label="Remove" confirm={`Remove ${row.email} from the suppression list?`} variant="secondary" /></td>
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
