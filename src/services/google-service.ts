import { AppError } from "../lib/errors";
import { buildRawEmail } from "../lib/email-mime";
import { headerFrom, type GmailPart } from "../lib/gmail-message";
import { isHistoryExpired } from "../lib/gmail-sync";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new AppError(`${name} is not configured.`, 500, "CONFIG");
  return value;
}

export function googleRedirectUri() {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/google/callback`;
}

export function googleAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: requiredEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH}?${params.toString()}`;
}

type GoogleToken = { access_token: string; refresh_token?: string; expires_in: number };

async function tokenRequest(fields: Record<string, string>): Promise<GoogleToken> {
  const response = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      ...fields,
    }),
  });
  const json = (await response.json()) as { error?: string; error_description?: string; access_token?: string; refresh_token?: string; expires_in?: number };
  if (!response.ok || !json.access_token || !json.expires_in) {
    throw new AppError(json.error || json.error_description || "Google rejected the mailbox connection.");
  }
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_in: json.expires_in };
}

export function exchangeGoogleCode(code: string) {
  return tokenRequest({ code, grant_type: "authorization_code", redirect_uri: googleRedirectUri() });
}

export function refreshGoogleAccessToken(refreshToken: string) {
  return tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
}

export async function googleAccountEmail(accessToken: string) {
  const response = await fetch(`${GMAIL}/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = (await response.json()) as { emailAddress?: string; historyId?: string; error?: { message?: string } };
  if (!response.ok || !json.emailAddress) throw new AppError(json.error?.message || "Google did not return a mailbox address.");
  return { email: json.emailAddress.toLowerCase(), historyId: json.historyId ?? null };
}

export type OutboundMail = {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  html?: string;
  listUnsubscribe?: string;
  threadId?: string | null;
  inReplyTo?: string | null;
};

export async function sendGmailMessage(accessToken: string, input: OutboundMail) {
  const response = await fetch(`${GMAIL}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      raw: buildRawEmail(input),
      ...(input.threadId ? { threadId: input.threadId } : {}),
    }),
  });
  const json = (await response.json()) as { id?: string; threadId?: string; error?: { message?: string; status?: string } };
  if (!response.ok || !json.id || !json.threadId) {
    throw new AppError(json.error?.message || "Gmail refused the message.", response.status);
  }
  return { id: json.id, threadId: json.threadId };
}

export type GmailThreadMessage = {
  id: string;
  snippet?: string;
  payload?: { headers?: { name: string; value: string }[] };
};

export async function listGmailThread(accessToken: string, threadId: string): Promise<GmailThreadMessage[]> {
  const url = `${GMAIL}/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return [];
  const json = (await response.json()) as { messages?: GmailThreadMessage[] };
  return json.messages ?? [];
}

export function headerValue(message: GmailThreadMessage, name: string) {
  return message.payload?.headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export type GmailFetchedMessage = {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload?: GmailPart;
};

export async function getGmailMessage(accessToken: string, id: string): Promise<GmailFetchedMessage | null> {
  const response = await fetch(`${GMAIL}/messages/${encodeURIComponent(id)}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const json = (await response.json()) as GmailFetchedMessage;
  return json.id ? json : null;
}

export async function listRecentGmailIds(accessToken: string) {
  const params = new URLSearchParams({
    q: "newer_than:14d -in:spam -in:trash",
    maxResults: "40",
  });
  const response = await fetch(`${GMAIL}/messages?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return [];
  const json = (await response.json()) as { messages?: { id: string }[] };
  return (json.messages ?? []).map((message) => message.id);
}

export async function listGmailHistory(accessToken: string, startHistoryId: string) {
  const ids: { id: string; labelIds?: string[] }[] = [];
  let pageToken = "";
  let latestHistoryId = startHistoryId;
  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`${GMAIL}/history?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (isHistoryExpired(response.status)) return { expired: true as const, ids, historyId: latestHistoryId };
    if (!response.ok) {
      const json = (await response.json()) as { error?: { message?: string } };
      throw new AppError(json.error?.message || "Gmail history could not be read.", response.status);
    }
    const json = (await response.json()) as {
      historyId?: string;
      nextPageToken?: string;
      history?: { messagesAdded?: { message?: { id?: string; labelIds?: string[] } }[] }[];
    };
    if (json.historyId) latestHistoryId = json.historyId;
    for (const item of json.history ?? []) {
      for (const added of item.messagesAdded ?? []) {
        if (added.message?.id) ids.push({ id: added.message.id, labelIds: added.message.labelIds });
      }
    }
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return { expired: false as const, ids, historyId: latestHistoryId };
}

export function messageHeaders(message: GmailFetchedMessage) {
  return {
    from: headerFrom(message.payload, "From"),
    subject: headerFrom(message.payload, "Subject"),
    messageId: headerFrom(message.payload, "Message-ID"),
    date: headerFrom(message.payload, "Date"),
  };
}
