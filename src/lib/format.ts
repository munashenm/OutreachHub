export type ActionState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
  devResetUrl?: string;
  draft?: { subject: string; body: string };
  pending?: boolean;
};

export const initialActionState: ActionState = {};

export function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function withQuery(
  path: string,
  current: Record<string, string>,
  updates: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  const merged = { ...current, ...updates };
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function formatDateTime(value: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function fullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}
