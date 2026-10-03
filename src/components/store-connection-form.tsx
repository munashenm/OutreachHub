"use client";

import { useActionState, useState } from "react";
import { pushStoreStockAction, saveStoreConnectionAction, testStoreConnectionAction } from "@/actions/stock-actions";
import { Field, buttonPrimary, buttonSecondary, inputClass } from "@/components/ui";
import { initialActionState } from "@/lib/format";

export function StoreConnectionForm({
  storeName,
  storeUrl,
  apiBaseUrl,
  minimumMarginPercent,
  autoQuoteMarginPercent,
  autoSendMarginPercent,
  followUpAfterDays,
  followUpLimit,
  connected,
}: {
  storeName: string;
  storeUrl: string;
  apiBaseUrl: string;
  minimumMarginPercent: number;
  autoQuoteMarginPercent: number;
  autoSendMarginPercent: number;
  followUpAfterDays: number;
  followUpLimit: number;
  connected: boolean;
}) {
  const [state, action, pending] = useActionState(saveStoreConnectionAction, initialActionState);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string>();
  const [pushing, setPushing] = useState(false);
  const [pushMessage, setPushMessage] = useState<string>();
  return (
    <div className="space-y-4">
      <form action={action} className="grid max-w-xl gap-3">
        {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
        {state.success ? <p className="text-sm text-muted">{state.success}</p> : null}
        <Field label="Store name" name="storeName">
          <input id="storeName" name="storeName" defaultValue={storeName} placeholder="Urban Focus" className={inputClass} />
        </Field>
        <Field label="Store URL" name="storeUrl">
          <input id="storeUrl" name="storeUrl" type="url" defaultValue={storeUrl} placeholder="https://www.urbanfocus.co.za" className={inputClass} />
        </Field>
        <Field label="API base URL" name="apiBaseUrl">
          <input id="apiBaseUrl" name="apiBaseUrl" type="url" defaultValue={apiBaseUrl} placeholder="https://www.urbanfocus.co.za/api/store" className={inputClass} />
        </Field>
        <Field label="API key" name="apiKey">
          <input id="apiKey" name="apiKey" type="password" autoComplete="off" placeholder={connected ? "Saved. Enter a new key to replace it." : "Stored encrypted on the server"} className={inputClass} />
        </Field>
        <Field label="Minimum margin percent" name="minimumMarginPercent">
          <input id="minimumMarginPercent" name="minimumMarginPercent" type="number" min={0} max={90} defaultValue={minimumMarginPercent} required className={inputClass} />
        </Field>
        <Field label="Auto-quote margin percent" name="autoQuoteMarginPercent">
          <input id="autoQuoteMarginPercent" name="autoQuoteMarginPercent" type="number" min={0} max={90} defaultValue={autoQuoteMarginPercent} required className={inputClass} />
        </Field>
        <Field label="Auto-send margin percent" name="autoSendMarginPercent">
          <input id="autoSendMarginPercent" name="autoSendMarginPercent" type="number" min={0} max={90} defaultValue={autoSendMarginPercent} required className={inputClass} />
        </Field>
        <Field label="Quote follow-up after days" name="followUpAfterDays">
          <input id="followUpAfterDays" name="followUpAfterDays" type="number" min={1} max={30} defaultValue={followUpAfterDays} required className={inputClass} />
        </Field>
        <Field label="Quote follow-up limit" name="followUpLimit">
          <input id="followUpLimit" name="followUpLimit" type="number" min={0} max={5} defaultValue={followUpLimit} required className={inputClass} />
        </Field>
        <button className={buttonSecondary} disabled={pending}>{pending ? "Saving..." : "Save store"}</button>
      </form>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonSecondary}
          disabled={testing || !connected}
          onClick={() => {
            setTesting(true);
            void testStoreConnectionAction().then((result) => {
              setTestMessage(result.error ?? result.success);
              setTesting(false);
            });
          }}
        >
          {testing ? "Testing..." : "Test connection"}
        </button>
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
          {pushing ? "Sending..." : "Send catalogue to the store"}
        </button>
      </div>
      {testMessage ? <p className="text-sm text-muted">{testMessage}</p> : null}
      {pushMessage ? <p className="text-sm text-muted">{pushMessage}</p> : null}
    </div>
  );
}
