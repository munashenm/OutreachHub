import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { connectMailbox, readMailboxState } from "@/services/mailbox-service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const appUrl = (process.env.APP_URL ?? url.origin).replace(/\/$/, "");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/settings/mailboxes?status=error`);
  }
  try {
    const session = await readMailboxState(state);
    await connectMailbox({ ...session, code, provider: "GOOGLE" });
    return NextResponse.redirect(`${appUrl}/settings/mailboxes?status=connected`);
  } catch (error) {
    console.error(error);
    const reason = error instanceof AppError ? "denied" : "error";
    return NextResponse.redirect(`${appUrl}/settings/mailboxes?status=${reason}`);
  }
}
