import Link from "next/link";
import { disconnectMailboxAction } from "@/actions/template-actions";
import { ConfirmButton, Notice, PageHeader, Panel, buttonPrimary, buttonSecondary } from "@/components/ui";
import { firstParam, formatDateTime } from "@/lib/format";
import { MAILBOX_PROVIDER_LABELS } from "@/lib/labels";
import { requireSession } from "@/services/auth-service";
import { GOOGLE_SCOPES, googleRedirectUri } from "@/services/google-service";
import { listMailboxes } from "@/services/mailbox-service";

export default async function MailboxesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const mailboxes = await listMailboxes(session.workspace.id);
  const status = firstParam((await searchParams).status);
  const googleReady = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Mailboxes"
        description="Connect the Urban Focus Google Workspace mailbox. Tokens stay encrypted on the server."
        actions={
          <div className="flex flex-wrap gap-2">
            {googleReady ? <a className={buttonPrimary} href="/api/google/connect">Connect Google Workspace</a> : null}
            {googleReady && mailboxes.some((mailbox) => mailbox.provider === "GOOGLE") ? <a className={buttonSecondary} href="/api/google/connect">Reconnect</a> : null}
          </div>
        }
      />
      {status === "connected" ? <Notice tone="success">Mailbox connected.</Notice> : null}
      {status === "denied" || status === "error" ? <Notice tone="error">The mailbox connection did not finish. Check the OAuth client and try again.</Notice> : null}
      {!googleReady ? <Notice tone="info">Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and OAUTH_ENCRYPTION_KEY before connecting the mailbox.</Notice> : null}
      <Panel className="space-y-2 p-5 text-sm">
        <p>Google redirect URI: <span className="font-medium">{googleRedirectUri()}</span></p>
        <p className="text-muted">Gmail scopes: {GOOGLE_SCOPES}</p>
      </Panel>
      <Panel>
        {mailboxes.length === 0 ? <p className="p-5 text-sm text-muted">No mailbox connected.</p> : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th><th>Provider</th><th>Status</th><th>Last sync</th><th>Last error</th><th>Last send</th><th>Last inbound sync</th><th></th>
              </tr>
            </thead>
            <tbody>
              {mailboxes.map((mailbox) => (
                <tr key={mailbox.id}>
                  <td>{mailbox.email}</td>
                  <td>{MAILBOX_PROVIDER_LABELS[mailbox.provider]}</td>
                  <td>{mailbox.connectionStatus === "CONNECTED" ? "Connected" : "Needs reconnect"}</td>
                  <td>{mailbox.lastSyncAt ? formatDateTime(mailbox.lastSyncAt) : "—"}</td>
                  <td>{mailbox.lastError || "—"}</td>
                  <td>{mailbox.lastSuccessfulSendAt ? formatDateTime(mailbox.lastSuccessfulSendAt) : "—"}</td>
                  <td>{mailbox.lastInboundSyncAt ? formatDateTime(mailbox.lastInboundSyncAt) : "—"}</td>
                  <td><ConfirmButton action={disconnectMailboxAction.bind(null, mailbox.id)} label="Disconnect" confirm={`Disconnect ${mailbox.email}?`} variant="secondary" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Link href="/settings" className="text-sm text-accent">Back to settings</Link>
    </div>
  );
}
