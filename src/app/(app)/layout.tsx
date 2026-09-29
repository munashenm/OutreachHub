import type { ReactNode } from "react";
import { AppShell } from "@/components/shell";
import { listActivities } from "@/services/activity-service";
import { requireSession } from "@/services/auth-service";

export const dynamic = "force-dynamic";

export default async function ApplicationLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const notifications = await listActivities({ workspaceId: session.workspace.id, take: 8 });
  return (
    <AppShell
      workspace={session.workspace}
      user={session.user}
      memberships={session.memberships}
      notifications={notifications.map((item) => ({
        id: item.id,
        summary: item.summary,
        createdAt: item.createdAt.toISOString(),
      }))}
    >
      {children}
    </AppShell>
  );
}
