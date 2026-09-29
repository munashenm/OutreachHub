import { AppError } from "@/lib/errors";
import { parseCsv, rowsToRecords } from "@/lib/csv";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { planProspectImport } from "@/lib/import-plan";
import { getDb } from "@/lib/db";
import { getSessionContext } from "@/services/auth-service";
import { createProspect } from "@/services/prospect-service";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new AppError("Choose a CSV file.");
    if (file.size > 1_000_000) throw new AppError("CSV files must be 1 MB or smaller.");

    const records = rowsToRecords(parseCsv(await file.text()));
    if (records.length === 0) throw new AppError("The CSV has no data rows.");
    if (records.length > 2000) throw new AppError("Import 2,000 rows or fewer at a time.");

    const emails = records
      .map((record) => (record.email ?? "").trim().toLowerCase())
      .filter(Boolean);
    const existing = await getDb().prospect.findMany({
      where: { workspaceId: session.workspace.id, email: { in: emails } },
      select: { email: true },
    });
    const plan = planProspectImport(records, new Set(existing.map((item) => item.email)));
    const rejected = [...plan.rejected];
    let created = 0;

    for (const item of plan.ready) {
      try {
        await createProspect(
          { userId: session.user.id, workspaceId: session.workspace.id },
          { ...item.prospect, companyId: null, newCompanyName: item.prospect.companyName },
        );
        created += 1;
      } catch (error) {
        rejected.push({
          row: item.row,
          email: item.prospect.email,
          reason: error instanceof AppError ? error.message : "Could not import this row.",
        });
      }
    }

    return Response.json({ created, rejected });
  } catch (error) {
    return jsonError(error);
  }
}
