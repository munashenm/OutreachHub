import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function legacyKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }
  return createHash("sha256").update(secret).digest();
}

export function oauthKey() {
  const raw = process.env.OAUTH_ENCRYPTION_KEY;
  if (!raw) throw new Error("OAUTH_ENCRYPTION_KEY is not configured.");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  const utf8 = Buffer.from(raw, "utf8");
  if (utf8.length === 32) return utf8;
  throw new Error("OAUTH_ENCRYPTION_KEY must be 32 bytes or base64 for 32 bytes.");
}

function seal(value: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function open(payload: string, key: Buffer) {
  const [iv, tag, encrypted] = payload.split(".");
  if (!iv || !tag || !encrypted) throw new Error("Stored credential is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function encryptSecret(value: string): string {
  return seal(value, oauthKey());
}

export function decryptSecret(payload: string): string {
  try {
    return open(payload, oauthKey());
  } catch (error) {
    if (!process.env.OAUTH_ENCRYPTION_KEY) throw error;
    return open(payload, legacyKey());
  }
}

export function reencryptIfLegacy(payload: string): string | null {
  try {
    open(payload, oauthKey());
    return null;
  } catch {
    const value = open(payload, legacyKey());
    return seal(value, oauthKey());
  }
}
