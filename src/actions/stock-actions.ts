"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/format";
import { runAction } from "@/lib/run-action";
import { fieldErrors, readForm, storeConnectionSchema, supplierFeedSchema } from "@/lib/validators";
import { requireSession } from "@/services/auth-service";
import { pushStoreStock, saveStoreConnection, saveSupplierFeed, syncSupplierFeed, testStoreConnection } from "@/services/stock-sync-service";

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
    const held = result.pricesHeld > 0 ? ` ${result.pricesHeld} prices stayed unchanged because the cost was missing or below the minimum margin.` : "";
    const flagged = result.priceChangesFlagged > 0 ? ` ${result.priceChangesFlagged} large price changes are waiting for approval on the product.` : "";
    if (result.skipped) return { success: "This feed was synced recently. The next automatic sync will run when its interval is due." };
    return { success: `Updated ${result.updated} products. ${result.unmatched} supplier rows are not in the catalogue.${held}${flagged}` };
  });
}

export async function saveStoreConnectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const parsed = storeConnectionSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await saveStoreConnection(actor(session), parsed.data);
    revalidatePath("/settings");
    return { success: "Store connection saved." };
  });
}

export async function testStoreConnectionAction(): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    await testStoreConnection(session.workspace.id);
    revalidatePath("/settings");
    return { success: "The store accepted the API key." };
  });
}

export async function pushStoreStockAction(): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await pushStoreStock(session.workspace.id);
    revalidatePath("/settings");
    const held = result.pricesHeld > 0 ? ` ${result.pricesHeld} prices were not sent because they were below the minimum margin.` : "";
    const skipped = result.skippedNew > 0 ? ` ${result.skippedNew} products were not created, because the website catalogue is the baseline.` : "";
    if (!result.pending && result.pushed === 0 && result.pricesHeld === 0 && result.skippedNew === 0) return { success: "No catalogue changes are waiting for the store." };
    return { success: `Sent ${result.pushed} products to the store.${held}${skipped}${result.pending ? " More products are still waiting." : ""}` };
  });
}
