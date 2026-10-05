import { AppError } from "@/lib/errors";
import { jsonError } from "@/lib/http";
import { rejectionsCsv, type ImportRejection } from "@/lib/supplier-file";
import { getSessionContext } from "@/services/auth-service";
import { getDb } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string; importId: string }> }) {
  try {
    const session = await getSessionContext();
    if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });
    const { id, importId } = await context.params;
    const row = await getDb().supplierImport.findFirst({
      where: { id: importId, supplierId: id, workspaceId: session.workspace.id },
      select: { filename: true, rejections: true },
    });
    if (!row) throw new AppError("Import not found.", 404, "NOT_FOUND");
    const rejections = Array.isArray(row.rejections) ? row.rejections as ImportRejection[] : [];
    const csv = rejectionsCsv(rejections);
    const filename = `${row.filename.replace(/[^\w.-]+/g, "-")}-rejected.csv`;
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
