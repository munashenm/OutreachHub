"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonPrimary, buttonSecondary, inputClass } from "@/components/ui";
import { IMPORT_COLUMNS, MAX_SUPPLIER_FILE_BYTES, type ImportColumnKey } from "@/lib/supplier-file";

type Preview = {
  filename: string;
  format: string;
  parser: "scoop" | "generic";
  headers: string[];
  rowCount: number;
  rows: string[][];
  suggested: Partial<Record<ImportColumnKey, string>>;
  error?: string;
};

type ImportResult = {
  error?: string;
  rowsRead?: number;
  rowsCreated?: number;
  rowsUpdated?: number;
  rowsRejected?: number;
};

export function SupplierManualImport({ supplierId, savedMapping }: { supplierId: string; savedMapping: Partial<Record<ImportColumnKey, string>> }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState(savedMapping);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadPreview(next: File) {
    setFile(next);
    setPreview(null);
    setError("");
    setMessage("");
    const body = new FormData();
    body.set("file", next);
    setPending(true);
    const response = await fetch(`/api/suppliers/${supplierId}/preview`, { method: "POST", body });
    const json = (await response.json()) as Preview;
    setPending(false);
    if (!response.ok || json.error) {
      setError(json.error ?? "The file could not be previewed.");
      return;
    }
    setPreview(json);
    setMapping({ ...json.suggested, ...savedMapping });
  }

  async function importFile() {
    if (!file) return;
    const body = new FormData();
    body.set("source", "table");
    body.set("file", file);
    body.set("mapping", JSON.stringify(mapping));
    setPending(true);
    setError("");
    const response = await fetch(`/api/suppliers/${supplierId}/import`, { method: "POST", body });
    const json = (await response.json()) as ImportResult;
    setPending(false);
    if (!response.ok || json.error) {
      setError(json.error ?? "The file could not be imported.");
      return;
    }
    setMessage(`Read ${json.rowsRead ?? 0}. Created ${json.rowsCreated ?? 0}. Updated ${json.rowsUpdated ?? 0}. Rejected ${json.rowsRejected ?? 0}.`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Maximum file size: {Math.round(MAX_SUPPLIER_FILE_BYTES / 1_000_000)} MB. CSV, XML, and XLSX are accepted. A saved mapping is used for the next file from this supplier.</p>
      <div
        className="rounded-lg border border-dashed border-line bg-slate-50 px-4 py-8 text-center"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const dropped = event.dataTransfer.files[0];
          if (dropped) void loadPreview(dropped);
        }}
      >
        <p className="text-sm font-medium">Drop a supplier file here</p>
        <label className="mt-3 inline-block">
          <span className={buttonSecondary}>Choose file</span>
          <input
            className="sr-only"
            type="file"
            accept=".csv,.xml,.xlsx,text/csv,text/xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) void loadPreview(chosen);
            }}
          />
        </label>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-muted">{message}</p> : null}
      {preview ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">{preview.filename}: {preview.rowCount} rows, {preview.format.toUpperCase()}.</p>
          {preview.parser === "scoop" ? (
            <p className="text-sm text-muted">This is a Scoop price list. Dealer price excluding VAT is the supplier cost, and total stock is the available stock. Column mapping is not used.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {IMPORT_COLUMNS.map((column) => (
                <label key={column.key} className="text-sm">
                  <span className="mb-1.5 block font-medium">{column.label}</span>
                  <select
                    className={inputClass}
                    value={mapping[column.key] ?? ""}
                    onChange={(event) => setMapping((current) => ({ ...current, [column.key]: event.target.value }))}
                  >
                    <option value="">Not in this file</option>
                    {preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>{preview.headers.map((header) => <th key={header}>{header}</th>)}</tr>
              </thead>
              <tbody>
                {preview.rows.map((row, index) => (
                  <tr key={index}>{row.map((cell, cellIndex) => <td key={`${index}-${cellIndex}`}>{cell || "—"}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className={buttonPrimary} type="button" disabled={pending} onClick={() => void importFile()}>
            {pending ? "Importing..." : "Import file"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
