"use client";

import { useState } from "react";
import { syncMailboxNowAction } from "@/actions/mailbox-actions";
import { buttonSecondary } from "@/components/ui";

export function SyncMailboxButton({ mailboxId }: { mailboxId: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        className={buttonSecondary}
        disabled={pending}
        onClick={() => {
          setPending(true);
          void syncMailboxNowAction(mailboxId).then((result) => {
            setMessage(result.error ?? result.success);
            setPending(false);
          });
        }}
      >
        {pending ? "Syncing..." : "Sync now"}
      </button>
      {message ? <span className="text-xs text-muted">{message}</span> : null}
    </div>
  );
}
