import { renderTenderPack } from "@/lib/tender-pack";
import { getSessionContext } from "@/services/auth-service";
import { listTenderAnalyses } from "@/services/document-analysis-service";
import { getRfq } from "@/services/rfq-service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const rfq = await getRfq(session.workspace.id, id);
  if (!rfq) return Response.json({ error: "RFQ not found." }, { status: 404 });
  const analyses = await listTenderAnalyses(session.workspace.id, id);
  const bytes = await renderTenderPack({
    subject: rfq.subject,
    customer: rfq.prospect ? `${rfq.prospect.firstName} ${rfq.prospect.lastName}`.trim() : rfq.sourceMessage.fromName ?? "",
    documents: analyses.map((row) => row.record),
  });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=\"urban-focus-tender-pack.pdf\"",
      "Cache-Control": "private, no-store",
    },
  });
}
