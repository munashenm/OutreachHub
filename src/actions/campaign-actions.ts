"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/format";
import { runAction } from "@/lib/run-action";
import { campaignSchema, fieldErrors, idListSchema, readForm } from "@/lib/validators";
import { requireSession } from "@/services/auth-service";
import {
  addProspectsToCampaign,
  createCampaign,
  deleteCampaign,
  removeProspectFromCampaign,
  updateCampaign,
} from "@/services/campaign-service";
import { sendDueEmails, type SendSummary } from "@/services/send-service";

function actor(session: Awaited<ReturnType<typeof requireSession>>) {
  return { userId: session.user.id, workspaceId: session.workspace.id };
}

export async function createCampaignAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const parsed = campaignSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    const campaign = await createCampaign(actor(session), parsed.data);
    revalidatePath("/campaigns");
    revalidatePath("/dashboard");
    redirect(`/campaigns/${campaign.id}?status=created`);
  });
}

export async function updateCampaignAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const id = String(formData.get("id") ?? "");
    const parsed = campaignSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await updateCampaign(actor(session), id, parsed.data);
    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${id}`);
    revalidatePath("/dashboard");
    return { success: "Campaign saved. Active campaigns send during the configured window." };
  });
}

export async function deleteCampaignAction(id: string): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    await deleteCampaign(actor(session), id);
    revalidatePath("/campaigns");
    redirect("/campaigns?status=deleted");
  });
}

export type CampaignAddState = ActionState & {
  rejected?: { email: string; name: string; reason: string }[];
  addedCount?: number;
};

export async function addProspectsToCampaignAction(
  campaignId: string,
  ids: string[],
): Promise<CampaignAddState> {
  return runAction(async () => {
    const session = await requireSession();
    const parsed = idListSchema.safeParse(ids);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Select a prospect." };
    const result = await addProspectsToCampaign(actor(session), campaignId, parsed.data);
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/dashboard");
    return {
      success: result.added.length
        ? `Added ${result.added.length} prospect${result.added.length === 1 ? "" : "s"}.`
        : undefined,
      error: result.added.length === 0 ? "No prospects were added." : undefined,
      rejected: result.rejected,
      addedCount: result.added.length,
    };
  });
}

export async function sendCampaignNowAction(campaignId: string): Promise<ActionState & { summary?: SendSummary }> {
  return runAction(async () => {
    const session = await requireSession();
    const summary = await sendDueEmails({
      workspaceId: session.workspace.id,
      campaignId,
      actorId: session.user.id,
    });
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/inbox");
    revalidatePath("/dashboard");
    revalidatePath("/pipeline");
    const detail = summary.notes[0] ? ` ${summary.notes[0]}` : "";
    return {
      success: `Sent ${summary.sent}, skipped ${summary.skipped}, failed ${summary.failed}, replies ${summary.replies}.${detail}`,
      summary,
    };
  });
}

export async function removeProspectFromCampaignAction(
  campaignId: string,
  prospectId: string,
): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    await removeProspectFromCampaign(actor(session), campaignId, prospectId);
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath(`/prospects/${prospectId}`);
    return { success: "Prospect removed from the campaign." };
  });
}
