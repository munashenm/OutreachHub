import Link from "next/link";
import { ImportCsv } from "@/components/import-csv";
import { ProspectTable } from "@/components/prospect-table";
import { EmptyState, Notice, PageHeader, Pagination, Panel, buttonPrimary, inputClass } from "@/components/ui";
import { firstParam, fullName, withQuery } from "@/lib/format";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, MARKETING_STATUSES, MARKETING_STATUS_LABELS } from "@/lib/labels";
import { parseProspectQuery, queryRecord } from "@/lib/prospect-query";
import { requireSession } from "@/services/auth-service";
import { listCompanyOptions } from "@/services/company-service";
import { listProspects } from "@/services/prospect-service";

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, firstParam(value)]));
  const query = parseProspectQuery(params);
  const [{ items, total, pageSize }, companies] = await Promise.all([
    listProspects(session.workspace.id, query),
    listCompanyOptions(session.workspace.id),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const record = queryRecord(query);
  const status = params.status;

  return (
    <div>
      <PageHeader
        title="Prospects"
        description="Search, filter, and maintain the people in this workspace."
        actions={<Link className={buttonPrimary} href="/prospects/new">New prospect</Link>}
      />
      {status === "deleted" ? <Notice tone="success">Prospect deleted. The email remains suppressed if it was on the suppression list.</Notice> : null}
      <Panel className="mb-4 p-4">
        <form className="grid gap-3 md:grid-cols-4" action="/prospects">
          <input name="q" defaultValue={query.q} placeholder="Search name, email, or company" className={inputClass} />
          <select name="leadStatus" defaultValue={query.leadStatus} className={inputClass}>
            <option value="">All lead statuses</option>
            {LEAD_STATUSES.map((item) => <option key={item} value={item}>{LEAD_STATUS_LABELS[item]}</option>)}
          </select>
          <select name="marketingStatus" defaultValue={query.marketingStatus} className={inputClass}>
            <option value="">All marketing statuses</option>
            {MARKETING_STATUSES.map((item) => <option key={item} value={item}>{MARKETING_STATUS_LABELS[item]}</option>)}
          </select>
          <select name="companyId" defaultValue={query.companyId} className={inputClass}>
            <option value="">All companies</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.companyName}</option>)}
          </select>
          <div className="flex flex-wrap gap-2 md:col-span-4">
            <button className={buttonPrimary}>Apply</button>
            <Link className="inline-flex h-10 items-center text-sm text-accent" href="/prospects">Clear</Link>
            <a className="inline-flex h-10 items-center text-sm text-accent" href={`/api/prospects/export?${new URLSearchParams(record).toString()}`}>Export CSV</a>
          </div>
        </form>
        <div className="mt-4 border-t border-line pt-4">
          <ImportCsv />
        </div>
      </Panel>
      <div className="mb-3 flex flex-wrap gap-3 text-sm text-muted">
        <span>Sort</span>
        {(["name", "email", "company", "leadStatus", "createdAt"] as const).map((sort) => (
          <Link key={sort} href={withQuery("/prospects", record, { sort, dir: query.sort === sort && query.dir === "asc" ? "desc" : "asc", page: "1" })} className="text-accent">
            {sort}
          </Link>
        ))}
        <span className="ml-auto">{total.toLocaleString("en-GB")} prospects</span>
      </div>
      <Panel>
        {items.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No prospects match" description="Create a prospect or change the filters. Imports skip duplicate emails and report them." />
          </div>
        ) : (
          <ProspectTable
            rows={items.map((item) => ({
              id: item.id,
              name: fullName(item.firstName, item.lastName),
              email: item.email,
              jobTitle: item.jobTitle ?? "",
              companyName: item.company?.companyName ?? "",
              leadStatus: item.leadStatus,
              marketingStatus: item.marketingStatus,
            }))}
          />
        )}
        <Pagination page={query.page} pageCount={pageCount} path="/prospects" query={record} />
      </Panel>
    </div>
  );
}
