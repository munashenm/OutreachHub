import Link from "next/link";
import { StoreConnectionForm } from "@/components/store-connection-form";
import { CreateWorkspaceForm, RenameWorkspaceForm } from "@/components/settings-forms";
import { PageHeader, Panel } from "@/components/ui";
import { firstParam, formatDateTime } from "@/lib/format";
import { requireSession } from "@/services/auth-service";
import { getStoreConnection } from "@/services/stock-sync-service";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const status = firstParam((await searchParams).status);
  const store = await getStoreConnection(session.workspace.id);
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" description="Workspace identity, suppression, and the audit trail." />
      {status === "workspace" ? <p className="text-sm text-emerald-800">Switched to the new workspace.</p> : null}
      <Panel className="p-5">
        <h2 className="font-semibold">Account</h2>
        <p className="mt-2 text-sm">{session.user.name}</p>
        <p className="text-sm text-muted">{session.user.email}</p>
        <p className="mt-2 text-sm text-muted">Role in this workspace: {session.role}</p>
      </Panel>
      <Panel className="p-5">
        <h2 className="font-semibold">Workspace</h2>
        <div className="mt-4">
          <RenameWorkspaceForm name={session.workspace.name} canManage={session.role === "OWNER" || session.role === "ADMIN"} />
        </div>
      </Panel>
      <Panel className="p-5">
        <h2 className="font-semibold">Workspaces you belong to</h2>
        <ul className="mt-3 space-y-1 text-sm">
          {session.memberships.map((membership) => (
            <li key={membership.workspaceId}>{membership.workspaceName} · {membership.role}</li>
          ))}
        </ul>
        <div className="mt-4">
          <CreateWorkspaceForm />
        </div>
      </Panel>
      <Panel className="p-5">
        <h2 className="font-semibold">Urban Focus website</h2>
        <p className="mt-1 mb-4 text-sm text-muted">WooCommerce on www.urbanfocus.co.za. Stock and the marked-up price are sent for catalogue SKUs that already exist on the website.</p>
        {store?.lastError ? <p className="mb-3 text-sm text-red-700">{store.lastError}</p> : null}
        {store?.lastSyncAt ? <p className="mb-3 text-sm text-muted">Last website update {formatDateTime(store.lastSyncAt)}</p> : null}
        <StoreConnectionForm baseUrl={store?.baseUrl ?? ""} connected={store?.connected ?? false} />
      </Panel>
      <Panel className="p-5 text-sm">
        <Link className="text-accent" href="/settings/mailboxes">Mailboxes</Link>
        <span className="mx-2 text-muted">·</span>
        <Link className="text-accent" href="/settings/suppression">Suppression list</Link>
        <span className="mx-2 text-muted">·</span>
        <Link className="text-accent" href="/settings/audit">Audit trail</Link>
      </Panel>
    </div>
  );
}
