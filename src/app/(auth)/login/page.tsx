import Link from "next/link";
import { LoginForm } from "@/components/auth-forms";
import { firstParam } from "@/lib/format";
import { safeNextPath } from "@/lib/password";
import { registrationOpen } from "@/services/auth-service";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = firstParam(params.status);
  const open = await registrationOpen();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Urban Focus store.</p>
      {status === "reset" ? <p className="mt-4 text-sm text-emerald-800">Password updated. Sign in with the new password.</p> : null}
      <div className="mt-6">
        <LoginForm nextPath={safeNextPath(firstParam(params.next))} />
      </div>
      <div className="mt-4 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-accent">Forgot password</Link>
        {open ? <Link href="/register" className="text-accent">Create the store account</Link> : null}
      </div>
    </div>
  );
}
