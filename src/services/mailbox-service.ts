import { SignJWT, jwtVerify } from "jose";
import { getDb } from "../lib/db";
import { AppError } from "../lib/errors";
import { isInvalidGrant } from "../lib/gmail-sync";
import { decryptSecret, encryptSecret, reencryptIfLegacy } from "../lib/token-crypto";
import { MAILBOX_PROVIDER_LABELS } from "../lib/labels";
import { exchangeGoogleCode, googleAccountEmail, refreshGoogleAccessToken } from "./google-service";
import { exchangeMicrosoftCode, microsoftAccountEmail, refreshMicrosoftAccessToken } from "./microsoft-service";
import { recordActivity } from "./activity-service";

type MailboxProviderName = keyof typeof MAILBOX_PROVIDER_LABELS;

function stateKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new AppError("SESSION_SECRET must be at least 32 characters.", 500, "CONFIG");
  return new TextEncoder().encode(secret);
}

export async function signMailboxState(userId: string, workspaceId: string) {
  return new SignJWT({ wid: workspaceId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(stateKey());
}

export async function readMailboxState(token: string) {
  const { payload } = await jwtVerify(token, stateKey());
  if (!payload.sub || typeof payload.wid !== "string") throw new AppError("The mailbox connection expired. Try again.");
  return { userId: payload.sub, workspaceId: payload.wid };
}

export async function listMailboxes(workspaceId: string) {
  return getDb().mailbox.findMany({
    where: { workspaceId },
    select: {
      id: true,
      email: true,
      provider: true,
      connectionStatus: true,
      lastSyncAt: true,
      lastError: true,
      lastSuccessfulSendAt: true,
      lastInboundSyncAt: true,
      createdAt: true,
    },
    orderBy: { email: "asc" },
  });
}

export async function connectMailbox(input: { userId: string; workspaceId: string; code: string; provider: MailboxProviderName }) {
  const membership = await getDb().membership.findUnique({
    where: { userId_workspaceId: { userId: input.userId, workspaceId: input.workspaceId } },
  });
  if (!membership) throw new AppError("You are not a member of that workspace.", 403, "FORBIDDEN");

  const tokens = input.provider === "MICROSOFT" ? await exchangeMicrosoftCode(input.code) : await exchangeGoogleCode(input.code);
  if (!tokens.refresh_token) {
    const owner = input.provider === "MICROSOFT" ? "Microsoft" : "Google";
    throw new AppError(`${owner} did not grant offline access. Remove the app permission and connect again.`);
  }
  const account = input.provider === "MICROSOFT"
    ? { email: await microsoftAccountEmail(tokens.access_token), historyId: null }
    : await googleAccountEmail(tokens.access_token);
  const email = account.email;
  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const data = {
    accessTokenEncrypted: encryptSecret(tokens.access_token),
    refreshTokenEncrypted: encryptSecret(tokens.refresh_token),
    tokenExpiresAt,
    connectionStatus: "CONNECTED" as const,
    lastError: null,
    ...(account.historyId ? { historyId: account.historyId } : {}),
  };
  const mailbox = await getDb().mailbox.upsert({
    where: { workspaceId_provider_email: { workspaceId: input.workspaceId, provider: input.provider, email } },
    update: data,
    create: { workspaceId: input.workspaceId, provider: input.provider, email, ...data },
  });
  await recordActivity(getDb(), {
    workspaceId: input.workspaceId,
    actorId: input.userId,
    type: "MAILBOX_CONNECTED",
    summary: `Connected ${MAILBOX_PROVIDER_LABELS[input.provider]} mailbox ${email}.`,
  });
  return mailbox;
}

export async function disconnectMailbox(input: { userId: string; workspaceId: string; mailboxId: string }) {
  const mailbox = await getDb().mailbox.findFirst({
    where: { id: input.mailboxId, workspaceId: input.workspaceId },
  });
  if (!mailbox) throw new AppError("Mailbox not found.", 404, "NOT_FOUND");
  await getDb().mailbox.deleteMany({ where: { id: mailbox.id, workspaceId: input.workspaceId } });
  await recordActivity(getDb(), {
    workspaceId: input.workspaceId,
    actorId: input.userId,
    type: "MAILBOX_DISCONNECTED",
    summary: `Disconnected ${MAILBOX_PROVIDER_LABELS[mailbox.provider]} mailbox ${mailbox.email}.`,
  });
}

export async function accessTokenForMailbox(mailboxId: string, workspaceId: string) {
  const mailbox = await getDb().mailbox.findFirst({ where: { id: mailboxId, workspaceId } });
  if (!mailbox) throw new AppError("Mailbox not found.", 404, "NOT_FOUND");
  const accessUpdated = reencryptIfLegacy(mailbox.accessTokenEncrypted);
  const refreshUpdated = reencryptIfLegacy(mailbox.refreshTokenEncrypted);
  if (accessUpdated || refreshUpdated) {
    await getDb().mailbox.update({
      where: { id: mailbox.id },
      data: {
        ...(accessUpdated ? { accessTokenEncrypted: accessUpdated } : {}),
        ...(refreshUpdated ? { refreshTokenEncrypted: refreshUpdated } : {}),
      },
    });
  }
  const accessCipher = accessUpdated ?? mailbox.accessTokenEncrypted;
  const refreshCipher = refreshUpdated ?? mailbox.refreshTokenEncrypted;
  if (mailbox.tokenExpiresAt.getTime() > Date.now() + 60_000) {
    return { token: decryptSecret(accessCipher), email: mailbox.email, provider: mailbox.provider };
  }
  try {
    const refresh = mailbox.provider === "MICROSOFT" ? refreshMicrosoftAccessToken : refreshGoogleAccessToken;
    const refreshed = await refresh(decryptSecret(refreshCipher));
    await getDb().mailbox.update({
      where: { id: mailbox.id },
      data: {
        accessTokenEncrypted: encryptSecret(refreshed.access_token),
        refreshTokenEncrypted: refreshed.refresh_token ? encryptSecret(refreshed.refresh_token) : refreshCipher,
        tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
        connectionStatus: "CONNECTED",
        lastError: null,
      },
    });
    return { token: refreshed.access_token, email: mailbox.email, provider: mailbox.provider };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token refresh failed.";
    if (isInvalidGrant(message)) {
      await getDb().mailbox.update({
        where: { id: mailbox.id },
        data: { connectionStatus: "NEEDS_RECONNECT", lastError: "Google access expired. Reconnect the mailbox." },
      });
      throw new AppError("Google access expired. Reconnect the mailbox.", 401, "RECONNECT");
    }
    throw error;
  }
}
