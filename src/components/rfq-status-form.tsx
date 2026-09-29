"use client";

import { useActionState } from "react";
import { updateRfqAction } from "@/actions/rfq-actions";
import { Field, Notice, buttonPrimary } from "@/components/ui";
import { initialActionState } from "@/lib/format";
import { RFQ_STATUSES, RFQ_STATUS_LABELS, type RfqStatus } from "@/lib/labels";

export function RfqStatusForm({ id, status, notes }: { id: string; status: RfqStatus; notes: string }) {
  const [state, formAction, pending] = useActionState(updateRfqAction, initialActionState);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}
      <Field label="Status" name="status">
        <select id="status" name="status" defaultValue={status} className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm">
          {RFQ_STATUSES.map((item) => <option key={item} value={item}>{RFQ_STATUS_LABELS[item]}</option>)}
        </select>
      </Field>
      <Field label="Notes" name="notes">
        <textarea id="notes" name="notes" defaultValue={notes} className="min-h-28 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" />
      </Field>
      <button className={buttonPrimary} disabled={pending}>{pending ? "Saving..." : "Save RFQ"}</button>
    </form>
  );
}
