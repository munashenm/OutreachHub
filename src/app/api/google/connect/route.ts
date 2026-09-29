import { NextResponse } from "next/server";
import { requireSession } from "@/services/auth-service";
import {
  GOOGLE_OAUTH_STATE_COOKIE,
  googleAuthUrl,
  googleOauthStateCookieOptions,
  googleOauthStateHash,
} from "@/services/google-service";
import { signMailboxState } from "@/services/mailbox-service";

export async function GET() {
  const session = await requireSession();
  const state = await signMailboxState(session.user.id, session.workspace.id);
  const response = NextResponse.redirect(googleAuthUrl(state));
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, googleOauthStateHash(state), googleOauthStateCookieOptions(600));
  return response;
}
