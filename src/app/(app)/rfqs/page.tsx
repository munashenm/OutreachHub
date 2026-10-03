import Link from "next/link";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { formatDateTime, fullName } from "@/lib/format";
import { RFQ_STATUS_LABELS, type RfqStatus } from "@/lib/labels";
import { requireSession } from "@/services/auth-service";
import { listRfqs } from "@/services/rfq-service";

export default async function RfqsPage() {
  const session = await requireSession();
  const rfqs = await listRfqs(session.workspace.id);
  return (
    <div>
      <PageHeader title="RFQs" description="Quotation requests created from customer email. Matching, pricing, and the reply use verified catalogue and supplier data." />
      <Panel>
        {rfqs.length === 0 ? (
          <div className="p-4"><EmptyState title="No RFQs yet" description="Open an inbound message and choose Create RFQ." /></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Subject</th><th>Customer</th><th>Company</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {rfqs.map((rfq) => (
                <tr key={rfq.id}>
                  <td><Link className="font-medium hover:underline" href={`/rfqs/${rfq.id}`}>{rfq.subject}</Link></td>
                  <td>{rfq.prospect ? fullName(rfq.prospect.firstName, rfq.prospect.lastName) : "—"}</td>
                  <td>{rfq.company?.companyName ?? "—"}</td>
                  <td>{RFQ_STATUS_LABELS[rfq.status as RfqStatus]}</td>
                  <td>{formatDateTime(rfq.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
