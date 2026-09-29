import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted">That record is not in this workspace, or the address is wrong.</p>
      <Link href="/dashboard" className="mt-4 inline-block text-sm text-accent">Back to dashboard</Link>
    </div>
  );
}
