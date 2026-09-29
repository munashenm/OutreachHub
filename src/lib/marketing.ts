import type { MarketingStatus } from "@/lib/labels";

const UNSENDABLE = new Set<MarketingStatus>(["OPTED_OUT", "BLOCKED", "BOUNCED"]);

export function marketingBlockReason(
  status: MarketingStatus,
  suppressed: boolean,
): string | null {
  if (status === "OPTED_OUT") {
    return "This prospect has opted out of marketing.";
  }
  if (status === "BLOCKED") {
    return "This prospect is blocked from marketing.";
  }
  if (status === "BOUNCED") {
    return "This email address has bounced.";
  }
  if (suppressed) {
    return "This email address is on the suppression list.";
  }
  return null;
}

export function requiresSuppression(status: MarketingStatus): boolean {
  return status === "OPTED_OUT" || status === "BLOCKED";
}

export function isUnsendableStatus(status: MarketingStatus): boolean {
  return UNSENDABLE.has(status);
}
