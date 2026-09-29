import { PageHeader, Panel } from "@/components/ui";
import { LEAD_STATUS_LABELS, MARKETING_STATUS_LABELS } from "@/lib/labels";
import { requireSession } from "@/services/auth-service";
import { getDashboard } from "@/services/dashboard-service";

export default async function AnalyticsPage() {
  const session = await requireSession();
  const data = await getDashboard(session.workspace.id);
  const max = Math.max(...data.pipeline.map((item) => item.count), 1);
  return (
    <div>
      <PageHeader title="Analytics" description="Counts from this workspace. Delivery and reply rates are omitted until sending exists." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <h2 className="font-semibold">Pipeline</h2>
          <ul className="mt-4 space-y-3">
            {data.pipeline.map((item) => (
              <li key={item.status} className="grid grid-cols-[9rem_1fr_2rem] items-center gap-3 text-sm">
                <span>{LEAD_STATUS_LABELS[item.status]}</span>
                <span className="h-2 rounded-full bg-slate-100"><span className="block h-2 rounded-full bg-accent" style={{ width: `${(item.count / max) * 100}%` }} /></span>
                <span className="text-right text-muted">{item.count}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel className="p-5">
          <h2 className="font-semibold">Marketing status</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {data.marketingGroups.length === 0 ? <li className="text-muted">No prospects yet.</li> : null}
            {data.marketingGroups.map((group) => (
              <li key={group.marketingStatus} className="flex justify-between">
                <span>{MARKETING_STATUS_LABELS[group.marketingStatus]}</span>
                <span className="text-muted">{group._count._all}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
