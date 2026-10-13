export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  return Response.json({
    skipped: true,
    reason: "OutreachHub searches the Urban Focus API when an enquiry is quoted. It does not keep a second product catalogue.",
  });
}
