export type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
};

export function parseEmailAddress(header: string) {
  const match = header.match(/<([^>]+)>/);
  const email = (match?.[1] ?? header).trim().toLowerCase();
  const name = header.replace(/<[^>]+>/, "").replaceAll('"', "").trim();
  return { name, email: email.includes("@") ? email : "" };
}

export function decodeGmailBody(data: string) {
  return Buffer.from(data, "base64url").toString("utf8");
}

export function extractPlainText(payload: GmailPart | undefined): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return decodeGmailBody(payload.body.data);
  for (const part of payload.parts ?? []) {
    const text = extractPlainText(part);
    if (text) return text;
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeGmailBody(payload.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

export function headerFrom(payload: GmailPart | undefined, name: string) {
  return payload?.headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function replyTargets(original: { threadId: string | null; internetMessageId: string | null; subject: string; fromEmail: string | null }) {
  const subject = original.subject.toLowerCase().startsWith("re:") ? original.subject : `Re: ${original.subject}`;
  return {
    threadId: original.threadId,
    inReplyTo: original.internetMessageId,
    subject,
    to: original.fromEmail ?? "",
  };
}
