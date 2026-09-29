import { marketingBlockReason } from "./marketing";

export function shouldIngestGmailMessage(labelIds: string[] | undefined) {
  return !(labelIds ?? []).some((label) => label === "SPAM" || label === "TRASH");
}

export function isHistoryExpired(status: number) {
  return status === 404 || status === 410;
}

export function isInvalidGrant(message: string) {
  return /invalid_grant|token has been expired or revoked|invalid credentials/i.test(message);
}

export function planInboundInserts<T extends { externalId: string }>(existing: Set<string>, incoming: T[]) {
  const seen = new Set(existing);
  const fresh: T[] = [];
  for (const item of incoming) {
    if (!item.externalId || seen.has(item.externalId)) continue;
    seen.add(item.externalId);
    fresh.push(item);
  }
  return fresh;
}

export function matchSender<T extends { email: string }>(email: string, prospects: T[]) {
  const found = prospects.find((prospect) => prospect.email.toLowerCase() === email.toLowerCase());
  return found ? { kind: "matched" as const, prospect: found } : { kind: "unknown" as const };
}

export function ownedByWorkspace<T extends { workspaceId: string }>(record: T | null, workspaceId: string) {
  if (!record || record.workspaceId !== workspaceId) return null;
  return record;
}

export function campaignLinkForInbound(
  threadId: string,
  outbound: { id: string; threadId: string | null; campaignId: string | null; prospectId: string | null }[],
) {
  return outbound.find((message) => message.threadId === threadId && message.campaignId) ?? null;
}

export function canSendPromotional(status: Parameters<typeof marketingBlockReason>[0], suppressed: boolean) {
  return marketingBlockReason(status, suppressed) === null;
}

export function canSendTransactionalReply() {
  return true;
}

export function rfqDraftFromMessage(message: { subject: string; body: string; prospectId: string | null; companyId?: string | null }) {
  return {
    subject: message.subject || "Customer enquiry",
    description: message.body,
    prospectId: message.prospectId,
    companyId: message.companyId ?? null,
  };
}
