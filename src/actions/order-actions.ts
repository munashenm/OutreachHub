"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/format";
import { runAction } from "@/lib/run-action";
import { requireSession } from "@/services/auth-service";
import { createProspectFromOrder, pullStoreOrders } from "@/services/store-order-service";

export async function pullStoreOrdersAction(): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await pullStoreOrders({ userId: session.user.id, workspaceId: session.workspace.id });
    revalidatePath("/orders");
    return { success: `Imported ${result.created} orders. ${result.matched} match an existing customer.` };
  });
}

export async function createProspectFromOrderAction(orderId: string): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const prospectId = await createProspectFromOrder(
      { userId: session.user.id, workspaceId: session.workspace.id },
      orderId,
    );
    redirect(`/prospects/${prospectId}`);
  });
}
