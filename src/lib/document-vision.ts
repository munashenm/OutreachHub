export async function readImageText(input: { filename: string; contentType: string; bytes: Buffer }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { text: "", warning: `${input.filename} was stored. Document vision did not run because OPENAI_API_KEY is not configured.` };
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Read only the words visible in this document image. Return JSON with a text key containing those words, including table rows on separate lines. Do not invent products, quantities, prices, dates, or names that are not visible. Use an empty string when a value is not visible.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: input.filename },
            { type: "image_url", image_url: { url: `data:${input.contentType || "image/png"};base64,${input.bytes.toString("base64")}` } },
          ],
        },
      ],
    }),
  });
  if (!response.ok) return { text: "", warning: `${input.filename} was stored. Document vision did not return text.` };
  const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  try {
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "") as { text?: unknown };
    const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    return { text, warning: text ? "" : `${input.filename} was stored. Document vision did not find readable text.` };
  } catch {
    return { text: "", warning: `${input.filename} was stored. Document vision did not return text.` };
  }
}
