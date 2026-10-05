"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/services/auth-service";
import { analyseRfqDocuments, correctAnalysisField, generateQuoteFromAnalysis } from "@/services/document-analysis-service";
import { findDocumentProducts } from "@/services/rfq-automation-service";
import { runAction } from "@/lib/run-action";
import type { ActionState } from "@/lib/format";

function actor(session: Awaited<ReturnType<typeof requireSession>>) {
  return { userId: session.user.id, workspaceId: session.workspace.id };
}

export async function analyseDocumentsAction(formData: FormData) {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  await analyseRfqDocuments(session.workspace.id, id);
  revalidatePath(`/rfqs/${id}`);
}

export async function findDocumentProductsAction(formData: FormData) {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  await findDocumentProducts(session.workspace.id, id);
  revalidatePath(`/rfqs/${id}`);
}

export async function generateDocumentQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const id = String(formData.get("id") ?? "");
    await generateQuoteFromAnalysis(actor(session), id);
    revalidatePath(`/rfqs/${id}`);
    return { success: "Quotation prepared from the document. It has not been sent." };
  });
}

export async function correctAnalysisAction(formData: FormData) {
  const session = await requireSession();
  const id = String(formData.get("rfqId") ?? "");
  await correctAnalysisField(actor(session), String(formData.get("analysisId") ?? ""), String(formData.get("field") ?? ""), String(formData.get("value") ?? ""));
  revalidatePath(`/rfqs/${id}`);
}
