"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/format";
import { isInboxCategory } from "@/lib/labels";
import { runAction } from "@/lib/run-action";
import { fieldErrors, readForm, replySchema } from "@/lib/validators";
import { requireSession } from "@/services/auth-service";
import { createProspectFromMessage, ignoreMessage, linkMessageToProspect, setMessageCategory } from "@/services/inbox-service";
import { sendThreadReply } from "@/services/reply-service";
import { createRfqFromMessage } from "@/services/rfq-service";

function actor(session: Awaited<ReturnType<typeof requireSession>>) {
  return { userId: session.user.id, workspaceId: session.workspace.id };
}

export async function setCategoryAction(messageId: string, category: string): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    if (!isInboxCategory(category)) return { error: "Choose a category." };
    await setMessageCategory(actor(session), messageId, category);
    revalidatePath("/inbox");
    revalidatePath(`/inbox/${messageId}`);
    return { success: "Category saved." };
  });
}

export async function ignoreMessageAction(messageId: string): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    await ignoreMessage(actor(session), messageId);
    revalidatePath("/inbox");
    redirect("/inbox");
  });
}

export async function createProspectFromMessageAction(messageId: string): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const prospectId = await createProspectFromMessage(actor(session), messageId);
    revalidatePath("/inbox");
    revalidatePath("/prospects");
    redirect(`/prospects/${prospectId}`);
  });
}

export async function linkProspectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const messageId = String(formData.get("messageId") ?? "");
    const email = String(formData.get("email") ?? "");
    await linkMessageToProspect(actor(session), messageId, email);
    revalidatePath("/inbox");
    revalidatePath(`/inbox/${messageId}`);
    return { success: "Prospect linked." };
  });
}

export async function createRfqAction(messageId: string): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const rfq = await createRfqFromMessage(actor(session), messageId);
    revalidatePath("/rfqs");
    redirect(`/rfqs/${rfq.id}`);
  });
}

export async function replyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const parsed = replySchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await sendThreadReply(actor(session), parsed.data);
    revalidatePath("/inbox");
    revalidatePath(`/inbox/${parsed.data.messageId}`);
    return { success: "Reply sent." };
  });
}
