"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/format";
import { runAction } from "@/lib/run-action";
import { fieldErrors, readForm, storeConnectionSchema, supplierFeedSchema } from "@/lib/validators";
import { requireSession } from "@/services/auth-service";
import { pushStoreStock, saveStoreConnection, saveSupplierFeed, syncSupplierFeed } from "@/services/stock-sync-service";

function actor(session: Awaited<ReturnType<typeof requireSession>>) {
  return { userId: session.user.id, workspaceId: session.workspace.id };
}

export async function saveSupplierFeedAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const parsed = supplierFeedSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await saveSupplierFeed(actor(session), parsed.data);
    revalidatePath(`/suppliers/${parsed.data.supplierId}`);
    return { success: "Stock feed saved." };
  });
}

export async function syncSupplierFeedAction(supplierId: string): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await syncSupplierFeed(actor(session), supplierId);
    revalidatePath(`/suppliers/${supplierId}`);
    revalidatePath("/products");
    return { success: `Updated ${result.updated} products. ${result.unmatched} supplier SKUs are not in the catalogue.` };
  });
}

export async function saveStoreConnectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const parsed = storeConnectionSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await saveStoreConnection(actor(session), parsed.data);
    revalidatePath("/settings");
    return { success: "Website connection saved." };
  });
}

export async function pushStoreStockAction(): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await pushStoreStock(session.workspace.id);
    revalidatePath("/settings");
    if (!result.pending && result.pushed === 0 && result.missing === 0) return { success: "No stock changes are waiting for the website." };
    return { success: `Sent ${result.pushed} products to the website. ${result.missing} SKUs are not on the website yet.${result.pending ? " More products are still waiting." : ""}` };
  });
}
