import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth-forms";
import { firstParam } from "@/lib/format";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = firstParam((await searchParams).token);
  return (
    <div>
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      {token ? (
        <div className="mt-6">
          <ResetPasswordForm token={token} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-red-700">This reset link is missing a token.</p>
      )}
      <Link href="/login" className="mt-4 inline-block text-sm text-accent">Back to sign in</Link>
    </div>
  );
}
