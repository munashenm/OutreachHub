import { parseDraft } from "../lib/ai-draft";
import { MERGE_TAGS } from "../lib/merge";
import { AppError } from "../lib/errors";

const tags = MERGE_TAGS.map((tag) => `{{${tag}}}`).join(", ");

export async function draftTemplate(input: { brief: string; name: string; subject: string; body: string }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AppError("OPENAI_API_KEY is not configured.", 500, "CONFIG");
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You write plain-text B2B sales email for OutreachHub.",
            `Use only these merge tags when a personal detail is needed: ${tags}.`,
            "Do not invent prices, stock, discounts, or product specifications.",
            "Do not claim the recipient has opted in.",
            "Return JSON with subject and body keys. The body is plain text, not HTML.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Template name: ${input.name || "Untitled"}`,
            `Brief: ${input.brief}`,
            input.subject ? `Current subject: ${input.subject}` : "",
            input.body ? `Current message:\n${input.body}` : "",
            input.subject || input.body ? "Revise the current email to match the brief." : "Write a new email from the brief.",
          ].filter(Boolean).join("\n\n"),
        },
      ],
    }),
  });
  const json = (await response.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };
  if (!response.ok) throw new AppError(json.error?.message || "OpenAI did not draft the email.");
  const content = json.choices?.[0]?.message?.content ?? "";
  const draft = parseDraft(content);
  if (!draft) throw new AppError("OpenAI returned a draft that could not be used. Try a shorter brief.");
  return draft;
}
