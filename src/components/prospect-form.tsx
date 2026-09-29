"use client";

import { useActionState } from "react";
import { createProspectAction, updateProspectAction } from "@/actions/prospect-actions";
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  MARKETING_STATUSES,
  MARKETING_STATUS_LABELS,
  type LeadStatus,
  type MarketingStatus,
} from "@/lib/labels";
import { initialActionState } from "@/lib/format";
import { Field, Notice, buttonPrimary, inputClass, textAreaClass } from "@/components/ui";

export type ProspectFormValues = {
  firstName: string;
  lastName: string;
  jobTitle: string;
  email: string;
  phone: string;
  companyId: string;
  website: string;
  industry: string;
  country: string;
  province: string;
  city: string;
  source: string;
  linkedinUrl: string;
  notes: string;
  leadStatus: LeadStatus;
  marketingStatus: MarketingStatus;
};

export function ProspectForm({
  mode,
  id,
  companies,
  initial,
}: {
  mode: "create" | "edit";
  id?: string;
  companies: { id: string; companyName: string }[];
  initial?: Partial<ProspectFormValues>;
}) {
  const action = mode === "create" ? createProspectAction : updateProspectAction;
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const values = { leadStatus: "NEW", marketingStatus: "UNKNOWN", companyId: "", ...initial };

  return (
    <form action={formAction} className="grid gap-4 md:grid-cols-2">
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {state.error ? <div className="md:col-span-2"><Notice tone="error">{state.error}</Notice></div> : null}
      <Field label="First name" name="firstName" error={state.fieldErrors?.firstName}>
        <input id="firstName" name="firstName" defaultValue={values.firstName} required className={inputClass} />
      </Field>
      <Field label="Last name" name="lastName" error={state.fieldErrors?.lastName}>
        <input id="lastName" name="lastName" defaultValue={values.lastName} required className={inputClass} />
      </Field>
      <Field label="Job title" name="jobTitle" error={state.fieldErrors?.jobTitle}>
        <input id="jobTitle" name="jobTitle" defaultValue={values.jobTitle} className={inputClass} />
      </Field>
      <Field label="Email" name="email" error={state.fieldErrors?.email}>
        <input id="email" name="email" type="email" defaultValue={values.email} required className={inputClass} />
      </Field>
      <Field label="Phone" name="phone" error={state.fieldErrors?.phone}>
        <input id="phone" name="phone" defaultValue={values.phone} className={inputClass} />
      </Field>
      <Field label="Company" name="companyId" error={state.fieldErrors?.companyId}>
        <select id="companyId" name="companyId" defaultValue={values.companyId} className={inputClass}>
          <option value="">No company</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>{company.companyName}</option>
          ))}
        </select>
      </Field>
      <Field label="Or create a company" name="newCompanyName" error={state.fieldErrors?.newCompanyName}>
        <input id="newCompanyName" name="newCompanyName" className={inputClass} placeholder="Used when no company is selected" />
      </Field>
      <Field label="Website" name="website" error={state.fieldErrors?.website}>
        <input id="website" name="website" defaultValue={values.website} placeholder="https://" className={inputClass} />
      </Field>
      <Field label="Industry" name="industry" error={state.fieldErrors?.industry}>
        <input id="industry" name="industry" defaultValue={values.industry} className={inputClass} />
      </Field>
      <Field label="Country" name="country" error={state.fieldErrors?.country}>
        <input id="country" name="country" defaultValue={values.country} className={inputClass} />
      </Field>
      <Field label="Province" name="province" error={state.fieldErrors?.province}>
        <input id="province" name="province" defaultValue={values.province} className={inputClass} />
      </Field>
      <Field label="City" name="city" error={state.fieldErrors?.city}>
        <input id="city" name="city" defaultValue={values.city} className={inputClass} />
      </Field>
      <Field label="Source" name="source" error={state.fieldErrors?.source}>
        <input id="source" name="source" defaultValue={values.source} className={inputClass} />
      </Field>
      <Field label="LinkedIn URL" name="linkedinUrl" error={state.fieldErrors?.linkedinUrl}>
        <input id="linkedinUrl" name="linkedinUrl" defaultValue={values.linkedinUrl} placeholder="https://" className={inputClass} />
      </Field>
      <Field label="Lead status" name="leadStatus" error={state.fieldErrors?.leadStatus}>
        <select id="leadStatus" name="leadStatus" defaultValue={values.leadStatus} className={inputClass}>
          {LEAD_STATUSES.map((status) => (
            <option key={status} value={status}>{LEAD_STATUS_LABELS[status]}</option>
          ))}
        </select>
      </Field>
      <Field label="Marketing status" name="marketingStatus" error={state.fieldErrors?.marketingStatus}>
        <select id="marketingStatus" name="marketingStatus" defaultValue={values.marketingStatus} className={inputClass}>
          {MARKETING_STATUSES.map((status) => (
            <option key={status} value={status}>{MARKETING_STATUS_LABELS[status]}</option>
          ))}
        </select>
      </Field>
      <div className="md:col-span-2">
        <Field label="Notes" name="notes" error={state.fieldErrors?.notes}>
          <textarea id="notes" name="notes" defaultValue={values.notes} className={textAreaClass} />
        </Field>
      </div>
      <div className="md:col-span-2">
        <button className={buttonPrimary} disabled={pending}>{pending ? "Saving..." : mode === "create" ? "Create prospect" : "Save changes"}</button>
      </div>
    </form>
  );
}
