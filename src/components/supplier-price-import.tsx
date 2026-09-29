"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonSecondary, inputClass } from "@/components/ui";

type ImportResponse = {
  error?: string;
  updated?: number;
  rejected?: { row: number; sku: string; reason: string }[];
};

export function SupplierPriceImport({ supplierId }: { supplierId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const body = new FormData(event.currentTarget);
        setPending(true);
        setResult(null);
        const response = await fetch(`/api/suppliers/${supplierId}/import`, { method: "POST", body });
        const json = (await response.json()) as ImportResponse;
        setResult(json);
        setPending(false);
        if (response.ok) router.refresh();
      }}
    >
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Price file</span>
        <input name="file" type="file" accept=".csv,text/csv" required className={inputClass} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className={buttonSecondary} disabled={pending}>{pending ? "Importing..." : "Import prices"}</button>
        <a className={`${buttonSecondary} px-4`} href="/api/suppliers/template">Template</a>
      </div>
      {result?.error ? <p className="text-sm text-red-700">{result.error}</p> : null}
      {result && !result.error ? <p className="text-sm text-muted">Updated {result.updated ?? 0} prices. Skipped {result.rejected?.length ?? 0} rows.</p> : null}
      {result?.rejected?.length ? (
        <ul className="space-y-1 text-sm text-muted">
          {result.rejected.slice(0, 8).map((item) => <li key={`${item.row}-${item.sku}`}>Row {item.row} {item.sku}: {item.reason}</li>)}
        </ul>
      ) : null}
    </form>
  );
}
