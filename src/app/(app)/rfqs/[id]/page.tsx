import Link from "next/link";
import { notFound } from "next/navigation";
import { ReplyForm } from "@/components/inbox-actions";
import { RfqStatusForm } from "@/components/rfq-status-form";
import { PageHeader, Panel } from "@/components/ui";
import { formatDateTime, fullName } from "@/lib/format";
import { replyTargets } from "@/lib/gmail-message";
import type { RfqStatus } from "@/lib/labels";
import { requireSession } from "@/services/auth-service";
import { getThread } from "@/services/reply-service";
import { getRfq } from "@/services/rfq-service";

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const rfq = await getRfq(session.workspace.id, id);
  if (!rfq) notFound();
  const thread = await getThread(session.workspace.id, rfq.sourceMessageId);
  const target = replyTargets(rfq.sourceMessage);
  return (
    <div className="space-y-4">
      <PageHeader title={rfq.subject} description={`Created ${formatDateTime(rfq.createdAt)}`} actions={<Link href="/rfqs" className="text-sm text-accent">Back to RFQs</Link>} />
      <Panel className="grid gap-3 p-5 text-sm md:grid-cols-2">
        <p><span className="text-muted">Customer: </span>{rfq.prospect ? <Link className="hover:underline" href={`/prospects/${rfq.prospect.id}`}>{fullName(rfq.prospect.firstName, rfq.prospect.lastName)}</Link> : "Unknown sender"}</p>
        <p><span className="text-muted">Company: </span>{rfq.company ? <Link className="hover:underline" href={`/companies/${rfq.company.id}`}>{rfq.company.companyName}</Link> : "—"}</p>
        <p className="md:col-span-2"><span className="text-muted">Original enquiry: </span><Link className="hover:underline" href={`/inbox/${rfq.sourceMessageId}`}>{rfq.sourceMessage.subject}</Link></p>
      </Panel>
      <Panel className="p-5">
        <h2 className="font-semibold">Conversation</h2>
        <div className="mt-4 space-y-4">
          {(thread?.messages ?? [rfq.sourceMessage]).map((item) => (
            <article key={item.id} className="border-b border-line pb-4 last:border-b-0">
              <p className="text-sm font-medium">{item.direction === "OUTBOUND" ? "Urban Focus" : item.fromName || item.fromEmail || "Customer"}</p>
              <p className="text-xs text-muted">{formatDateTime(item.sentAt ?? item.createdAt)}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{item.body || item.snippet}</p>
            </article>
          ))}
        </div>
      </Panel>
      <Panel className="p-5">
        <RfqStatusForm id={rfq.id} status={rfq.status as RfqStatus} notes={rfq.notes} />
      </Panel>
      <Panel className="p-5">
        <h2 className="mb-3 font-semibold">Reply</h2>
        <p className="mb-3 text-sm text-muted">This reply is a quotation response. It is not a promotional campaign send, so an opted-out address can still receive it.</p>
        <ReplyForm messageId={rfq.sourceMessageId} to={target.to} subject={target.subject} />
      </Panel>
    </div>
  );
}
