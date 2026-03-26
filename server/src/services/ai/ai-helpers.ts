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

export function buildSystemPrompt(input?: {
  branch?: string;
  focusTopics?: string[];
}): string {
  const branch = String(input?.branch ?? "").trim();
  const focusTopics = (input?.focusTopics ?? []).filter(Boolean);

  return [
    "Role: You are CampusDrive AI, a helpful academic tutor.",
    "Goal: Provide clear, step-by-step solutions to student doubts.",
    "Clarification rule: If the input is unclear, ask a clarification question first.",
    "Detail rule: Explain concepts with formulas, reasoning, and one worked example when relevant.",
    "Format rule: Use plain text only. Do not use markdown symbols like *, **, -, or #.",
    "Length rule: Prefer detailed responses up to about 650 words.",
    branch
      ? `Context: The student belongs to ${branch}. Focus on aptitude, interviews, placement strategy, and the branch-relevant technical areas first.`
      : "Context: Focus on aptitude, coding, interviews, and placement strategy.",
    focusTopics.length > 0
      ? `Priority topics for this student: ${focusTopics.join(", ")}.`
      : "Priority topics: aptitude, interviews, and role-relevant technical preparation.",
    "Safety: Avoid sharing personal data and reject unsafe requests.",
  ].join("\n");
}

export function limitWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return text.trim();
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
}

export function sanitizeAssistantOutput(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const cleaned = lines.map((line) => {
    let value = line;
    value = value.replace(/^\s*#{1,6}\s*/g, "");
    value = value.replace(/\*\*(.*?)\*\*/g, "$1");
    value = value.replace(/__(.*?)__/g, "$1");
    value = value.replace(/^\s*[-*]\s+/g, "");
    value = value.replace(/^\s*(\d+)\)\s+/g, "$1. ");
    return value.trimEnd();
  });

  return cleaned
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function detectTopic(message: string): string {
  if (/(digital electronics|analog|signals|communication systems|microcontroller|embedded)/i.test(message)) return "electronics";
  if (/(power systems|electrical machines|circuit theory|control systems|power electronics)/i.test(message)) return "electrical";
  if (/(thermodynamics|manufacturing|fluid mechanics|cad|strength of materials)/i.test(message)) return "mechanical";
  if (/(structural|surveying|geotechnical|transportation engineering|construction management)/i.test(message)) return "civil";
  if (/(sql|database|query)/i.test(message)) return "sql";
  if (/(array|string|dp|graph|tree|algorithm|dsa)/i.test(message)) return "dsa";
  if (/(aptitude|percent|probability|time and work|quant)/i.test(message)) return "aptitude";
  if (/(interview|hr|communication|behavior)/i.test(message)) return "interview";
  return "general";
}
