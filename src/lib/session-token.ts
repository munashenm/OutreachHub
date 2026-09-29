import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "outreachhub_session";

export type SessionToken = {
  userId: string;
  workspaceId: string;
};

function secretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(session: SessionToken): Promise<string> {
  return new SignJWT({ wid: session.workspaceId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey());
}

export async function readSessionToken(token: string): Promise<SessionToken | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub || typeof payload.wid !== "string") return null;
    return { userId: payload.sub, workspaceId: payload.wid };
  } catch {
    return null;
  }
}

export { COOKIE_NAME };
