import { AppError } from "@/lib/errors";
import { getSessionContext } from "@/services/auth-service";
import { generateQuotePdf } from "@/services/quotation-pdf-service";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "FORMAL" ? "FORMAL" : "STANDARD";
  const exportQuote = url.searchParams.get("export") === "1";
  const download = url.searchParams.get("download") === "1";
  try {
    const pdf = await generateQuotePdf(session.workspace.id, id, { mode, exportQuote });
    return new Response(new Uint8Array(pdf.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${pdf.filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "The quotation PDF could not be created.";
    const status = error instanceof AppError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}
