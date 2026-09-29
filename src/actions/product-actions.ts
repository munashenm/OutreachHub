"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/format";
import { runAction } from "@/lib/run-action";
import { fieldErrors, productSchema, readForm } from "@/lib/validators";
import { requireSession } from "@/services/auth-service";
import { createProduct, updateProduct } from "@/services/product-service";

function actor(session: Awaited<ReturnType<typeof requireSession>>) {
  return { userId: session.user.id, workspaceId: session.workspace.id };
}

export async function createProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const parsed = productSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    const product = await createProduct(actor(session), parsed.data);
    revalidatePath("/products");
    redirect(`/products/${product.id}/edit?status=created`);
  });
}

export async function updateProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const id = String(formData.get("id") ?? "");
    const parsed = productSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await updateProduct(actor(session), id, parsed.data);
    revalidatePath("/products");
    return { success: "Product saved." };
  });
}
