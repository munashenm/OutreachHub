import { AppError } from "@/lib/errors";
import { applyUnsubscribe } from "@/services/unsubscribe-service";

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  try {
    await applyUnsubscribe(token);
    return new Response(null, { status: 200 });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Could not unsubscribe.";
    return Response.json({ error: message }, { status: 400 });
  }
}
