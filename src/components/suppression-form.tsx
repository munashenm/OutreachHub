"use client";

import { useActionState } from "react";
import { addSuppressionAction } from "@/actions/settings-actions";
import { Field, Notice, buttonPrimary, inputClass } from "@/components/ui";
import { initialActionState } from "@/lib/format";

export function SuppressionForm({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(addSuppressionAction, initialActionState);
  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      {state.error ? <div className="md:col-span-2"><Notice tone="error">{state.error}</Notice></div> : null}
      {state.success ? <div className="md:col-span-2"><Notice tone="success">{state.success}</Notice></div> : null}
      <Field label="Email" name="email" error={state.fieldErrors?.email}>
        <input id="email" name="email" type="email" required className={inputClass} />
      </Field>
      <Field label="Reason" name="reason" error={state.fieldErrors?.reason}>
        <input id="reason" name="reason" required className={inputClass} />
      </Field>
      <Field label="Source" name="source" error={state.fieldErrors?.source}>
        <input id="source" name="source" placeholder="manual" className={inputClass} />
      </Field>
      <Field label="Campaign" name="campaignId" error={state.fieldErrors?.campaignId}>
        <select id="campaignId" name="campaignId" className={inputClass} defaultValue="">
          <option value="">None</option>
          {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
        </select>
      </Field>
      <div>
        <button className={buttonPrimary} disabled={pending}>Add to suppression list</button>
      </div>
    </form>
  );
}
