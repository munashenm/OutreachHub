import assert from "node:assert/strict";
import test from "node:test";
import { googleAuthUrl, googleOauthStateHash, googleOauthStateMatches, normalizeAppOrigin } from "../services/google-service";

const CLIENT_ID = "123456789012-abcdefghij.apps.googleusercontent.com";

test("builds the production Google redirect from APP_URL", () => {
  assert.equal(
    normalizeAppOrigin("  \"https://outreachhub-production.up.railway.app/\"  ", true),
    "https://outreachhub-production.up.railway.app",
  );
  assert.throws(() => normalizeAppOrigin("http://outreachhub-production.up.railway.app", true));
  assert.throws(() => normalizeAppOrigin("https://outreachhub-production.up.railway.app/extra", true));
  assert.throws(() => normalizeAppOrigin(undefined, true));
  assert.equal(normalizeAppOrigin(undefined, false), "http://localhost:3000");
});

test("creates a web-server Google authorize URL", () => {
  const previousAppUrl = process.env.APP_URL;
  const previousClientId = process.env.GOOGLE_CLIENT_ID;
  process.env.APP_URL = "https://outreachhub-production.up.railway.app";
  process.env.GOOGLE_CLIENT_ID = ` ${CLIENT_ID} `;
  try {
    const href = googleAuthUrl("state-value");
    const url = new URL(String(new URL(href)));
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("redirect_uri"), "https://outreachhub-production.up.railway.app/api/google/callback");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.equal(url.searchParams.get("include_granted_scopes"), "true");
    assert.equal(url.searchParams.get("client_id"), CLIENT_ID);
    assert.equal(url.searchParams.get("state"), "state-value");
    assert.equal(href.includes("response_type=token"), false);
    assert.equal(href.includes("urn:ietf:wg:oauth:2.0:oob"), false);
    assert.equal(href.includes("client_secret"), false);
    assert.equal(href.includes("gmail.send+"), false);
    assert.equal(href.includes("%20"), true);
  } finally {
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
    if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previousClientId;
  }
});

test("matches the OAuth state stored for the callback", () => {
  assert.equal(googleOauthStateMatches(undefined, "opaque-state"), false);
  const cookie = googleOauthStateHash("opaque-state");
  assert.equal(googleOauthStateMatches(cookie, "opaque-state"), true);
  assert.equal(googleOauthStateMatches(cookie, "other-state"), false);
});
