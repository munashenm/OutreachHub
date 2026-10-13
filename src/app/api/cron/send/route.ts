export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  return Response.json({
    skipped: true,
    reason: "Campaign sending is retired. Quotation emails are prepared for approval and are not sent by this job.",
  });
}
