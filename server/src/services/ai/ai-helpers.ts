export const INPUT_LIMIT = 2_000;
export const OUTPUT_CHAR_LIMIT = 6_000;

export function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

export function stripPii(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b\d{10}\b/g, "[redacted-phone]");
}

export function detectInjection(value: string): boolean {
  return /(ignore previous|system prompt|developer mode|jailbreak|bypass)/i.test(value);
}

export function complexityScore(input: string): number {
  let score = 0;
  if (input.length > 450) score += 1;
  if ((input.match(/\?/g) ?? []).length >= 2) score += 1;
  if (/(compare|analyze|derive|optimize|prove|architecture|tradeoff)/i.test(input)) score += 1;
  if (/(code|algorithm|complexity|sql|system design)/i.test(input)) score += 1;
  if (/(step[- ]by[- ]step|deep|detailed|comprehensive)/i.test(input)) score += 1;
  if (/(and|also|additionally).+(and|also|additionally)/i.test(input)) score += 1;
  return score;
}

export function pickModel(input: string): "gemini-2.0-flash" | "gemini-1.5-pro" {
  return complexityScore(input) >= 3 ? "gemini-1.5-pro" : "gemini-2.0-flash";
}

export function buildSystemPrompt(): string {
  return [
    "Role: You are CampusDrive AI, a placement-prep tutor.",
    "Rules: Keep answers accurate, practical, and concise.",
    "Context: Focus on aptitude, coding, interviews, and placement strategy.",
    "Format: Use headings and actionable steps where relevant.",
    "Safety: Avoid sharing personal data and reject unsafe requests.",
  ].join("\n");
}

export function detectTopic(message: string): string {
  if (/(sql|database|query)/i.test(message)) return "sql";
  if (/(array|string|dp|graph|tree|algorithm|dsa)/i.test(message)) return "dsa";
  if (/(aptitude|percent|probability|time and work|quant)/i.test(message)) return "aptitude";
  if (/(interview|hr|communication|behavior)/i.test(message)) return "interview";
  return "general";
}
