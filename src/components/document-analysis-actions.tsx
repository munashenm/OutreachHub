"use client";

import { useActionState } from "react";
import { generateDocumentQuoteAction } from "@/actions/document-actions";
import { sendQuoteAction } from "@/actions/quote-actions";
import { buttonSecondary } from "@/components/ui";
import { initialActionState } from "@/lib/format";

export function GenerateQuoteButton({ rfqId }: { rfqId: string }) {
  const [state, action, pending] = useActionState(generateDocumentQuoteAction, initialActionState);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={rfqId} />
      <button className={buttonSecondary} disabled={pending}>{pending ? "Generating..." : "Generate Quote"}</button>
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-muted">{state.success}</p> : null}
    </form>
  );
}

export function ApproveSendButton({ rfqId, disabled, reason }: { rfqId: string; disabled: boolean; reason: string }) {
  const [state, action, pending] = useActionState(sendQuoteAction, initialActionState);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="rfqId" value={rfqId} />
      <input type="hidden" name="validDays" value="14" />
      <input type="hidden" name="notes" value="" />
      <input type="hidden" name="documentMode" value="STANDARD" />
      <input type="hidden" name="references" value="" />
      <button className={buttonSecondary} disabled={disabled || pending}>{pending ? "Sending..." : "Approve & Send"}</button>
      {reason ? <p className="max-w-xl text-sm text-muted">{reason}</p> : null}
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-muted">{state.success}</p> : null}
    </form>
  );
}
