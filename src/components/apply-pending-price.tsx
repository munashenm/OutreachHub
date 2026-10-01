"use client";

import { useState } from "react";
import { applyPendingPriceAction } from "@/actions/product-actions";
import { buttonSecondary } from "@/components/ui";

export function ApplyPendingPriceButton({ productId, label }: { productId: string; label: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  return (
    <div className="mt-3">
      <p className="text-sm">A supplier price of {label} is waiting for approval. The catalogue sell price stays as it is until you apply it.</p>
      <button
        type="button"
        className={`${buttonSecondary} mt-2`}
        disabled={pending}
        onClick={() => {
          setPending(true);
          void applyPendingPriceAction(productId).then((result) => {
            setMessage(result.error ?? result.success);
            setPending(false);
          });
        }}
      >
        {pending ? "Applying..." : "Apply this price"}
      </button>
      {message ? <p className="mt-2 text-sm text-muted">{message}</p> : null}
    </div>
  );
}
