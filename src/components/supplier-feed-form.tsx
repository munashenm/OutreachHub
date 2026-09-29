"use client";

import { useActionState, useState } from "react";
import { saveSupplierFeedAction, syncSupplierFeedAction } from "@/actions/stock-actions";
import { Field, buttonPrimary, buttonSecondary, inputClass } from "@/components/ui";
import { initialActionState } from "@/lib/format";

export function SupplierFeedForm({
  supplierId,
  markupPercent,
  stockFeedUrl,
  hasKey,
}: {
  supplierId: string;
  markupPercent: number;
  stockFeedUrl: string;
  hasKey: boolean;
}) {
  const [state, action, pending] = useActionState(saveSupplierFeedAction, initialActionState);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string>();
  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-3 md:grid-cols-2">
        {state.error ? <p className="text-sm text-red-700 md:col-span-2">{state.error}</p> : null}
        {state.success ? <p className="text-sm text-muted md:col-span-2">{state.success}</p> : null}
        <input type="hidden" name="supplierId" value={supplierId} />
        <Field label="Markup percent" name="markupPercent" error={state.fieldErrors?.markupPercent}>
          <input id="markupPercent" name="markupPercent" type="number" min={0} max={300} defaultValue={markupPercent} required className={inputClass} />
        </Field>
        <Field label="Stock feed URL" name="stockFeedUrl" error={state.fieldErrors?.stockFeedUrl}>
          <input id="stockFeedUrl" name="stockFeedUrl" type="url" defaultValue={stockFeedUrl} placeholder="https://supplier.example/stock.json" className={inputClass} />
        </Field>
        <Field label="Feed API key" name="stockFeedKey" error={state.fieldErrors?.stockFeedKey}>
          <input id="stockFeedKey" name="stockFeedKey" type="password" autoComplete="off" placeholder={hasKey ? "Saved. Enter a new key to replace it." : "Optional bearer token"} className={inputClass} />
        </Field>
        <div className="md:col-span-2">
          <button className={buttonSecondary} disabled={pending}>{pending ? "Saving..." : "Save feed"}</button>
        </div>
      </form>
      <button
        type="button"
        className={buttonPrimary}
        disabled={syncing}
        onClick={() => {
          setSyncing(true);
          void syncSupplierFeedAction(supplierId).then((result) => {
            setSyncMessage(result.error ?? result.success);
            setSyncing(false);
          });
        }}
      >
        {syncing ? "Syncing..." : "Sync stock now"}
      </button>
      {syncMessage ? <p className="text-sm text-muted">{syncMessage}</p> : null}
      <p className="text-sm text-muted">The feed is JSON: items with sku, cost in rands, and stock. A 15 markup turns a R100 cost into a R115 sell price. Stock level is the total available from every supplier linked to that SKU.</p>
    </div>
  );
}
