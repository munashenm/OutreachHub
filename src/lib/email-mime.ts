export type InlineImage = { cid: string; filename: string; contentType: string; data: Buffer };
export type MailAttachment = { filename: string; contentType: string; data: Buffer };

export function buildRawEmail(input: {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  html?: string;
  listUnsubscribe?: string;
  inReplyTo?: string | null;
  attachments?: MailAttachment[];
  inlineImages?: InlineImage[];
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
  const attachments = input.attachments ?? [];
  const inlineImages = input.inlineImages ?? [];
  let body = input.body;
  if (attachments.length === 0 && inlineImages.length === 0 && !input.html) {
    headers.push("Content-Type: text/plain; charset=UTF-8");
  } else if (attachments.length === 0 && inlineImages.length === 0) {
    const boundary = boundaryId("alt");
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [...alternativeParts(boundary, input.body, input.html), `--${boundary}--`, ""].join("\r\n");
  } else if (attachments.length === 0) {
    const boundary = boundaryId("rel");
    headers.push(`Content-Type: multipart/related; boundary="${boundary}"`);
    body = [...relatedParts(boundary, input.body, input.html, inlineImages), `--${boundary}--`, ""].join("\r\n");
  } else {
    const boundary = boundaryId("mix");
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    const parts = inlineImages.length > 0
      ? relatedWrapper(boundary, input.body, input.html, inlineImages)
      : alternativeWrapper(boundary, input.body, input.html);
    for (const file of attachments) parts.push(...attachmentPart(boundary, file));
    parts.push(`--${boundary}--`, "");
    body = parts.join("\r\n");
  }
  return Buffer.from([...headers, "", body].join("\r\n"), "utf8").toString("base64url");
}

function alternativeWrapper(mixedBoundary: string, plain: string, html?: string) {
  if (!html) {
    return [
      `--${mixedBoundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      plain,
    ];
  }
  const boundary = boundaryId("alt");
  return [
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    ...alternativeParts(boundary, plain, html),
    `--${boundary}--`,
  ];
}

function relatedWrapper(mixedBoundary: string, plain: string, html: string | undefined, images: InlineImage[]) {
  const boundary = boundaryId("rel");
  return [
    `--${mixedBoundary}`,
    `Content-Type: multipart/related; boundary="${boundary}"`,
    "",
    ...relatedParts(boundary, plain, html, images),
    `--${boundary}--`,
  ];
}

function relatedParts(boundary: string, plain: string, html: string | undefined, images: InlineImage[]) {
  const parts = alternativeWrapper(boundary, plain, html);
  for (const image of images) {
    const safeName = safeFilename(image.filename);
    parts.push(
      `--${boundary}`,
      `Content-Type: ${image.contentType}; name="${safeName}"`,
      "Content-Transfer-Encoding: base64",
      `Content-ID: <${image.cid}>`,
      `Content-Disposition: inline; filename="${safeName}"`,
      "",
      wrapBase64(image.data),
    );
  }
  return parts;
}

function alternativeParts(boundary: string, plain: string, html?: string) {
  const parts = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    plain,
  ];
  if (html) {
    parts.push(
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      html,
    );
  }
  return parts;
}

function attachmentPart(boundary: string, file: MailAttachment) {
  const safeName = safeFilename(file.filename);
  return [
    `--${boundary}`,
    `Content-Type: ${file.contentType}; name="${safeName}"`,
    `Content-Disposition: attachment; filename="${safeName}"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(file.data),
  ];
}

function safeFilename(filename: string) {
  return filename.replace(/["\r\n]/g, "");
}

function wrapBase64(data: Buffer) {
  return data.toString("base64").replace(/(.{76})/g, "$1\r\n");
}

function boundaryId(kind: string) {
  return `outreachhub_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
