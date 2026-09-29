"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/format";
import { isLeadStatus } from "@/lib/labels";
import { runAction } from "@/lib/run-action";
import { fieldErrors, idListSchema, prospectSchema, readForm } from "@/lib/validators";
import { requireSession } from "@/services/auth-service";
import {
  changeLeadStatus,
  createProspect,
  deleteProspects,
  updateProspect,
} from "@/services/prospect-service";

function actor(session: Awaited<ReturnType<typeof requireSession>>) {
  return { userId: session.user.id, workspaceId: session.workspace.id };
}

export async function createProspectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const parsed = prospectSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    const prospect = await createProspect(actor(session), parsed.data);
    revalidatePath("/prospects");
    revalidatePath("/dashboard");
    redirect(`/prospects/${prospect.id}?status=created`);
  });
}

export async function updateProspectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const id = String(formData.get("id") ?? "");
    const parsed = prospectSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await updateProspect(actor(session), id, parsed.data);
    revalidatePath("/prospects");
    revalidatePath(`/prospects/${id}`);
    revalidatePath("/pipeline");
    redirect(`/prospects/${id}?status=updated`);
  });
}

export async function deleteProspectsAction(ids: string[]): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const parsed = idListSchema.safeParse(ids);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Select a prospect." };
    await deleteProspects(actor(session), parsed.data);
    revalidatePath("/prospects");
    revalidatePath("/pipeline");
    revalidatePath("/dashboard");
    return { success: "Selected prospects were deleted." };
  });
}

export async function deleteProspectAction(id: string): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    await deleteProspects(actor(session), [id]);
    revalidatePath("/prospects");
    revalidatePath("/pipeline");
    redirect("/prospects?status=deleted");
  });
}

export async function moveProspectAction(id: string, status: string): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    if (!isLeadStatus(status)) return { error: "That status is not valid." };
    await changeLeadStatus(actor(session), id, status);
    revalidatePath("/pipeline");
    revalidatePath("/prospects");
    revalidatePath(`/prospects/${id}`);
    revalidatePath("/dashboard");
    return { success: "Lead status updated." };
  });
}
