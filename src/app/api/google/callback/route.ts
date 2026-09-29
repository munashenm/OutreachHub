import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/lib/errors";
import {
  GOOGLE_OAUTH_STATE_COOKIE,
  googleOauthStateCookieOptions,
  googleOauthStateMatches,
  normalizeAppOrigin,
} from "@/services/google-service";
import { connectMailbox, readMailboxState } from "@/services/mailbox-service";

function finish(location: string) {
  const response = NextResponse.redirect(location);
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", googleOauthStateCookieOptions(0));
  return response;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const appUrl = normalizeAppOrigin(process.env.APP_URL, process.env.NODE_ENV === "production");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookie = request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !googleOauthStateMatches(cookie, state)) {
    return finish(`${appUrl}/settings/mailboxes?status=error`);
  }
  try {
    const session = await readMailboxState(state);
    await connectMailbox({ ...session, code, provider: "GOOGLE" });
    return finish(`${appUrl}/settings/mailboxes?status=connected`);
  } catch (error) {
    const reason = error instanceof AppError ? "denied" : "error";
    return finish(`${appUrl}/settings/mailboxes?status=${reason}`);
  }
}
