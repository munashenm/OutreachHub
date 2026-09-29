import { z } from "zod";
import { CSV_HEADERS, LEAD_STATUSES, MARKETING_STATUSES } from "@/lib/labels";
import { prospectCsvSchema } from "@/lib/validators";

export type ImportRejection = {
  row: number;
  email: string;
  reason: string;
};

export type PlannedProspect = z.infer<typeof prospectCsvSchema>;

export type ImportPlan = {
  ready: { row: number; prospect: PlannedProspect }[];
  rejected: ImportRejection[];
};

export function planProspectImport(
  records: Record<string, string>[],
  existingEmails: Set<string>,
): ImportPlan {
  const ready: ImportPlan["ready"] = [];
  const rejected: ImportRejection[] = [];
  const seen = new Set<string>();

  records.forEach((record, index) => {
    const row = index + 2;
    const parsed = prospectCsvSchema.safeParse(normalizeCsvRecord(record));
    if (!parsed.success) {
      rejected.push({
        row,
        email: record.email ?? "",
        reason: parsed.error.issues[0]?.message ?? "This row is invalid.",
      });
      return;
    }

    const email = parsed.data.email;
    if (seen.has(email)) {
      rejected.push({
        row,
        email,
        reason: "This email is duplicated in the file.",
      });
      return;
    }
    seen.add(email);
    if (existingEmails.has(email)) {
      rejected.push({
        row,
        email,
        reason: "A prospect with this email already exists in this workspace.",
      });
      return;
    }

    ready.push({ row, prospect: parsed.data });
  });

  return { ready, rejected };
}

function normalizeCsvRecord(record: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const header of CSV_HEADERS) {
    normalized[header] = record[header.toLowerCase()] ?? record[header] ?? "";
  }
  if (!normalized.leadStatus) normalized.leadStatus = "NEW";
  if (!normalized.marketingStatus) normalized.marketingStatus = "UNKNOWN";
  if (normalized.leadStatus) normalized.leadStatus = normalized.leadStatus.toUpperCase();
  if (normalized.marketingStatus) {
    normalized.marketingStatus = normalized.marketingStatus.toUpperCase();
  }
  return normalized;
}

export const importStatusHint = {
  leadStatus: LEAD_STATUSES.join(", "),
  marketingStatus: MARKETING_STATUSES.join(", "),
};
