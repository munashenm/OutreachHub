"use client";

import { useState, useTransition } from "react";
import { addProspectsToCampaignAction, removeProspectFromCampaignAction } from "@/actions/campaign-actions";
import { Badge, buttonSecondary } from "@/components/ui";
import { fullName } from "@/lib/format";
import { MARKETING_STATUS_LABELS, type MarketingStatus } from "@/lib/labels";
import { marketingBlockReason } from "@/lib/marketing";

export function CampaignMembers({
  campaignId,
  members,
  candidates,
  suppressedEmails,
}: {
  campaignId: string;
  members: { id: string; prospectId: string; name: string; email: string; marketingStatus: MarketingStatus }[];
  candidates: { id: string; firstName: string; lastName: string; email: string; marketingStatus: MarketingStatus }[];
  suppressedEmails: string[];
}) {
  const suppressed = new Set(suppressedEmails);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<string>();
  const [rejected, setRejected] = useState<{ email: string; name: string; reason: string }[]>([]);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">Prospects in this campaign</h2>
        {members.length === 0 ? <p className="mt-2 text-sm text-muted">No prospects have been added.</p> : (
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
            {members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">{member.name}</p>
                  <p className="text-muted">{member.email}</p>
                </div>
                <button
                  type="button"
                  className="text-sm text-red-700"
                  onClick={() => startTransition(async () => {
                    const result = await removeProspectFromCampaignAction(campaignId, member.prospectId);
                    setMessage(result.error ?? result.success);
                  })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h2 className="text-base font-semibold">Add prospects</h2>
        <p className="mt-1 text-sm text-muted">Opted out, blocked, bounced, and suppressed addresses cannot be added.</p>
        {message ? <p className="mt-2 text-sm">{message}</p> : null}
        {rejected.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm text-red-700">
            {rejected.map((item) => (
              <li key={`${item.email}-${item.reason}`}>{item.name}: {item.reason}</li>
            ))}
          </ul>
        ) : null}
        <ul className="mt-3 max-h-80 space-y-2 overflow-auto">
          {candidates.map((candidate) => {
            const reason = marketingBlockReason(candidate.marketingStatus, suppressed.has(candidate.email));
            return (
              <li key={candidate.id} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  disabled={Boolean(reason)}
                  checked={selected.includes(candidate.id)}
                  onChange={() => setSelected((current) => current.includes(candidate.id) ? current.filter((id) => id !== candidate.id) : [...current, candidate.id])}
                  aria-label={`Add ${fullName(candidate.firstName, candidate.lastName)}`}
                />
                <span className="min-w-0 flex-1">
                  {fullName(candidate.firstName, candidate.lastName)} <span className="text-muted">{candidate.email}</span>
                </span>
                <Badge tone={reason ? "red" : "slate"}>{reason ?? MARKETING_STATUS_LABELS[candidate.marketingStatus]}</Badge>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className={`${buttonSecondary} mt-4`}
          disabled={pending || selected.length === 0}
          onClick={() => startTransition(async () => {
            const result = await addProspectsToCampaignAction(campaignId, selected);
            setMessage(result.error ?? result.success);
            setRejected(result.rejected ?? []);
            if ((result.addedCount ?? 0) > 0) setSelected([]);
          })}
        >
          Add selected
        </button>
      </div>
    </div>
  );
}
