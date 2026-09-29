import { syncConnectedGmail } from "@/services/gmail-sync-service";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const results = await syncConnectedGmail();
  return Response.json({ results });
}
