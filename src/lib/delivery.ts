export type DeliveryCounts = {
  sent: number;
  failed: number;
  skipped: number;
  replies: number;
};

export function emptyDelivery(): DeliveryCounts {
  return { sent: 0, failed: 0, skipped: 0, replies: 0 };
}

export function addDeliveryRow(
  counts: DeliveryCounts,
  row: { direction: string; status: string; count: number },
) {
  if (row.direction === "INBOUND") counts.replies += row.count;
  else if (row.status === "SENT") counts.sent += row.count;
  else if (row.status === "FAILED") counts.failed += row.count;
  else if (row.status === "SKIPPED") counts.skipped += row.count;
}

export function replyRate(counts: DeliveryCounts) {
  if (counts.sent === 0) return null;
  return counts.replies / counts.sent;
}
