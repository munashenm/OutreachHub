export type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
};

export function listGmailAttachments(payload: GmailPart | undefined): Array<{ filename: string; contentType: string; data?: string; attachmentId?: string }> {
  if (!payload) return [];
  const found: Array<{ filename: string; contentType: string; data?: string; attachmentId?: string }> = [];
  const filename = payload.filename?.trim() ?? "";
  if (filename && (payload.body?.data || payload.body?.attachmentId)) {
    found.push({ filename, contentType: payload.mimeType || "application/octet-stream", data: payload.body?.data, attachmentId: payload.body?.attachmentId });
  }
  for (const part of payload.parts ?? []) found.push(...listGmailAttachments(part));
  return found;
}

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
