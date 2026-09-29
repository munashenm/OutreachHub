import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteProspectAction } from "@/actions/prospect-actions";
import { Badge, ConfirmButton, Notice, PageHeader, Panel } from "@/components/ui";
import { firstParam, formatDateTime, fullName } from "@/lib/format";
import { LEAD_STATUS_LABELS, MARKETING_STATUS_LABELS } from "@/lib/labels";
import { marketingBlockReason } from "@/lib/marketing";
import { requireSession } from "@/services/auth-service";
import { getProspect } from "@/services/prospect-service";
import { suppressedEmailSet } from "@/services/suppression-service";

export default async function ProspectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const prospect = await getProspect(session.workspace.id, id);
  if (!prospect) notFound();
  const status = firstParam((await searchParams).status);
  const suppressed = await suppressedEmailSet(session.workspace.id, [prospect.email]);
  const blockReason = marketingBlockReason(prospect.marketingStatus, suppressed.has(prospect.email));
  const fields = [
    ["Email", prospect.email],
    ["Phone", prospect.phone],
    ["Job title", prospect.jobTitle],
    ["Company", prospect.company?.companyName],
    ["Website", prospect.website],
    ["Industry", prospect.industry],
    ["Location", [prospect.city, prospect.province, prospect.country].filter(Boolean).join(", ")],
    ["Source", prospect.source],
    ["LinkedIn", prospect.linkedinUrl],
  ] as const;

  return (
    <div>
      <PageHeader
        title={fullName(prospect.firstName, prospect.lastName)}
        description="Contact record, status history, and campaign membership."
        actions={
          <>
            <Link href={`/prospects/${prospect.id}/edit`} className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold">Edit</Link>
            <ConfirmButton action={deleteProspectAction.bind(null, prospect.id)} label="Delete" confirm="Delete this prospect? Suppression history is kept." />
          </>
        }
      />
      {status === "created" ? <Notice tone="success">Prospect created.</Notice> : null}
      {status === "updated" ? <Notice tone="success">Changes saved.</Notice> : null}
      {blockReason ? <Notice tone="error">{blockReason} Campaigns cannot send marketing to this address.</Notice> : null}
      <div className="mb-4 flex gap-2">
        <Badge tone="blue">{LEAD_STATUS_LABELS[prospect.leadStatus]}</Badge>
        <Badge tone={blockReason ? "red" : "slate"}>{MARKETING_STATUS_LABELS[prospect.marketingStatus]}</Badge>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <h2 className="text-base font-semibold">Details</h2>
          <dl className="mt-4 space-y-3 text-sm">
            {fields.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[8rem_1fr] gap-3">
                <dt className="text-muted">{label}</dt>
                <dd>{value || "—"}</dd>
              </div>
            ))}
          </dl>
          {prospect.notes ? <p className="mt-4 whitespace-pre-wrap text-sm text-muted">{prospect.notes}</p> : null}
        </Panel>
        <Panel className="p-5">
          <h2 className="text-base font-semibold">Campaigns</h2>
          {prospect.campaignProspects.length === 0 ? <p className="mt-3 text-sm text-muted">Not in a campaign.</p> : (
            <ul className="mt-3 space-y-2 text-sm">
              {prospect.campaignProspects.map((item) => (
                <li key={item.id}><Link className="text-accent" href={`/campaigns/${item.campaign.id}`}>{item.campaign.name}</Link> · {item.campaign.status}</li>
              ))}
            </ul>
          )}
          <h2 className="mt-6 text-base font-semibold">Status history</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {prospect.statusHistory.map((item) => (
              <li key={item.id}>
                {item.fromStatus ? LEAD_STATUS_LABELS[item.fromStatus] : "Created"} → {LEAD_STATUS_LABELS[item.toStatus]}
                <span className="text-muted"> · {item.changedBy?.name ?? "System"} · {formatDateTime(item.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel className="mt-4 p-5">
        <h2 className="text-base font-semibold">Activity</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {prospect.activities.map((item) => (
            <li key={item.id}>{item.summary} <span className="text-muted">· {formatDateTime(item.createdAt)}</span></li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
