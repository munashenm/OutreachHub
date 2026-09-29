import { sendDueEmails } from "@/services/send-service";

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const summary = await sendDueEmails({ actorId: null });
  return Response.json(summary);
}
