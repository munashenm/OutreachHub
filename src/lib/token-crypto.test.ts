import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { decryptSecret, encryptSecret, reencryptIfLegacy } from "./token-crypto";

const key = Buffer.from("0123456789abcdef0123456789abcdef");

test("round-trips a credential with AES-256-GCM", () => {
  process.env.OAUTH_ENCRYPTION_KEY = key.toString("base64");
  process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-chars";
  const stored = encryptSecret("refresh-token-value");
  assert.equal(stored.includes("refresh-token-value"), false);
  assert.equal(decryptSecret(stored), "refresh-token-value");
  assert.equal(reencryptIfLegacy(stored), null);
});

test("reads a legacy SESSION_SECRET ciphertext and marks it for re-encryption", () => {
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars";
  process.env.OAUTH_ENCRYPTION_KEY = key.toString("base64");
  const legacyKey = createHash("sha256").update(process.env.SESSION_SECRET).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", legacyKey, iv);
  const encrypted = Buffer.concat([cipher.update("legacy-refresh", "utf8"), cipher.final()]);
  const payload = `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
  assert.equal(decryptSecret(payload), "legacy-refresh");
  const next = reencryptIfLegacy(payload);
  assert.ok(next);
  assert.equal(decryptSecret(next), "legacy-refresh");
});
