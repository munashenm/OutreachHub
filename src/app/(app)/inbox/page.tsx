import Link from "next/link";
import { CategorySelect } from "@/components/inbox-actions";
import { Badge, EmptyState, PageHeader, Pagination, Panel } from "@/components/ui";
import { firstParam, formatDateTime, fullName } from "@/lib/format";
import { INBOX_CATEGORY_LABELS, type InboxCategory } from "@/lib/labels";
import { requireSession } from "@/services/auth-service";
import { listInboxMessages } from "@/services/inbox-service";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const page = Math.max(1, Number(firstParam((await searchParams).page) || "1") || 1);
  const { items, total, pageSize } = await listInboxMessages(session.workspace.id, page);
  return (
    <div>
      <PageHeader title="Inbox" description="Customer enquiries and campaign replies from the connected Google Workspace mailbox. Spam and trash are not imported." />
      <Panel>
        {items.length === 0 ? (
          <div className="p-4"><EmptyState title="No customer messages yet" description="Connect sales@urbanfocus.co.za and run a Gmail sync. Unknown senders are not turned into prospects automatically." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Sender</th><th>Company</th><th>Subject</th><th>Snippet</th><th>Received</th><th>Status</th><th>Prospect</th><th>Campaign</th><th>Category</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link className="font-medium hover:underline" href={`/inbox/${item.id}`}>{item.fromName || item.fromEmail || "Unknown sender"}</Link>
                      <p className="text-xs text-muted">{item.fromEmail}</p>
                    </td>
                    <td>{item.prospect?.company ? <Link className="hover:underline" href={`/companies/${item.prospect.company.id}`}>{item.prospect.company.companyName}</Link> : "—"}</td>
                    <td>{item.subject || "—"}</td>
                    <td className="max-w-xs truncate">{item.snippet || "—"}</td>
                    <td>{formatDateTime(item.sentAt ?? item.createdAt)}</td>
                    <td><Badge tone={item.prospect ? "blue" : "amber"}>{item.prospect ? "Linked" : "Unknown sender"}</Badge></td>
                    <td>{item.prospect ? <Link className="hover:underline" href={`/prospects/${item.prospect.id}`}>{fullName(item.prospect.firstName, item.prospect.lastName)}</Link> : "—"}</td>
                    <td>{item.campaign ? <Link className="hover:underline" href={`/campaigns/${item.campaign.id}`}>{item.campaign.name}</Link> : "—"}</td>
                    <td className="min-w-40">
                      <CategorySelect messageId={item.id} category={item.category as InboxCategory | null} />
                      <p className="mt-1 text-xs text-muted">{item.category ? INBOX_CATEGORY_LABELS[item.category as InboxCategory] : "Uncategorised"}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageCount={Math.max(1, Math.ceil(total / pageSize))} path="/inbox" query={{}} />
      </Panel>
    </div>
  );
}
