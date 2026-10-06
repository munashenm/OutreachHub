import { AppError } from "@/lib/errors";
import { assertSameOrigin, jsonError } from "@/lib/http";
import {
  MAX_SUPPLIER_FILE_BYTES,
  fileFormat,
  parserForSupplier,
  previewRows,
  suggestMapping,
  tableFromCsv,
  tableFromXml,
  tableFromXlsx,
} from "@/lib/supplier-file";
import { isScoopPriceList } from "@/lib/scoop";
import { getSessionContext } from "@/services/auth-service";
import { getDb } from "@/lib/db";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });
    const { id } = await context.params;
    const supplier = await getDb().supplier.findFirst({
      where: { id, workspaceId: session.workspace.id },
      select: { id: true, name: true },
    });
    if (!supplier) throw new AppError("Supplier not found.", 404, "NOT_FOUND");
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new AppError("Choose a CSV, XML, or XLSX file.");
    if (file.size > MAX_SUPPLIER_FILE_BYTES) throw new AppError("Files must be 5 MB or smaller.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sample = file.name.toLowerCase().endsWith(".xlsx") ? "" : new TextDecoder().decode(bytes.slice(0, 400));
    const format = fileFormat(file.name, sample);
    const table = format === "xlsx" ? await tableFromXlsx(bytes) : format === "xml" ? tableFromXml(new TextDecoder().decode(bytes)) : tableFromCsv(new TextDecoder().decode(bytes));
    if ("error" in table && typeof table.error === "string") throw new AppError(table.error);
    const text = format === "xlsx" ? "" : new TextDecoder().decode(bytes);
    const parser = parserForSupplier(supplier.name) === "scoop" && text && isScoopPriceList(text) ? "scoop" : "generic";
    const preview = previewRows(table.records);
    return Response.json({
      filename: file.name,
      format,
      parser,
      headers: table.headers,
      rowCount: table.records.length,
      rows: preview.map((record) => table.headers.map((header) => record[header] ?? "")),
      suggested: suggestMapping(table.headers),
      maxBytes: MAX_SUPPLIER_FILE_BYTES,
    });
  } catch (error) {
    return jsonError(error);
  }
}
