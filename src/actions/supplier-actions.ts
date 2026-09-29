"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/format";
import { runAction } from "@/lib/run-action";
import { fieldErrors, readForm, supplierSchema } from "@/lib/validators";
import { requireSession } from "@/services/auth-service";
import { createSupplier } from "@/services/supplier-service";

export async function createSupplierAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const parsed = supplierSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    const supplier = await createSupplier(
      { userId: session.user.id, workspaceId: session.workspace.id },
      parsed.data,
    );
    revalidatePath("/suppliers");
    redirect(`/suppliers/${supplier.id}`);
  });
}
