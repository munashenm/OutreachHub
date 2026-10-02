"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/format";
import { runAction } from "@/lib/run-action";
import { requireSession } from "@/services/auth-service";
import { mergeCatalogueItems, readStoreCatalogueBatch, reviewCatalogueItem } from "@/services/catalogue-service";

export async function readStoreCatalogueAction(): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await readStoreCatalogueBatch(session.workspace.id);
    revalidatePath("/catalogue");
    if (!result.done) {
      return { success: `Read ${result.imported.toLocaleString("en-GB")} of ${result.total.toLocaleString("en-GB")} store products. The website is not being changed.`, pending: true };
    }
    const stats = result.stats;
    return {
      success: `Read ${(stats?.total ?? result.total).toLocaleString("en-GB")} store products. ${stats?.duplicateSkuGroups ?? 0} duplicate SKUs, ${stats?.missingImages ?? 0} missing images, ${stats?.withoutSku ?? 0} without a SKU, ${stats?.withoutPrice ?? 0} without a price, ${stats?.zeroStock ?? 0} with zero stock, and ${stats?.readyForSupplierMatching ?? 0} ready for supplier matching. The website was not changed.`,
    };
  });
}

export async function reviewCatalogueItemAction(itemId: string, action: "accept" | "reject" | "ignore" | "image"): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const summary = await reviewCatalogueItem(session.workspace.id, itemId, action);
    revalidatePath("/catalogue");
    return { success: summary };
  });
}

export async function mergeCatalogueItemAction(itemId: string, targetStoreProductId: string): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    await mergeCatalogueItems(session.workspace.id, itemId, targetStoreProductId);
    revalidatePath("/catalogue");
    return { success: "Merged locally. The website product was not deleted." };
  });
}
