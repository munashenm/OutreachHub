import { AppError } from "@/lib/errors";
import { parseCsv, rowsToRecords } from "@/lib/csv";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { getSessionContext } from "@/services/auth-service";
import { importSupplierPrices } from "@/services/supplier-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });
    const { id } = await context.params;
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new AppError("Choose a CSV file.");
    if (file.size > 1_000_000) throw new AppError("CSV files must be 1 MB or smaller.");
    const records = rowsToRecords(parseCsv(await file.text()));
    if (records.length === 0) throw new AppError("The CSV has no data rows.");
    if (records.length > 2000) throw new AppError("Import 2,000 rows or fewer at a time.");
    const result = await importSupplierPrices(
      { userId: session.user.id, workspaceId: session.workspace.id },
      id,
      records,
    );
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
