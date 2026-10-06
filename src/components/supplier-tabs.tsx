"use client";

import { useState, type ReactNode } from "react";

const TABS = [
  ["feed", "Automatic feed"],
  ["upload", "Manual upload"],
  ["products", "Products"],
  ["history", "Import history"],
  ["settings", "Settings"],
] as const;

export function SupplierTabs({ feed, upload, products, history, settings }: { feed: ReactNode; upload: ReactNode; products: ReactNode; history: ReactNode; settings: ReactNode }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("feed");
  const panel = { feed, upload, products, history, settings }[tab];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white" : "rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold"}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {panel}
    </div>
  );
}
