import { redirect } from "next/navigation";
import { buttonPrimary } from "@/components/ui";
import { firstParam } from "@/lib/format";
import { AppError } from "@/lib/errors";
import { applyUnsubscribe } from "@/services/unsubscribe-service";

async function confirmUnsubscribe(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  try {
    await applyUnsubscribe(token);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Could not unsubscribe.";
    redirect(`/unsubscribe?token=${encodeURIComponent(token)}&error=${encodeURIComponent(message)}`);
  }
  redirect(`/unsubscribe?token=${encodeURIComponent(token)}&status=done`);
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = firstParam(params.token);
  const status = firstParam(params.status);
  const error = firstParam(params.error);
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Urban Focus</p>
        <h1 className="mt-4 text-xl font-semibold">Stop marketing email</h1>
        {status === "done" ? (
          <p className="mt-3 text-sm text-muted">This address will not receive further marketing email from this workspace.</p>
        ) : (
          <form action={confirmUnsubscribe} className="mt-4 space-y-4">
            <input type="hidden" name="token" value={token} />
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            <p className="text-sm text-muted">Confirm to opt out of marketing email. Sales replies already in progress are not deleted.</p>
            <button className={buttonPrimary} disabled={!token}>Unsubscribe</button>
          </form>
        )}
      </div>
    </div>
  );
}
