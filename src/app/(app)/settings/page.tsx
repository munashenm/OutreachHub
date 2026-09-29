import Link from "next/link";
import { CreateWorkspaceForm, RenameWorkspaceForm } from "@/components/settings-forms";
import { PageHeader, Panel } from "@/components/ui";
import { firstParam } from "@/lib/format";
import { requireSession } from "@/services/auth-service";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const status = firstParam((await searchParams).status);
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
      <Panel className="p-5 text-sm">
        <Link className="text-accent" href="/settings/suppression">Suppression list</Link>
        <span className="mx-2 text-muted">·</span>
        <Link className="text-accent" href="/settings/audit">Audit trail</Link>
      </Panel>
    </div>
  );
}
