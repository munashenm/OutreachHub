"use client";

import { useState, useTransition } from "react";
import { sendCampaignNowAction } from "@/actions/campaign-actions";
import { buttonPrimary } from "@/components/ui";

export function SendCampaignButton({ campaignId }: { campaignId: string }) {
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  return (
    <div>
      <button
        type="button"
        className={buttonPrimary}
        disabled={pending}
        onClick={() => startTransition(async () => {
          const result = await sendCampaignNowAction(campaignId);
          setMessage(result.error ?? result.success);
        })}
      >
        {pending ? "Sending..." : "Send due emails"}
      </button>
      {message ? <p className="mt-2 text-sm text-muted">{message}</p> : null}
    </div>
  );
}
