import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteCompanyAction } from "@/actions/company-actions";
import { Badge, ConfirmButton, Notice, PageHeader, Panel } from "@/components/ui";
import { firstParam, formatDateTime, fullName } from "@/lib/format";
import { LEAD_STATUS_LABELS, OPPORTUNITY_STATUSES } from "@/lib/labels";
import { listActivities } from "@/services/activity-service";
import { requireSession } from "@/services/auth-service";
import { getCompany } from "@/services/company-service";

export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const company = await getCompany(session.workspace.id, id);
  if (!company) notFound();
  const activities = await listActivities({ workspaceId: session.workspace.id, companyId: company.id, take: 20 });
  const status = firstParam((await searchParams).status);
  const campaigns = new Map<string, { id: string; name: string; status: string }>();
  for (const prospect of company.prospects) {
    for (const membership of prospect.campaignProspects) {
      campaigns.set(membership.campaign.id, membership.campaign);
    }
  }
  const opportunities = company.prospects.filter((prospect) => OPPORTUNITY_STATUSES.includes(prospect.leadStatus));

  return (
    <div>
      <PageHeader
        title={company.companyName}
        description={[company.city, company.province, company.country].filter(Boolean).join(", ") || "Company record"}
        actions={
          <>
            <Link href={`/companies/${company.id}/edit`} className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold">Edit</Link>
            <ConfirmButton action={deleteCompanyAction.bind(null, company.id)} label="Delete" confirm="Delete this company? It must have no contacts." />
          </>
        }
      />
      {status === "created" ? <Notice tone="success">Company created.</Notice> : null}
      {status === "updated" ? <Notice tone="success">Changes saved.</Notice> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <h2 className="font-semibold">Company information</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted">Website</dt><dd>{company.website || "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Industry</dt><dd>{company.industry || "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Size</dt><dd>{company.companySize || "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Phone</dt><dd>{company.phone || "—"}</dd></div>
          </dl>
          {company.notes ? <p className="mt-4 whitespace-pre-wrap text-sm text-muted">{company.notes}</p> : null}
        </Panel>
        <Panel className="p-5">
          <h2 className="font-semibold">Contacts</h2>
          {company.prospects.length === 0 ? <p className="mt-3 text-sm text-muted">No contacts yet.</p> : (
            <ul className="mt-3 space-y-2 text-sm">
              {company.prospects.map((prospect) => (
                <li key={prospect.id}>
                  <Link className="font-medium text-accent" href={`/prospects/${prospect.id}`}>{fullName(prospect.firstName, prospect.lastName)}</Link>
                  <span className="text-muted"> · {prospect.jobTitle || prospect.email}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel className="p-5">
          <h2 className="font-semibold">Sales opportunities</h2>
          {opportunities.length === 0 ? <p className="mt-3 text-sm text-muted">No quote or closed opportunities yet.</p> : (
            <ul className="mt-3 space-y-2 text-sm">
              {opportunities.map((prospect) => (
                <li key={prospect.id} className="flex items-center justify-between gap-3">
                  <Link href={`/prospects/${prospect.id}`}>{fullName(prospect.firstName, prospect.lastName)}</Link>
                  <Badge>{LEAD_STATUS_LABELS[prospect.leadStatus]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel className="p-5">
          <h2 className="font-semibold">Campaign history</h2>
          {campaigns.size === 0 ? <p className="mt-3 text-sm text-muted">No contacts are in a campaign.</p> : (
            <ul className="mt-3 space-y-2 text-sm">
              {[...campaigns.values()].map((campaign) => (
                <li key={campaign.id}><Link className="text-accent" href={`/campaigns/${campaign.id}`}>{campaign.name}</Link> · {campaign.status}</li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Panel className="mt-4 p-5">
        <h2 className="font-semibold">Activity</h2>
        {activities.length === 0 ? <p className="mt-3 text-sm text-muted">No activity recorded.</p> : (
          <ul className="mt-3 space-y-2 text-sm">
            {activities.map((item) => <li key={item.id}>{item.summary} <span className="text-muted">· {formatDateTime(item.createdAt)}</span></li>)}
          </ul>
        )}
      </Panel>
    </div>
  );
}
