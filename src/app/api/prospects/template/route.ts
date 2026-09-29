import { serializeCsv } from "@/lib/csv";
import { CSV_HEADERS } from "@/lib/labels";
import { getSessionContext } from "@/services/auth-service";

export async function GET() {
  const session = await getSessionContext();
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });
  return new Response(serializeCsv(CSV_HEADERS, []), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=prospects-template.csv",
    },
  });
}
