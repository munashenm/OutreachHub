"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/format";
import { runAction } from "@/lib/run-action";
import { AppError } from "@/lib/errors";
import { assertCanManageWorkspace, requireSession } from "@/services/auth-service";
import { syncGmailMailbox } from "@/services/gmail-sync-service";

export async function syncMailboxNowAction(mailboxId: string): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    assertCanManageWorkspace(session.role);
    if (!mailboxId) throw new AppError("Mailbox not found.", 404, "NOT_FOUND");
    const synced = await syncGmailMailbox(mailboxId, session.workspace.id);
    revalidatePath("/settings/mailboxes");
    return { success: `Synced ${synced} messages.` };
  });
}
