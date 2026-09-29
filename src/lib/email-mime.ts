export function buildRawEmail(input: {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  html?: string;
  listUnsubscribe?: string;
  inReplyTo?: string | null;
}): string {
  const subject = `=?UTF-8?B?${Buffer.from(input.subject, "utf8").toString("base64")}?=`;
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    ...(input.cc ? [`Cc: ${input.cc}`] : []),
    `Subject: ${subject}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`] : []),
    ...(input.listUnsubscribe
      ? [
          `List-Unsubscribe: <${input.listUnsubscribe}>`,
          "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
        ]
      : []),
    "MIME-Version: 1.0",
  ];
  let body = input.body;
  if (input.html) {
    const boundary = `outreachhub_${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      input.body,
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "",
      input.html,
      `--${boundary}--`,
      "",
    ].join("\r\n");
  } else {
    headers.push("Content-Type: text/plain; charset=UTF-8");
  }
  const message = [...headers, "", body].join("\r\n");
  return Buffer.from(message, "utf8").toString("base64url");
}
