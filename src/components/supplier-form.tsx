"use client";

import { useActionState } from "react";
import { createSupplierAction } from "@/actions/supplier-actions";
import { Field, Notice, buttonPrimary, inputClass, textAreaClass } from "@/components/ui";
import { initialActionState } from "@/lib/format";

export function SupplierForm() {
  const [state, formAction, pending] = useActionState(createSupplierAction, initialActionState);
  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Field label="Name" name="name" error={state.fieldErrors?.name}>
        <input id="name" name="name" required className={inputClass} />
      </Field>
      <Field label="Email" name="email" error={state.fieldErrors?.email}>
        <input id="email" name="email" type="email" className={inputClass} />
      </Field>
      <Field label="Notes" name="notes">
        <textarea id="notes" name="notes" className={textAreaClass} />
      </Field>
      <button className={buttonPrimary} disabled={pending}>{pending ? "Saving..." : "Save supplier"}</button>
    </form>
  );
}
