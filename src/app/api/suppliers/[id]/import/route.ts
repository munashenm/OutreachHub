import { AppError } from "@/lib/errors";
import { parseCsv, rowsToRecords } from "@/lib/csv";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { MAX_SUPPLIER_FILE_BYTES, fileFormat, mappingFromForm, rowsForSupplier, tableFromCsv, tableFromXml, tableFromXlsx } from "@/lib/supplier-file";
import { getSessionContext } from "@/services/auth-service";
import { getDb } from "@/lib/db";
import { importSupplierPrices } from "@/services/supplier-service";
import { recordSupplierImport } from "@/services/supplier-import-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });
    const { id } = await context.params;
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new AppError("Choose a file.");
    if (formData.get("source") === "table") return importTable(session.user.id, session.workspace.id, id, file, formData.get("mapping"));
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

async function importTable(userId: string, workspaceId: string, supplierId: string, file: File, mappingValue: FormDataEntryValue | null) {
  if (file.size > MAX_SUPPLIER_FILE_BYTES) throw new AppError("Files must be 5 MB or smaller.");
  const supplier = await getDb().supplier.findFirst({ where: { id: supplierId, workspaceId }, select: { name: true } });
  if (!supplier) throw new AppError("Supplier not found.", 404, "NOT_FOUND");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = fileFormat(file.name);
  const text = format === "xlsx" ? "" : new TextDecoder().decode(bytes);
  const table = format === "xlsx" ? await tableFromXlsx(bytes) : format === "xml" ? tableFromXml(text) : tableFromCsv(text);
  if ("error" in table && typeof table.error === "string") throw new AppError(table.error);
  if (table.records.length === 0) throw new AppError("The file has no data rows.");
  let mapping = {};
  if (typeof mappingValue === "string" && mappingValue.trim()) {
    try {
      mapping = mappingFromForm(JSON.parse(mappingValue) as unknown);
    } catch {
      throw new AppError("The column mapping could not be read.");
    }
  }
  const parsed = rowsForSupplier(supplier.name, text, table.records, mapping);
  const result = await recordSupplierImport(
    { userId, workspaceId },
    supplierId,
    { filename: file.name || "upload", offers: parsed.offers, rejections: parsed.rejections, rowsRead: parsed.rowsRead, mapping },
  );
  return Response.json(result);
}

