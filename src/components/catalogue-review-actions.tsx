"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { mergeCatalogueItemAction, reviewCatalogueItemAction } from "@/actions/catalogue-actions";

const small = "inline-flex h-7 items-center rounded border border-line bg-white px-2 text-xs font-semibold text-ink disabled:opacity-60";

export function CatalogueReviewActions({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();

  async function run(action: "accept" | "reject" | "ignore" | "image") {
    setPending(true);
    const result = await reviewCatalogueItemAction(itemId, action);
    setMessage(result.error ?? result.success);
    setPending(false);
    if (!result.error) router.refresh();
  }

  return (
    <div className="flex min-w-52 flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        <button type="button" className={small} disabled={pending} onClick={() => void run("accept")}>Accept</button>
        <button type="button" className={small} disabled={pending} onClick={() => void run("reject")}>Reject</button>
        <button type="button" className={small} disabled={pending} onClick={() => void run("ignore")}>Ignore</button>
        <button type="button" className={small} disabled={pending} onClick={() => void run("image")}>Find image</button>
      </div>
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          const target = String(new FormData(event.currentTarget).get("targetStoreProductId") ?? "");
          setPending(true);
          void mergeCatalogueItemAction(itemId, target).then((result) => {
            setMessage(result.error ?? result.success);
            setPending(false);
            if (!result.error) router.refresh();
          });
        }}
      >
        <input name="targetStoreProductId" placeholder="Other store id" aria-label="Store product to keep" className="h-7 w-28 rounded border border-line px-2 text-xs" />
        <button className={small} disabled={pending}>Merge</button>
      </form>
      {message ? <p className="text-xs text-muted">{message}</p> : null}
    </div>
  );
}
