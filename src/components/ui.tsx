"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import type { ActionState } from "@/lib/format";
import { withQuery } from "@/lib/format";

export const inputClass =
  "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15";
export const textAreaClass =
  "min-h-28 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15";
export const labelClass = "mb-1.5 block text-sm font-medium text-ink";
export const buttonPrimary =
  "inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#17395a] disabled:cursor-not-allowed disabled:opacity-60";
export const buttonSecondary =
  "inline-flex h-10 items-center justify-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";
export const buttonDanger =
  "inline-flex h-10 items-center justify-center rounded-lg border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-card shadow-sm ${className}`}>{children}</section>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-white px-6 py-12 text-center">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <article className="rounded-xl border border-line bg-card p-4 shadow-sm">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-ink">{value.toLocaleString("en-GB")}</p>
      <p className="mt-2 text-xs leading-5 text-muted">{hint}</p>
    </article>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "error"; children: ReactNode }) {
  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-950",
    success: "border-emerald-200 bg-emerald-50 text-emerald-950",
    error: "border-red-200 bg-red-50 text-red-900",
  };
  return <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>;
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "red" | "amber" | "blue" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-50 text-emerald-800",
    red: "bg-rose-50 text-rose-800",
    amber: "bg-amber-50 text-amber-900",
    blue: "bg-sky-50 text-sky-900",
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Field({
  label,
  name,
  error,
  children,
  id,
}: {
  label: string;
  name: string;
  error?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <label className="block" htmlFor={id ?? name}>
      <span className={labelClass}>{label}</span>
      {children}
      {error ? <span className="mt-1 block text-sm text-red-700">{error}</span> : null}
    </label>
  );
}

export function Pagination({
  page,
  pageCount,
  path,
  query,
}: {
  page: number;
  pageCount: number;
  path: string;
  query: Record<string, string>;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm text-muted">
      <span>
        Page {page} of {pageCount}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className={buttonSecondary} href={withQuery(path, query, { page: String(page - 1) })}>
            Previous
          </Link>
        ) : null}
        {page < pageCount ? (
          <Link className={buttonSecondary} href={withQuery(path, query, { page: String(page + 1) })}>
            Next
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function ConfirmButton({
  action,
  label,
  confirm,
  variant = "danger",
}: {
  action: () => Promise<ActionState | void>;
  label: string;
  confirm: string;
  variant?: "danger" | "secondary";
}) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  return (
    <div>
      <button
        type="button"
        className={variant === "danger" ? buttonDanger : buttonSecondary}
        disabled={pending}
        onClick={() => {
          if (!window.confirm(confirm)) return;
          startTransition(async () => {
            const result = await action();
            setError(result?.error);
          });
        }}
      >
        {pending ? "Working..." : label}
      </button>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
