"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/format";
import { runAction } from "@/lib/run-action";
import { fieldErrors, quoteLineSchema, quoteSendSchema, readForm } from "@/lib/validators";
import { requireSession } from "@/services/auth-service";
import { addQuoteLine, removeQuoteLine, sendQuote } from "@/services/quote-service";

function actor(session: Awaited<ReturnType<typeof requireSession>>) {
  return { userId: session.user.id, workspaceId: session.workspace.id };
}

export async function addQuoteLineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const parsed = quoteLineSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await addQuoteLine(actor(session), parsed.data);
    revalidatePath(`/rfqs/${parsed.data.rfqId}`);
    return { success: "Line added." };
  });
}

export async function removeQuoteLineAction(rfqId: string, lineId: string): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    await removeQuoteLine(actor(session), lineId);
    revalidatePath(`/rfqs/${rfqId}`);
    return { success: "Line removed." };
  });
}

export async function sendQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const parsed = quoteSendSchema.safeParse(readForm(formData));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the quotation details." };
    await sendQuote(actor(session), parsed.data.rfqId, {
      validDays: parsed.data.validDays,
      notes: parsed.data.notes,
      documentMode: parsed.data.documentMode,
      exportQuote: parsed.data.exportQuote === "true",
      references: parsed.data.references,
    });
    revalidatePath(`/rfqs/${parsed.data.rfqId}`);
    revalidatePath("/inbox");
    revalidatePath("/dashboard");
    return { success: "Quote sent." };
  });
}
