"use client";

import { useActionState, useState } from "react";
import { saveSupplierScorecardAction } from "@/actions/supplier-actions";
import { Badge, Field, Notice, buttonPrimary, inputClass, textAreaClass } from "@/components/ui";
import { initialActionState } from "@/lib/format";
import { SCORECARD_FIELDS, SUPPLIER_CLASS_LABELS, SUPPLIER_CLASS_TONE, classifySupplier, type SupplierScores } from "@/lib/supplier-scorecard";

export function SupplierScorecardForm({ supplierId, scores, notes }: { supplierId: string; scores: SupplierScores; notes: string }) {
  const [state, action, pending] = useActionState(saveSupplierScorecardAction, initialActionState);
  const [current, setCurrent] = useState(scores);
  const result = classifySupplier(current);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="supplierId" value={supplierId} />
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={SUPPLIER_CLASS_TONE[result.supplierClass]}>{SUPPLIER_CLASS_LABELS[result.supplierClass]}</Badge>
        <p className="text-sm text-muted">{result.points == null ? "Out of 100 once every score is set." : `${result.points} / 100`}</p>
      </div>
      <p className="text-sm text-muted">{result.reason}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {SCORECARD_FIELDS.map((field) => (
          <Field key={field.key} label={field.label} name={field.key} error={state.fieldErrors?.[field.key]}>
            <select
              id={field.key}
              name={field.key}
              className={inputClass}
              value={current[field.key] ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setCurrent((previous) => ({ ...previous, [field.key]: value === "" ? null : Number(value) }));
              }}
            >
              <option value="">Not scored</option>
              <option value="1">1 — weak</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5 — strong</option>
            </select>
            <span className="mt-1 block text-xs text-muted">{field.hint}</span>
          </Field>
        ))}
      </div>
      <Field label="Notes" name="notes" error={state.fieldErrors?.notes}>
        <textarea id="notes" name="notes" defaultValue={notes} className={textAreaClass} />
      </Field>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}
      <button className={buttonPrimary} disabled={pending}>{pending ? "Saving..." : "Save scorecard"}</button>
    </form>
  );
}
