"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/format";
import { runAction } from "@/lib/run-action";
import { companySchema, fieldErrors, readForm } from "@/lib/validators";
import { requireSession } from "@/services/auth-service";
import { createCompany, deleteCompany, updateCompany } from "@/services/company-service";

function actor(session: Awaited<ReturnType<typeof requireSession>>) {
  return { userId: session.user.id, workspaceId: session.workspace.id };
}

export async function createCompanyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const parsed = companySchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    const company = await createCompany(actor(session), parsed.data);
    revalidatePath("/companies");
    redirect(`/companies/${company.id}?status=created`);
  });
}

export async function updateCompanyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const id = String(formData.get("id") ?? "");
    const parsed = companySchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await updateCompany(actor(session), id, parsed.data);
    revalidatePath("/companies");
    revalidatePath(`/companies/${id}`);
    redirect(`/companies/${id}?status=updated`);
  });
}

export async function deleteCompanyAction(id: string): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    await deleteCompany(actor(session), id);
    revalidatePath("/companies");
    redirect("/companies?status=deleted");
  });
}
