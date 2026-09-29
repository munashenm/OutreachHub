"use client";

import { useState } from "react";
import { createProspectFromOrderAction, pullStoreOrdersAction } from "@/actions/order-actions";
import { buttonPrimary, buttonSecondary } from "@/components/ui";

export function SyncOrdersButton() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        className={buttonPrimary}
        disabled={pending}
        onClick={() => {
          setPending(true);
          void pullStoreOrdersAction().then((result) => {
            setMessage(result.error ?? result.success);
            setPending(false);
          });
        }}
      >
        {pending ? "Syncing..." : "Sync orders"}
      </button>
      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </div>
  );
}

export function CreateCustomerButton({ orderId }: { orderId: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  return (
    <div>
      <button
        type="button"
        className={buttonSecondary}
        disabled={pending}
        onClick={() => {
          setPending(true);
          void createProspectFromOrderAction(orderId).then((result) => {
            if (result.error) {
              setMessage(result.error);
              setPending(false);
            }
          });
        }}
      >
        {pending ? "Saving..." : "Create customer"}
      </button>
      {message ? <p className="text-sm text-red-700">{message}</p> : null}
    </div>
  );
}
