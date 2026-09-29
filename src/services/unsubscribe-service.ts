import { getDb } from "../lib/db";
import { AppError } from "../lib/errors";
import { readUnsubscribeToken } from "../lib/unsubscribe";
import { recordActivity } from "./activity-service";
import { ensureSuppression } from "./suppression-service";

export async function applyUnsubscribe(token: string) {
  const parsed = await readUnsubscribeToken(token);
  if (!parsed) throw new AppError("This unsubscribe link is invalid or has expired.");

  const prospect = await getDb().prospect.findFirst({
    where: { id: parsed.prospectId, workspaceId: parsed.workspaceId },
  });
  if (!prospect) throw new AppError("This contact is no longer available.");

  const campaign = parsed.campaignId
    ? await getDb().campaign.findFirst({
      where: { id: parsed.campaignId, workspaceId: parsed.workspaceId },
      select: { id: true },
    })
    : null;

  await getDb().$transaction(async (tx) => {
    if (prospect.marketingStatus !== "OPTED_OUT") {
      await tx.prospect.update({
        where: { id: prospect.id },
        data: { marketingStatus: "OPTED_OUT" },
      });
      await recordActivity(tx, {
        workspaceId: prospect.workspaceId,
        prospectId: prospect.id,
        companyId: prospect.companyId,
        campaignId: campaign?.id ?? null,
        type: "MARKETING_STATUS_CHANGED",
        summary: `${prospect.email} opted out from a campaign email.`,
        metadata: { from: prospect.marketingStatus, to: "OPTED_OUT" },
      });
    }
    await ensureSuppression(tx, { userId: null, workspaceId: prospect.workspaceId }, {
      email: prospect.email,
      reason: "Unsubscribed from a campaign email.",
      source: "unsubscribe_link",
      campaignId: campaign?.id ?? null,
    });
  });

  return prospect.email;
}
