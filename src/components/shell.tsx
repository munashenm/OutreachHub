"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { logoutAction } from "@/actions/auth-actions";
import { switchWorkspaceAction } from "@/actions/settings-actions";
import { NAV_ITEMS, type NavIcon } from "@/lib/navigation";

type ShellProps = {
  children: ReactNode;
  workspace: { id: string; name: string; isDemo: boolean };
  user: { name: string; email: string };
  memberships: { workspaceId: string; workspaceName: string }[];
  notifications: { id: string; summary: string; createdAt: string }[];
};

export function AppShell({ children, workspace, user, memberships, notifications }: ShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);

  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
    setMenuOpen(false);
    setNotesOpen(false);
  }

  return (
    <div className="min-h-screen bg-canvas text-ink lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-sidebar text-sidebar-muted transition lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 py-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">OutreachHub</p>
          <p className="mt-1 text-sm text-white">Sales workspace</p>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/dashboard" ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  active ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white"
                }`}
              >
                <NavIconSvg name={item.icon} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line lg:hidden"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
          >
            <span className="block h-0.5 w-4 bg-ink shadow-[0_5px_0_#152033,0_-5px_0_#152033]" />
          </button>
          <div className="min-w-0">
            {memberships.length > 1 ? (
              <form action={switchWorkspaceAction}>
                <label className="sr-only" htmlFor="workspaceId">
                  Workspace
                </label>
                <select
                  id="workspaceId"
                  name="workspaceId"
                  defaultValue={workspace.id}
                  className="max-w-56 truncate bg-transparent text-sm font-semibold text-ink outline-none"
                  onChange={(event) => event.currentTarget.form?.requestSubmit()}
                >
                  {memberships.map((membership) => (
                    <option key={membership.workspaceId} value={membership.workspaceId}>
                      {membership.workspaceName}
                    </option>
                  ))}
                </select>
              </form>
            ) : (
              <p className="truncate text-sm font-semibold">{workspace.name}</p>
            )}
            {workspace.isDemo ? <p className="text-xs text-amber-800">Demo data</p> : null}
          </div>
          <form action="/prospects" className="mx-auto hidden w-full max-w-md md:block">
            <label className="sr-only" htmlFor="global-search">
              Search prospects
            </label>
            <input
              id="global-search"
              name="q"
              placeholder="Search prospects"
              className="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm outline-none focus:border-accent"
            />
          </form>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                className="inline-flex h-10 items-center rounded-lg px-3 text-sm text-muted hover:bg-canvas"
                aria-expanded={notesOpen}
                onClick={() => {
                  setNotesOpen((value) => !value);
                  setMenuOpen(false);
                }}
              >
                Notifications
              </button>
              {notesOpen ? (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-line bg-white p-2 shadow-lg">
                  {notifications.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-muted">No activity yet.</p>
                  ) : (
                    <ul>
                      {notifications.map((item) => (
                        <li key={item.id} className="rounded-lg px-3 py-2 text-sm hover:bg-canvas">
                          <p className="text-ink">{item.summary}</p>
                          <p className="mt-1 text-xs text-muted">
                            {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link href="/settings/audit" className="block px-3 py-2 text-sm font-medium text-accent">
                    View audit trail
                  </Link>
                </div>
              ) : null}
            </div>
            <div className="relative">
              <button
                type="button"
                className="inline-flex h-10 max-w-40 items-center truncate rounded-lg px-3 text-sm font-medium hover:bg-canvas"
                aria-expanded={menuOpen}
                onClick={() => {
                  setMenuOpen((value) => !value);
                  setNotesOpen(false);
                }}
              >
                {user.name}
              </button>
              {menuOpen ? (
                <div className="absolute right-0 mt-2 w-60 rounded-xl border border-line bg-white p-2 shadow-lg">
                  <p className="px-3 py-2 text-xs text-muted">{user.email}</p>
                  <Link href="/settings" className="block rounded-lg px-3 py-2 text-sm hover:bg-canvas">
                    Settings
                  </Link>
                  <form action={logoutAction}>
                    <button type="submit" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-canvas">
                      Log out
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function NavIconSvg({ name }: { name: NavIcon }) {
  const paths: Record<NavIcon, string> = {
    dashboard: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
    prospects: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 8v6M17 11h6",
    companies: "M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M15 21V9h4a2 2 0 0 1 2 2v10",
    campaigns: "M4 6h16M4 12h10M4 18h7",
    inbox: "M3 12 5 5h14l2 7v7H3zM3 12h5l1 2h6l1-2h5",
    pipeline: "M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z",
    templates: "M6 3h9l5 5v13H6zM15 3v5h5",
    tasks: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
    analytics: "M4 19V9M10 19V5M16 19v-7M22 19H2",
    settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  };
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d={paths[name]} />
    </svg>
  );
}
