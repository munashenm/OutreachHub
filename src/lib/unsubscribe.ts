import { SignJWT, jwtVerify } from "jose";

export type UnsubscribeToken = {
  workspaceId: string;
  prospectId: string;
  campaignId: string | null;
};

function secretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export function appOrigin() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function withUnsubscribeFooter(body: string, url: string) {
  return `${body.trimEnd()}\n\n---\nTo stop these marketing emails, open ${url}\n`;
}

export async function signUnsubscribeToken(input: UnsubscribeToken) {
  return new SignJWT({
    wid: input.workspaceId,
    pid: input.prospectId,
    cid: input.campaignId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("unsubscribe")
    .setIssuedAt()
    .setExpirationTime("365d")
    .sign(secretKey());
}

export async function readUnsubscribeToken(token: string): Promise<UnsubscribeToken | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.sub !== "unsubscribe" || typeof payload.wid !== "string" || typeof payload.pid !== "string") return null;
    return {
      workspaceId: payload.wid,
      prospectId: payload.pid,
      campaignId: typeof payload.cid === "string" ? payload.cid : null,
    };
  } catch {
    return null;
  }
}

export async function unsubscribeUrl(input: UnsubscribeToken) {
  const token = await signUnsubscribeToken(input);
  return `${appOrigin()}/unsubscribe?token=${encodeURIComponent(token)}`;
}
