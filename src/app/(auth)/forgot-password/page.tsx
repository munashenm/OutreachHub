import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth-forms";

export default function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Reset password</h1>
      <p className="mt-1 text-sm leading-6 text-muted">
        We email a one-hour reset link from the connected mailbox. The password stays the same until you submit a new one.
      </p>
      <div className="mt-6">
        <ForgotPasswordForm />
      </div>
      <Link href="/login" className="mt-4 inline-block text-sm text-accent">Back to sign in</Link>
    </div>
  );
}
