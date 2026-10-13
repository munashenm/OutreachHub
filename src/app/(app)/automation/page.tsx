import { PageHeader, Panel, StatCard } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireSession } from "@/services/auth-service";
import { getAutomationReport } from "@/services/rfq-automation-service";

export default async function AutomationPage() {
  const session = await requireSession();
  const report = await getAutomationReport(session.workspace.id);
  return (
    <div>
      <PageHeader title="Automation" description="Inbound mail is read, quoted from the Urban Focus catalogue or online research, and answered in the same thread. A failed step is recorded and does not repeat a send." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Gmail last sync" value={report.mailbox?.lastInboundSyncAt ? 1 : 0} hint={report.mailbox ? `${report.mailbox.email} · ${report.mailbox.lastInboundSyncAt ? formatDateTime(report.mailbox.lastInboundSyncAt) : "not yet"}${report.mailbox.lastError ? ` · ${report.mailbox.lastError}` : ""}` : "No Google mailbox connected."} />
        <StatCard label="Inbound messages" value={report.inbound} hint="Messages stored from the mailbox." />
        <StatCard label="Acknowledgements sent" value={report.acknowledgements} hint="One acknowledgement is kept per RFQ." />
        <StatCard label="Replies needing review" value={report.needsReplyReview} hint="Reviewing and negotiation RFQs." />
        <StatCard label="New RFQs" value={report.statusCount("NEW") + report.statusCount("RECEIVED") + report.statusCount("PARSED")} hint="Opened and not yet matched." />
        <StatCard label="Ready for approval" value={report.statusCount("READY_TO_QUOTE") + report.statusCount("QUOTE_READY")} hint="Quoted, not sent automatically." />
        <StatCard label="Quotes sent" value={report.statusCount("QUOTE_SENT") + report.statusCount("SENT")} hint="Sent in the customer thread." />
        <StatCard label="Won" value={report.statusCount("WON")} hint="Accepted quotation or purchase order." />
        <StatCard label="Lost" value={report.statusCount("LOST")} hint="Customer is not interested." />
        <StatCard label="Negotiation" value={report.statusCount("NEGOTIATION")} hint="Price, substitute, or delivery changes wait for approval." />
        <StatCard label="Urban Focus" value={report.store?.storeLastError ? 0 : 1} hint={report.store?.storeLastError || "Product search uses the Urban Focus API."} />
      </div>
      <Panel className="mt-6 p-5">
        <h2 className="font-semibold">What this workspace does</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted">
          <li>Gmail receives and organises business enquiries.</li>
          <li>Each RFQ is read for products, specifications, and quantities.</li>
          <li>Products are searched on Urban Focus. Anything missing is researched online.</li>
          <li>A match is priced from the verified Urban Focus cost, then a branded quotation can be emailed and followed up.</li>
        </ul>
      </Panel>
    </div>
  );
}
