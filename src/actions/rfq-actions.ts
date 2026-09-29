"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/format";
import { isRfqStatus } from "@/lib/labels";
import { runAction } from "@/lib/run-action";
import { readForm } from "@/lib/validators";
import { requireSession } from "@/services/auth-service";
import { updateRfq } from "@/services/rfq-service";

export async function updateRfqAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const values = readForm(formData);
    const status = values.status ?? "";
    if (!isRfqStatus(status)) return { error: "Choose a status." };
    await updateRfq(
      { userId: session.user.id, workspaceId: session.workspace.id },
      values.id ?? "",
      { status, notes: values.notes ?? "" },
    );
    revalidatePath(`/rfqs/${values.id}`);
    revalidatePath("/rfqs");
    revalidatePath("/dashboard");
    return { success: "RFQ saved." };
  });
}
