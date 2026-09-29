"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/format";
import { runAction } from "@/lib/run-action";
import { draftSchema, fieldErrors, readForm, templateSchema } from "@/lib/validators";
import { draftTemplate } from "@/services/ai-service";
import { requireSession } from "@/services/auth-service";
import { createTemplate, deleteTemplate, updateTemplate } from "@/services/template-service";
import { disconnectMailbox } from "@/services/mailbox-service";

function actor(session: Awaited<ReturnType<typeof requireSession>>) {
  return { userId: session.user.id, workspaceId: session.workspace.id };
}

export async function createTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const parsed = templateSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    const template = await createTemplate(actor(session), parsed.data);
    revalidatePath("/templates");
    redirect(`/templates/${template.id}/edit?status=created`);
  });
}

export async function updateTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const id = String(formData.get("id") ?? "");
    const parsed = templateSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await updateTemplate(actor(session), id, parsed.data);
    revalidatePath("/templates");
    return { success: "Template saved." };
  });
}

export async function deleteTemplateAction(id: string): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    await deleteTemplate(actor(session), id);
    revalidatePath("/templates");
    redirect("/templates?status=deleted");
  });
}

export async function draftTemplateAction(formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireSession();
    const parsed = draftSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    const draft = await draftTemplate(parsed.data);
    return { success: "Draft ready. Review it before saving.", draft };
  });
}

export async function disconnectMailboxAction(id: string): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    await disconnectMailbox({ userId: session.user.id, workspaceId: session.workspace.id, mailboxId: id });
    revalidatePath("/settings/mailboxes");
    return { success: "Mailbox disconnected." };
  });
}
