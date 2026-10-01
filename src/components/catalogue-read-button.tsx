"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readStoreCatalogueAction } from "@/actions/catalogue-actions";
import { buttonPrimary } from "@/components/ui";

export function ReadCatalogueButton({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        className={buttonPrimary}
        disabled={pending || !connected}
        onClick={() => {
          setPending(true);
          void (async () => {
            let result = await readStoreCatalogueAction();
            let guard = 0;
            while (!result.error && result.pending && guard < 80) {
              setMessage(result.success);
              guard += 1;
              result = await readStoreCatalogueAction();
            }
            setMessage(result.error ?? result.success);
            setPending(false);
            if (!result.error) router.refresh();
          })();
        }}
      >
        {pending ? "Reading the store..." : "Read store catalogue"}
      </button>
      {message ? <p className="max-w-xl text-sm text-muted">{message}</p> : null}
    </div>
  );
}
