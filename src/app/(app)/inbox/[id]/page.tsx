import Link from "next/link";
import { notFound } from "next/navigation";
import { CategorySelect, CreateRfqButton, ReplyForm, UnknownSenderActions } from "@/components/inbox-actions";
import { PageHeader, Panel } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { replyTargets } from "@/lib/gmail-message";
import type { InboxCategory } from "@/lib/labels";
import { requireSession } from "@/services/auth-service";
import { getThread } from "@/services/reply-service";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const thread = await getThread(session.workspace.id, id);
  if (!thread) notFound();
  const target = replyTargets(thread.message);
  return (
    <div className="space-y-4">
      <PageHeader
        title={thread.message.subject || "Conversation"}
        description="Messages stay in the original Gmail thread."
        actions={<Link href="/inbox" className="text-sm text-accent">Back to inbox</Link>}
      />
      <div className="flex flex-wrap items-center gap-3">
        <CategorySelect messageId={thread.message.id} category={thread.message.category as InboxCategory | null} />
        <CreateRfqButton messageId={thread.message.id} />
      </div>
      {!thread.message.prospectId && !thread.message.ignored ? <UnknownSenderActions messageId={thread.message.id} /> : null}
      <Panel className="space-y-4 p-5">
        {thread.messages.map((item) => (
          <article key={item.id} className="border-b border-line pb-4 last:border-b-0">
            <p className="text-sm font-medium">{item.direction === "OUTBOUND" ? "Urban Focus" : item.fromName || item.fromEmail || "Customer"}</p>
            <p className="text-xs text-muted">{formatDateTime(item.sentAt ?? item.createdAt)} · {item.subject}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{item.body || item.snippet}</p>
          </article>
        ))}
      </Panel>
      <Panel className="p-5">
        <h2 className="mb-3 font-semibold">Reply</h2>
        <ReplyForm messageId={thread.message.id} to={target.to} subject={target.subject} />
      </Panel>
    </div>
  );
}
