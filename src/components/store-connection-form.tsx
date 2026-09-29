"use client";

import { useActionState, useState } from "react";
import { pushStoreStockAction, saveStoreConnectionAction } from "@/actions/stock-actions";
import { Field, buttonPrimary, buttonSecondary, inputClass } from "@/components/ui";
import { initialActionState } from "@/lib/format";

export function StoreConnectionForm({ baseUrl, connected }: { baseUrl: string; connected: boolean }) {
  const [state, action, pending] = useActionState(saveStoreConnectionAction, initialActionState);
  const [pushing, setPushing] = useState(false);
  const [pushMessage, setPushMessage] = useState<string>();
  return (
    <div className="space-y-4">
      <form action={action} className="grid max-w-xl gap-3">
        {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
        {state.success ? <p className="text-sm text-muted">{state.success}</p> : null}
        <Field label="Website address" name="storeBaseUrl">
          <input id="storeBaseUrl" name="storeBaseUrl" type="url" defaultValue={baseUrl} placeholder="https://www.urbanfocus.co.za" className={inputClass} />
        </Field>
        <Field label="WooCommerce consumer key" name="consumerKey">
          <input id="consumerKey" name="consumerKey" type="password" autoComplete="off" placeholder={connected ? "Saved. Enter a new key to replace it." : "ck_..."} className={inputClass} />
        </Field>
        <Field label="WooCommerce consumer secret" name="consumerSecret">
          <input id="consumerSecret" name="consumerSecret" type="password" autoComplete="off" placeholder={connected ? "Saved. Enter a new secret to replace it." : "cs_..."} className={inputClass} />
        </Field>
        <button className={buttonSecondary} disabled={pending}>{pending ? "Saving..." : "Save website"}</button>
      </form>
      <button
        type="button"
        className={buttonPrimary}
        disabled={pushing || !connected}
        onClick={() => {
          setPushing(true);
          void pushStoreStockAction().then((result) => {
            setPushMessage(result.error ?? result.success);
            setPushing(false);
          });
        }}
      >
        {pushing ? "Sending..." : "Send stock to the website"}
      </button>
      {pushMessage ? <p className="text-sm text-muted">{pushMessage}</p> : null}
    </div>
  );
}
