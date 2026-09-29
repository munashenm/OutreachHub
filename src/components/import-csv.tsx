"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CSV_HEADERS } from "@/lib/labels";
import { buttonSecondary, inputClass } from "@/components/ui";

type ImportResponse = {
  error?: string;
  created?: number;
  rejected?: { row: number; email: string; reason: string }[];
};

export function ImportCsv() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={async (event) => {
        event.preventDefault();
        const body = new FormData(event.currentTarget);
        setPending(true);
        setResult(null);
        const response = await fetch("/api/prospects/import", { method: "POST", body });
        const json = (await response.json()) as ImportResponse;
        setResult(json);
        setPending(false);
        if (response.ok) router.refresh();
      }}
    >
      <label className="block flex-1 text-sm">
        <span className="mb-1.5 block font-medium">Import CSV</span>
        <input name="file" type="file" accept=".csv,text/csv" required className={inputClass} />
      </label>
      <button className={buttonSecondary} disabled={pending}>{pending ? "Importing..." : "Import"}</button>
      <a className={`${buttonSecondary} px-4`} href="/api/prospects/template">
        Template
      </a>
      <p className="sr-only">{CSV_HEADERS.join(",")}</p>
      {result?.error ? <p className="w-full text-sm text-red-700">{result.error}</p> : null}
      {typeof result?.created === "number" ? (
        <div className="w-full text-sm text-muted">
          <p>{result.created} prospects created. {result.rejected?.length ?? 0} rows skipped.</p>
          {result.rejected && result.rejected.length > 0 ? (
            <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
              {result.rejected.slice(0, 20).map((item) => (
                <li key={`${item.row}-${item.email}`}>Row {item.row} {item.email ? `(${item.email})` : ""}: {item.reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
