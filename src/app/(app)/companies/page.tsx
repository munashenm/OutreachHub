import Link from "next/link";
import { EmptyState, Notice, PageHeader, Pagination, Panel, buttonPrimary, inputClass } from "@/components/ui";
import { firstParam } from "@/lib/format";
import { requireSession } from "@/services/auth-service";
import { listCompanies } from "@/services/company-service";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const q = firstParam(params.q);
  const page = Math.max(1, Number(firstParam(params.page) || "1") || 1);
  const { items, total, pageSize } = await listCompanies(session.workspace.id, { q, page });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div>
      <PageHeader title="Companies" description="Organisations linked to one or more prospects." actions={<Link className={buttonPrimary} href="/companies/new">New company</Link>} />
      {firstParam(params.status) === "deleted" ? <Notice tone="success">Company deleted.</Notice> : null}
      <form action="/companies" className="mb-4 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search companies" className={inputClass} />
        <button className={buttonPrimary}>Search</button>
      </form>
      <Panel>
        {items.length === 0 ? (
          <div className="p-4"><EmptyState title="No companies yet" description="Create a company, or add one while creating a prospect." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>Company</th><th>Location</th><th>Contacts</th></tr>
              </thead>
              <tbody>
                {items.map((company) => (
                  <tr key={company.id}>
                    <td><Link className="font-medium hover:underline" href={`/companies/${company.id}`}>{company.companyName}</Link><p className="text-xs text-muted">{company.industry || company.website || ""}</p></td>
                    <td>{[company.city, company.country].filter(Boolean).join(", ") || "—"}</td>
                    <td>{company._count.prospects}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageCount={pageCount} path="/companies" query={{ q }} />
      </Panel>
    </div>
  );
}
