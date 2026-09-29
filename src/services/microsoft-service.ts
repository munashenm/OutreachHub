import { AppError } from "../lib/errors";
import { mailboxAddress, odataString } from "../lib/microsoft";

const GRAPH = "https://graph.microsoft.com/v1.0";

export const MICROSOFT_SCOPES = [
  "openid",
  "email",
  "offline_access",
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/Mail.Read",
].join(" ");

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new AppError(`${name} is not configured.`, 500, "CONFIG");
  return value;
}

function tenant() {
  return process.env.MICROSOFT_TENANT_ID || "organizations";
}

export function microsoftRedirectUri() {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/microsoft/callback`;
}

export function microsoftAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: requiredEnv("MICROSOFT_CLIENT_ID"),
    redirect_uri: microsoftRedirectUri(),
    response_type: "code",
    response_mode: "query",
    scope: MICROSOFT_SCOPES,
    prompt: "select_account",
    state,
  });
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize?${params.toString()}`;
}

type MicrosoftToken = { access_token: string; refresh_token?: string; expires_in: number };

async function tokenRequest(fields: Record<string, string>): Promise<MicrosoftToken> {
  const response = await fetch(`https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("MICROSOFT_CLIENT_ID"),
      client_secret: requiredEnv("MICROSOFT_CLIENT_SECRET"),
      scope: MICROSOFT_SCOPES,
      ...fields,
    }),
  });
  const json = (await response.json()) as { error_description?: string; access_token?: string; refresh_token?: string; expires_in?: number };
  if (!response.ok || !json.access_token || !json.expires_in) {
    throw new AppError(json.error_description || "Microsoft rejected the mailbox connection.");
  }
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_in: json.expires_in };
}

export function exchangeMicrosoftCode(code: string) {
  return tokenRequest({ code, grant_type: "authorization_code", redirect_uri: microsoftRedirectUri() });
}

export function refreshMicrosoftAccessToken(refreshToken: string) {
  return tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
}

export async function microsoftAccountEmail(accessToken: string) {
  const response = await fetch(`${GRAPH}/me?$select=mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await response.json()) as { mail?: string | null; userPrincipalName?: string | null; error?: { message?: string } };
  const email = mailboxAddress(json.mail, json.userPrincipalName);
  if (!response.ok || !email) throw new AppError(json.error?.message || "Microsoft did not return a mailbox address.");
  return email;
}

export async function sendMicrosoftMessage(accessToken: string, input: { to: string; subject: string; body: string; listUnsubscribe?: string }) {
  const draftResponse = await fetch(`${GRAPH}/me/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: input.subject,
      body: { contentType: "Text", content: input.body },
      toRecipients: [{ emailAddress: { address: input.to } }],
      internetMessageHeaders: input.listUnsubscribe
        ? [
            { name: "List-Unsubscribe", value: `<${input.listUnsubscribe}>` },
            { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
          ]
        : undefined,
    }),
  });
  const draft = (await draftResponse.json()) as { id?: string; conversationId?: string; error?: { message?: string } };
  if (!draftResponse.ok || !draft.id || !draft.conversationId) {
    throw new AppError(draft.error?.message || "Microsoft refused the message.", draftResponse.status);
  }
  const sendResponse = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(draft.id)}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!sendResponse.ok && sendResponse.status !== 202) {
    const error = (await sendResponse.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new AppError(error.error?.message || "Microsoft refused to send the message.", sendResponse.status);
  }
  return { id: draft.id, threadId: draft.conversationId };
}

export type RemoteThreadMessage = {
  id: string;
  from: string;
  subject: string;
  snippet: string;
};

export async function listMicrosoftConversation(accessToken: string, conversationId: string): Promise<RemoteThreadMessage[]> {
  const filter = encodeURIComponent(`conversationId eq ${odataString(conversationId)}`);
  const url = `${GRAPH}/me/messages?$filter=${filter}&$select=id,subject,bodyPreview,from&$top=20`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return [];
  const json = (await response.json()) as {
    value?: { id: string; subject?: string; bodyPreview?: string; from?: { emailAddress?: { address?: string } } }[];
  };
  return (json.value ?? []).map((item) => ({
    id: item.id,
    from: item.from?.emailAddress?.address ?? "",
    subject: item.subject ?? "",
    snippet: item.bodyPreview ?? "",
  }));
}
