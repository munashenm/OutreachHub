export function parseDraft(raw: string): { subject: string; body: string } | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { subject?: unknown; body?: unknown };
  const subject = typeof record.subject === "string" ? record.subject.trim() : "";
  const body = typeof record.body === "string" ? record.body.trim() : "";
  if (!subject || !body || subject.length > 200 || body.length > 8000) return null;
  return { subject, body };
}
