export function mailboxAddress(mail: string | null | undefined, userPrincipalName: string | null | undefined) {
  const candidate = (mail || userPrincipalName || "").trim().toLowerCase();
  if (!candidate.includes("@")) return null;
  return candidate;
}

export function odataString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
