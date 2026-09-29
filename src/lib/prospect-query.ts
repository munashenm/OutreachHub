import type { ProspectQuery } from "@/services/prospect-service";

export function parseProspectQuery(params: Record<string, string>): ProspectQuery {
  const requested = Number(params.page || "1");
  const sort = params.sort || "createdAt";
  const fallbackDir = sort === "createdAt" || sort === "updatedAt" ? "desc" : "asc";
  const dir = params.dir === "asc" || params.dir === "desc" ? params.dir : fallbackDir;
  return {
    q: params.q?.trim() ?? "",
    leadStatus: params.leadStatus ?? "",
    marketingStatus: params.marketingStatus ?? "",
    companyId: params.companyId ?? "",
    sort,
    dir,
    page: Number.isInteger(requested) && requested > 0 ? requested : 1,
  };
}

export function queryRecord(query: ProspectQuery): Record<string, string> {
  return {
    q: query.q,
    leadStatus: query.leadStatus,
    marketingStatus: query.marketingStatus,
    companyId: query.companyId,
    sort: query.sort,
    dir: query.dir,
    page: String(query.page),
  };
}
