"use client";

import { useActionState } from "react";
import { createCompanyAction, updateCompanyAction } from "@/actions/company-actions";
import { initialActionState } from "@/lib/format";
import { Field, Notice, buttonPrimary, inputClass, textAreaClass } from "@/components/ui";

export type CompanyFormValues = {
  companyName: string;
  website: string;
  industry: string;
  companySize: string;
  phone: string;
  country: string;
  province: string;
  city: string;
  notes: string;
};

export function CompanyForm({
  mode,
  id,
  initial,
}: {
  mode: "create" | "edit";
  id?: string;
  initial?: Partial<CompanyFormValues>;
}) {
  const action = mode === "create" ? createCompanyAction : updateCompanyAction;
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const values = initial ?? {};
  return (
    <form action={formAction} className="grid gap-4 md:grid-cols-2">
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {state.error ? <div className="md:col-span-2"><Notice tone="error">{state.error}</Notice></div> : null}
      <Field label="Company name" name="companyName" error={state.fieldErrors?.companyName}>
        <input id="companyName" name="companyName" defaultValue={values.companyName} required className={inputClass} />
      </Field>
      <Field label="Website" name="website" error={state.fieldErrors?.website}>
        <input id="website" name="website" defaultValue={values.website} placeholder="https://" className={inputClass} />
      </Field>
      <Field label="Industry" name="industry" error={state.fieldErrors?.industry}>
        <input id="industry" name="industry" defaultValue={values.industry} className={inputClass} />
      </Field>
      <Field label="Company size" name="companySize" error={state.fieldErrors?.companySize}>
        <input id="companySize" name="companySize" defaultValue={values.companySize} list="company-sizes" className={inputClass} />
        <datalist id="company-sizes">
          <option value="1-10" />
          <option value="11-50" />
          <option value="51-200" />
          <option value="201-500" />
          <option value="501-1000" />
          <option value="1000+" />
        </datalist>
      </Field>
      <Field label="Phone" name="phone" error={state.fieldErrors?.phone}>
        <input id="phone" name="phone" defaultValue={values.phone} className={inputClass} />
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
      <div className="md:col-span-2">
        <Field label="Notes" name="notes" error={state.fieldErrors?.notes}>
          <textarea id="notes" name="notes" defaultValue={values.notes} className={textAreaClass} />
        </Field>
      </div>
      <div>
        <button className={buttonPrimary} disabled={pending}>{pending ? "Saving..." : mode === "create" ? "Create company" : "Save changes"}</button>
      </div>
    </form>
  );
}
