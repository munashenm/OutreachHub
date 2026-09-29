import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-md">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Urban Focus</p>
        <div className="mt-4 rounded-2xl border border-line bg-white p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}
