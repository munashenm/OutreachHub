import { NextResponse } from "next/server";
import { requireSession } from "@/services/auth-service";
import { googleAuthUrl } from "@/services/google-service";
import { signMailboxState } from "@/services/mailbox-service";

export async function GET() {
  const session = await requireSession();
  const state = await signMailboxState(session.user.id, session.workspace.id);
  return NextResponse.redirect(googleAuthUrl(state));
}
