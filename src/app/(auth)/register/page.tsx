import Link from "next/link";
import { RegisterForm } from "@/components/auth-forms";
import { registrationOpen } from "@/services/auth-service";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const open = await registrationOpen();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Urban Focus</h1>
      {open ? (
        <>
          <p className="mt-1 text-sm text-muted">Create the staff account for the store. This page closes after the first account exists.</p>
          <div className="mt-6">
            <RegisterForm />
          </div>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">The staff account already exists. Sign in to use the store.</p>
      )}
      <p className="mt-4 text-sm text-muted">
        <Link href="/login" className="text-accent">Sign in</Link>
      </p>
    </div>
  );
}
