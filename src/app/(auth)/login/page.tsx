import Link from "next/link";
import { LoginForm } from "@/components/auth-forms";
import { firstParam } from "@/lib/format";
import { safeNextPath } from "@/lib/password";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = firstParam(params.status);
  return (
    <div>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Use the workspace account for your organisation.</p>
      {status === "reset" ? <p className="mt-4 text-sm text-emerald-800">Password updated. Sign in with the new password.</p> : null}
      <div className="mt-6">
        <LoginForm nextPath={safeNextPath(firstParam(params.next))} />
      </div>
      <div className="mt-4 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-accent">Forgot password</Link>
        <Link href="/register" className="text-accent">Create workspace</Link>
      </div>
    </div>
  );
}
