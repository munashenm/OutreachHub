import Link from "next/link";
import { RegisterForm } from "@/components/auth-forms";

export default function RegisterPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Create a workspace</h1>
      <p className="mt-1 text-sm text-muted">Each customer organisation gets its own workspace. Nothing is shared between them.</p>
      <div className="mt-6">
        <RegisterForm />
      </div>
      <p className="mt-4 text-sm text-muted">
        Already have an account? <Link href="/login" className="text-accent">Sign in</Link>
      </p>
    </div>
  );
}
