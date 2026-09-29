import { serializeCsv } from "@/lib/csv";
import { jsonError } from "@/lib/http";
import { CSV_HEADERS } from "@/lib/labels";
import { parseProspectQuery } from "@/lib/prospect-query";
import { getSessionContext } from "@/services/auth-service";
import { listProspectsForExport } from "@/services/prospect-service";

export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });
    const url = new URL(request.url);
    const query = parseProspectQuery(Object.fromEntries(url.searchParams.entries()));
    const prospects = await listProspectsForExport(session.workspace.id, query);
    const csv = serializeCsv(
      CSV_HEADERS,
      prospects.map((prospect) => ({
        firstName: prospect.firstName,
        lastName: prospect.lastName,
        jobTitle: prospect.jobTitle ?? "",
        email: prospect.email,
        phone: prospect.phone ?? "",
        companyName: prospect.company?.companyName ?? "",
        website: prospect.website ?? "",
        industry: prospect.industry ?? "",
        country: prospect.country ?? "",
        province: prospect.province ?? "",
        city: prospect.city ?? "",
        source: prospect.source ?? "",
        linkedinUrl: prospect.linkedinUrl ?? "",
        notes: prospect.notes ?? "",
        leadStatus: prospect.leadStatus,
        marketingStatus: prospect.marketingStatus,
      })),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=prospects.csv",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
