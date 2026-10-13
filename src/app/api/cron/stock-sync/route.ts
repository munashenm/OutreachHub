export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  return Response.json({
    skipped: true,
    reason: "OutreachHub does not sync supplier feeds or push a product catalogue to Urban Focus.",
  });
}
