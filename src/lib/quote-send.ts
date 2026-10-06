// Delays are exact on nextRetryAt. The only scheduler is the Gmail worker, which runs every 15 minutes, so a 1-minute or 5-minute delay is picked up on the next tick.
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 60 * 60_000];

export function quoteSendKey(quoteId: string, version: number) {
  return `QUOTE_SEND:${quoteId}:${version}`;
}

export function retryDelayMs(attemptCount: number) {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) return null;
  return RETRY_DELAYS_MS[attemptCount - 1] ?? null;
}

export function classifySendFailure(error: unknown): "UNKNOWN" | "FAILED_CONFIRMED" {
  const message = error instanceof Error ? error.message : "";
  if (/timeout|timed out|econnreset|eai_again|socket hang up|network|fetch failed|aborted|connection reset/i.test(message)) return "UNKNOWN";
  const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : 0;
  if (status === 408 || status >= 500) return "UNKNOWN";
  if (status >= 400 && status < 500) return "FAILED_CONFIRMED";
  return "UNKNOWN";
}
