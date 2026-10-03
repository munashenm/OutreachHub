export const STOCK_PUSH_BATCH = 40;
export const STOCK_PUSH_BATCH_DELAY_MS = 400;
export const STOCK_PUSH_BUDGET_MS = 180_000;

export type StockWebsiteAction = "update-stock" | "create" | "hold";
export type StockStopReason = "budget" | "website-unreachable" | null;

/** The website catalogue stays the source of names, descriptions, images, and publication. */
export function stockWebsiteAction(matchedOnWebsite: boolean, reviewStatus: string): StockWebsiteAction {
  if (matchedOnWebsite) return "update-stock";
  if (reviewStatus === "PUBLISH") return "create";
  return "hold";
}

export function stockPushWritesContent(action: StockWebsiteAction) {
  return action === "create";
}

export function stockDrainTimedOut(now: number, deadlineAt: number) {
  return now >= deadlineAt;
}

export function stockPushTotals(input: {
  pending: number;
  succeeded: number;
  failed: number;
  heldLocally: number;
  pricesHeld: number;
  remaining: number;
}) {
  return {
    pending: input.pending,
    processed: input.succeeded + input.failed + input.heldLocally,
    succeeded: input.succeeded,
    failed: input.failed,
    heldLocally: input.heldLocally,
    pricesHeld: input.pricesHeld,
    remaining: input.remaining,
  };
}

/** Keep calling the website only when time ran out and earlier products were accepted. */
export function stockRunShouldContinue(input: { remaining: number; stopReason: StockStopReason; error: string | null }) {
  return input.remaining > 0 && input.stopReason === "budget" && !input.error;
}
