import { syncConnectedGmail } from "@/services/gmail-sync-service";
import { processInboundAutomation } from "@/services/rfq-automation-service";
import { processQuoteFollowUps } from "@/services/sales-response-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const results = await syncConnectedGmail();
  let automation: unknown = null;
  try {
    automation = await processInboundAutomation();
  } catch (error) {
    automation = { error: error instanceof Error ? error.message : "RFQ automation failed." };
  }
  let followUp: unknown = null;
  try {
    followUp = await processQuoteFollowUps();
  } catch (error) {
    followUp = { error: error instanceof Error ? error.message : "Quotation follow-up failed." };
  }
  return Response.json({ results, automation, followUp });
}
