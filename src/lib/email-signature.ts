import { readFileSync } from "node:fs";
import path from "node:path";

export const URBAN_FOCUS_LOGO_CID = "urban-focus-logo";
const CONFIDENTIAL = "This email and any attachments may contain confidential information intended only for the addressed recipient. If you received it in error, please notify the sender and delete it.";

export function plainClientSignature() {
  return [
    "Urban Focus Sales Team",
    "IT Equipment • Software • Solutions",
    "T 087 550 1813",
    "E sales@urbanfocus.co.za",
    "W www.urbanfocus.co.za",
    "A Samrand Business Park, Centurion, Gauteng, South Africa",
    "",
    CONFIDENTIAL,
  ].join("\n");
}

export function withClientSignature(body: string) {
  const message = body.trimEnd();
  const signed = message.includes(CONFIDENTIAL) ? message : `${message}\n\n${plainClientSignature()}`;
  return { body: signed, html: clientEmailHtml(message) };
}

export function urbanFocusLogoInline() {
  try {
    const data = readFileSync(path.join(process.cwd(), "public", "brand", "urban-focus-logo.png"));
    return { cid: URBAN_FOCUS_LOGO_CID, filename: "urban-focus-logo.png", contentType: "image/png", data };
  } catch {
    return null;
  }
}

function clientEmailHtml(message: string) {
  const lines = escapeHtml(message).split("\n").map((line) => line || "&nbsp;").join("<br>");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Urban Focus</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:24px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:700px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#24385f;">${lines}</div>
  <div style="height:18px;line-height:18px;">&nbsp;</div>
  ${signatureHtml()}
</body>
</html>`;
}

function signatureHtml() {
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:700px;width:100%;font-family:Arial,Helvetica,sans-serif;color:#0b1f4d;">
    <tr>
      <td style="vertical-align:middle;width:185px;padding-right:22px;border-right:2px solid #1267ff;">
        <img src="cid:${URBAN_FOCUS_LOGO_CID}" alt="Urban Focus" width="165" style="display:block;width:165px;max-width:165px;height:auto;border:0;">
      </td>
      <td style="vertical-align:middle;padding-left:22px;">
        <div style="font-size:20px;line-height:24px;font-weight:700;color:#0b1f4d;">Urban Focus Sales Team</div>
        <div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:1.1px;color:#1267ff;text-transform:uppercase;margin-top:2px;">IT Equipment • Software • Solutions</div>
        <div style="height:10px;line-height:10px;">&nbsp;</div>
        <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#24385f;">
          <tr>
            <td style="font-weight:700;padding-right:8px;color:#0b1f4d;">T</td>
            <td><a href="tel:+27875501813" style="color:#24385f;text-decoration:none;">087 550 1813</a></td>
          </tr>
          <tr>
            <td style="font-weight:700;padding-right:8px;color:#0b1f4d;">E</td>
            <td><a href="mailto:sales@urbanfocus.co.za" style="color:#1267ff;text-decoration:none;">sales@urbanfocus.co.za</a></td>
          </tr>
          <tr>
            <td style="font-weight:700;padding-right:8px;color:#0b1f4d;">W</td>
            <td><a href="https://www.urbanfocus.co.za" style="color:#1267ff;text-decoration:none;">www.urbanfocus.co.za</a></td>
          </tr>
          <tr>
            <td style="font-weight:700;padding-right:8px;color:#0b1f4d;">A</td>
            <td>Samrand Business Park, Centurion, Gauteng, South Africa</td>
          </tr>
        </table>
        <div style="height:10px;line-height:10px;">&nbsp;</div>
        <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr>
            <td style="padding-right:7px;"><a href="https://www.facebook.com/urbanfocusonline" title="Facebook" style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background:#1267ff;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;border-radius:13px;">f</a></td>
            <td style="padding-right:7px;"><a href="https://www.instagram.com/urbanfocusonline/" title="Instagram" style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background:#1267ff;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;border-radius:13px;">◎</a></td>
            <td style="padding-right:7px;"><a href="https://x.com/urbanfocusza" title="X" style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background:#1267ff;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;border-radius:13px;">X</a></td>
            <td><a href="https://www.tiktok.com/@urbanfocussa" title="TikTok" style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background:#1267ff;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;border-radius:13px;">♪</a></td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  <div style="max-width:700px;margin-top:14px;padding-top:9px;border-top:1px solid #e4e9f2;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:14px;color:#7a8499;">${CONFIDENTIAL}</div>`;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
