"use client";

import { useActionState } from "react";
import { createProductAction, updateProductAction } from "@/actions/product-actions";
import { Field, Notice, buttonPrimary, inputClass, textAreaClass } from "@/components/ui";
import { initialActionState } from "@/lib/format";

export function ProductForm({
  mode,
  id,
  initial,
}: {
  mode: "create" | "edit";
  id?: string;
  initial?: { sku: string; name: string; description: string; unitPrice: string; active: boolean };
}) {
  const action = mode === "create" ? createProductAction : updateProductAction;
  const [state, formAction, pending] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="grid gap-4 md:grid-cols-2">
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {state.error ? <div className="md:col-span-2"><Notice tone="error">{state.error}</Notice></div> : null}
      {state.success ? <div className="md:col-span-2"><Notice tone="success">{state.success}</Notice></div> : null}
      <Field label="SKU" name="sku" error={state.fieldErrors?.sku}>
        <input id="sku" name="sku" defaultValue={initial?.sku} required className={inputClass} />
      </Field>
      <Field label="Name" name="name" error={state.fieldErrors?.name}>
        <input id="name" name="name" defaultValue={initial?.name} required className={inputClass} />
      </Field>
      <Field label="Unit price (ZAR)" name="unitPrice" error={state.fieldErrors?.unitPrice}>
        <input id="unitPrice" name="unitPrice" defaultValue={initial?.unitPrice} required className={inputClass} />
      </Field>
      <Field label="Active" name="active">
        <select id="active" name="active" defaultValue={initial?.active === false ? "false" : "true"} className={inputClass}>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </Field>
      <div className="md:col-span-2">
        <Field label="Description" name="description">
          <textarea id="description" name="description" defaultValue={initial?.description} className={textAreaClass} />
        </Field>
      </div>
      <button className={buttonPrimary} disabled={pending}>{pending ? "Saving..." : "Save product"}</button>
    </form>
  );
}
