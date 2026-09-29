"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { deleteProspectsAction } from "@/actions/prospect-actions";
import { Badge, buttonDanger } from "@/components/ui";
import { LEAD_STATUS_LABELS, MARKETING_STATUS_LABELS, type LeadStatus, type MarketingStatus } from "@/lib/labels";

export type ProspectRow = {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
  companyName: string;
  leadStatus: LeadStatus;
  marketingStatus: MarketingStatus;
};

export function ProspectTable({ rows }: { rows: ProspectRow[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const allSelected = rows.length > 0 && selected.length === rows.length;
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggleAll() {
    setSelected(allSelected ? [] : rows.map((row) => row.id));
  }

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  return (
    <div>
      {selected.length > 0 ? (
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="text-sm text-muted">{selected.length} selected</p>
          <button
            type="button"
            className={buttonDanger}
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Delete ${selected.length} prospect${selected.length === 1 ? "" : "s"}?`)) return;
              startTransition(async () => {
                const result = await deleteProspectsAction(selected);
                setMessage(result.error ?? result.success);
                if (!result.error) setSelected([]);
              });
            }}
          >
            Delete selected
          </button>
        </div>
      ) : null}
      {message ? <p className="px-4 py-2 text-sm text-ink">{message}</p> : null}
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-10">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all prospects" />
              </th>
              <th>Name</th>
              <th>Company</th>
              <th>Lead</th>
              <th>Marketing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedSet.has(row.id)}
                    onChange={() => toggle(row.id)}
                    aria-label={`Select ${row.name}`}
                  />
                </td>
                <td>
                  <Link href={`/prospects/${row.id}`} className="font-medium text-ink hover:underline">
                    {row.name}
                  </Link>
                  <p className="text-xs text-muted">{row.email}</p>
                  {row.jobTitle ? <p className="text-xs text-muted">{row.jobTitle}</p> : null}
                </td>
                <td>{row.companyName || "—"}</td>
                <td><Badge tone={row.leadStatus === "WON" ? "green" : row.leadStatus === "LOST" ? "red" : "blue"}>{LEAD_STATUS_LABELS[row.leadStatus]}</Badge></td>
                <td>
                  <Badge tone={row.marketingStatus === "OPTED_OUT" || row.marketingStatus === "BLOCKED" || row.marketingStatus === "BOUNCED" ? "red" : row.marketingStatus === "CONSENTED" ? "green" : "slate"}>
                    {MARKETING_STATUS_LABELS[row.marketingStatus]}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
