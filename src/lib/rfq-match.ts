export type RequestStrictness = "EXACT" | "EQUIVALENT_ALLOWED" | "RECOMMENDATION";

export function isRecommendationRequest(text: string) {
  return /\b(recommend(?:ation)?s?|no specific (?:make|model|brand|manufacturer)|suitable options?|different price levels?)\b/i.test(text);
}

export function equivalentsAllowed(text: string) {
  return /\b(or equivalent|meet or exceed|equivalent(?:s)? (?:is |are )?accept(?:able|ed)|business-class equivalent)\b/i.test(text);
}

export function equivalentsRejected(text: string) {
  return /\b(no equivalents?|equivalents?(?:\s+are)?\s+not acceptable|exact model only|do not substitute|must be (?:the |this )?exact|no (?:alternatives?|substitutes?))\b/i.test(text);
}

export function requestStrictness(text: string, namedProduct: boolean): RequestStrictness {
  if (isRecommendationRequest(text) && !equivalentsAllowed(text)) return "RECOMMENDATION";
  if (equivalentsAllowed(text) && !equivalentsRejected(text)) return "EQUIVALENT_ALLOWED";
  if (equivalentsRejected(text) || namedProduct) return "EXACT";
  return "EQUIVALENT_ALLOWED";
}

export function quoteOptionCount(text: string) {
  const recommendation = isRecommendationRequest(text);
  const levels = /\bdifferent price levels?\b/i.test(text);
  if (!recommendation && !levels) return 1;
  const word = text.match(/\b(two|three|2|3)\b/i)?.[1] ?? "";
  if (/^(?:two|2)$/i.test(word)) return 2;
  if (/^(?:three|3)$/i.test(word)) return 3;
  return levels ? 2 : 1;
}

export function followUpChangesRequirements(text: string) {
  return /\b(\d+\s*gb|\d+\s*tb|windows\s*1[01]|core\s+(?:i[3579]|ultra|[3579])|ultra\s+[3579]|ryzen\s+[3579]|ssd|nvme|warranty|\d+(?:\.\d+)?\s*(?:inch|inches))\b/i.test(text);
}

export function asksToProceed(text: string) {
  return /\b(please proceed|go ahead|that works)\b/i.test(text);
}
