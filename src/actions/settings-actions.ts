"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/format";
import { runAction } from "@/lib/run-action";
import { fieldErrors, quoteSettingsSchema, readForm, suppressionSchema, workspaceSchema } from "@/lib/validators";
import { saveQuoteSettings } from "@/services/quotation-pdf-service";
import {
  assertCanManageWorkspace,
  createAdditionalWorkspace,
  renameWorkspace,
  requireSession,
  switchWorkspace,
} from "@/services/auth-service";
import { addSuppression, removeSuppression } from "@/services/suppression-service";

function actor(session: Awaited<ReturnType<typeof requireSession>>) {
  return { userId: session.user.id, workspaceId: session.workspace.id };
}

export async function switchWorkspaceAction(formData: FormData) {
  const session = await requireSession();
  await switchWorkspace(session.user.id, String(formData.get("workspaceId") ?? ""));
  redirect("/dashboard");
}

export async function createWorkspaceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const parsed = workspaceSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createAdditionalWorkspace(session.user.id, parsed.data.name);
    redirect("/dashboard?status=workspace");
  });
}

export async function renameWorkspaceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    assertCanManageWorkspace(session.role);
    const parsed = workspaceSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await renameWorkspace(session.workspace.id, parsed.data.name);
    revalidatePath("/settings");
    return { success: "Workspace name updated." };
  });
}

export async function saveQuoteSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    assertCanManageWorkspace(session.role);
    const parsed = quoteSettingsSchema.safeParse(readForm(formData));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the quotation settings." };
    const data = parsed.data;
    await saveQuoteSettings(actor(session), {
      legalName: data.legalName,
      addressLines: data.address.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      phone: data.phone,
      email: data.email,
      website: data.website,
      vatNumber: data.vatNumber,
      showVatNumber: data.showVatNumber === "true",
      showBanking: data.showBanking === "true",
      bankName: data.bankName,
      accountName: data.accountName,
      accountNumber: data.accountNumber,
      branchCode: data.branchCode,
      accountType: data.accountType,
      availability: data.availability,
      leadTime: data.leadTime,
      paymentTerms: data.paymentTerms,
      validity: data.validity,
      delivery: data.delivery,
      newGenuine: data.newGenuine,
      substitution: data.substitution,
      taxes: data.taxes,
      warranty: data.warranty,
      exportNote: data.exportNote,
    });
    revalidatePath("/settings");
    return { success: "Quotation settings saved." };
  });
}

export async function addSuppressionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const parsed = suppressionSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await addSuppression(actor(session), parsed.data);
    revalidatePath("/settings/suppression");
    return { success: "Address added to the suppression list." };
  });
}

export async function removeSuppressionAction(id: string): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    await removeSuppression(actor(session), id);
    revalidatePath("/settings/suppression");
    return { success: "Address removed from the suppression list." };
  });
}
