import { PageHeader, Panel } from "@/components/ui";
import { replyRate } from "@/lib/delivery";
import { LEAD_STATUS_LABELS, MARKETING_STATUS_LABELS } from "@/lib/labels";
import { requireSession } from "@/services/auth-service";
import { getDashboard } from "@/services/dashboard-service";
import { salesFunnelReport } from "@/services/sales-response-service";

export default async function AnalyticsPage() {
  const session = await requireSession();
  const data = await getDashboard(session.workspace.id);
  const funnel = await salesFunnelReport(session.workspace.id);
  const max = Math.max(...data.pipeline.map((item) => item.count), 1);
  const rate = replyRate(data.delivery);
  return (
    <div>
      <PageHeader title="Analytics" description="Counts from this workspace. Reply rate uses stored Gmail replies divided by messages sent." />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Panel className="p-4 text-sm"><p className="text-muted">Enquiries</p><p className="text-xl font-semibold">{funnel.enquiry}</p></Panel>
        <Panel className="p-4 text-sm"><p className="text-muted">RFQs</p><p className="text-xl font-semibold">{funnel.rfq}</p></Panel>
        <Panel className="p-4 text-sm"><p className="text-muted">Quoted</p><p className="text-xl font-semibold">{funnel.quoted}</p><p className="text-muted">ZAR {(funnel.quotationValueCents / 100).toFixed(2)}</p></Panel>
        <Panel className="p-4 text-sm"><p className="text-muted">Replied</p><p className="text-xl font-semibold">{funnel.replied}</p><p className="text-muted">{funnel.averageResponseMinutes == null ? "No response time yet" : `${funnel.averageResponseMinutes} min average`}</p></Panel>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Panel className="p-4 text-sm"><p className="text-muted">Revised</p><p className="text-xl font-semibold">{funnel.revised}</p></Panel>
        <Panel className="p-4 text-sm"><p className="text-muted">Accepted</p><p className="text-xl font-semibold">{funnel.accepted}</p><p className="text-muted">{funnel.conversionPercent == null ? "No conversion yet" : `${funnel.conversionPercent}% conversion`}</p></Panel>
        <Panel className="p-4 text-sm"><p className="text-muted">Lost</p><p className="text-xl font-semibold">{funnel.lost}</p><p className="text-muted">{funnel.averageMarginPercent == null ? "No margin yet" : `${funnel.averageMarginPercent}% average margin`}</p></Panel>
        <Panel className="p-4 text-sm">
          <p className="text-muted">Reasons lost</p>
          {funnel.lostReasons.length === 0 ? <p className="mt-2 text-muted">None recorded</p> : (
            <ul className="mt-2 space-y-1">
              {funnel.lostReasons.map((item) => <li key={item.reason} className="flex justify-between"><span>{item.reason}</span><span>{item.total}</span></li>)}
            </ul>
          )}
        </Panel>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Panel className="p-4 text-sm"><p className="text-muted">Sent</p><p className="text-xl font-semibold">{data.delivery.sent}</p></Panel>
        <Panel className="p-4 text-sm"><p className="text-muted">Replies</p><p className="text-xl font-semibold">{data.delivery.replies}</p></Panel>
        <Panel className="p-4 text-sm"><p className="text-muted">Reply rate</p><p className="text-xl font-semibold">{rate === null ? "—" : `${Math.round(rate * 100)}%`}</p></Panel>
        <Panel className="p-4 text-sm"><p className="text-muted">Failed</p><p className="text-xl font-semibold">{data.delivery.failed}</p></Panel>
      </div>
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
