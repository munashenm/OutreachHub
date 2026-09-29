"use client";

import { useActionState } from "react";
import { createCampaignAction, updateCampaignAction } from "@/actions/campaign-actions";
import { CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABELS, type CampaignStatus } from "@/lib/labels";
import { initialActionState } from "@/lib/format";
import { Field, Notice, buttonPrimary, inputClass, textAreaClass } from "@/components/ui";

export type CampaignFormValues = {
  name: string;
  description: string;
  status: CampaignStatus;
  senderAccount: string;
  dailyLimit: string;
  timezone: string;
  sendingStartTime: string;
  sendingEndTime: string;
};

export function CampaignForm({
  mode,
  id,
  initial,
}: {
  mode: "create" | "edit";
  id?: string;
  initial?: Partial<CampaignFormValues>;
}) {
  const action = mode === "create" ? createCampaignAction : updateCampaignAction;
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const values: CampaignFormValues = {
    name: "",
    description: "",
    status: "DRAFT",
    senderAccount: "",
    dailyLimit: "50",
    timezone: "UTC",
    sendingStartTime: "08:00",
    sendingEndTime: "17:00",
    ...initial,
  };

  return (
    <form action={formAction} className="grid gap-4 md:grid-cols-2">
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {state.error ? <div className="md:col-span-2"><Notice tone="error">{state.error}</Notice></div> : null}
      {state.success ? <div className="md:col-span-2"><Notice tone="success">{state.success}</Notice></div> : null}
      <Field label="Name" name="name" error={state.fieldErrors?.name}>
        <input id="name" name="name" defaultValue={values.name} required className={inputClass} />
      </Field>
      <Field label="Status" name="status" error={state.fieldErrors?.status}>
        <select id="status" name="status" defaultValue={values.status} className={inputClass}>
          {CAMPAIGN_STATUSES.map((status) => (
            <option key={status} value={status}>{CAMPAIGN_STATUS_LABELS[status]}</option>
          ))}
        </select>
      </Field>
      <div className="md:col-span-2">
        <Field label="Description" name="description" error={state.fieldErrors?.description}>
          <textarea id="description" name="description" defaultValue={values.description} className={textAreaClass} />
        </Field>
      </div>
      <Field label="Sender account" name="senderAccount" error={state.fieldErrors?.senderAccount}>
        <input id="senderAccount" name="senderAccount" defaultValue={values.senderAccount} placeholder="name@company.com" className={inputClass} />
      </Field>
      <Field label="Daily limit" name="dailyLimit" error={state.fieldErrors?.dailyLimit}>
        <input id="dailyLimit" name="dailyLimit" type="number" min={1} max={1000} defaultValue={values.dailyLimit} className={inputClass} />
      </Field>
      <Field label="Timezone" name="timezone" error={state.fieldErrors?.timezone}>
        <input id="timezone" name="timezone" defaultValue={values.timezone} className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Send from" name="sendingStartTime" error={state.fieldErrors?.sendingStartTime}>
          <input id="sendingStartTime" name="sendingStartTime" defaultValue={values.sendingStartTime} className={inputClass} />
        </Field>
        <Field label="Send until" name="sendingEndTime" error={state.fieldErrors?.sendingEndTime}>
          <input id="sendingEndTime" name="sendingEndTime" defaultValue={values.sendingEndTime} className={inputClass} />
        </Field>
      </div>
      <p className="text-sm text-muted md:col-span-2">Saving an active campaign does not send email. Sending is not part of this release.</p>
      <div>
        <button className={buttonPrimary} disabled={pending}>{pending ? "Saving..." : mode === "create" ? "Create campaign" : "Save campaign"}</button>
      </div>
    </form>
  );
}
