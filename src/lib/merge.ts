const TAGS = ["firstName", "lastName", "email", "companyName", "jobTitle"] as const;

export type MergeValues = Record<(typeof TAGS)[number], string>;

export function renderTemplate(template: string, values: MergeValues): string {
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, key: string) => {
    if (key in values) return values[key as keyof MergeValues] ?? "";
    return match;
  });
}

export const MERGE_TAGS = TAGS;
