import { AppError } from "../middleware/error-handler.js";

export interface ParsedQuestion {
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string | undefined;
  skillTag: string | undefined;
}

const MAX_QUESTION_TEXT_LENGTH = 420;
const MAX_OPTION_TEXT_LENGTH = 180;
const MAX_EXPLANATION_LENGTH = 1500;
const MAX_SKILL_TAG_LENGTH = 160;

function normalizeInlineText(value: unknown, maxLength: number): string {
  const compact = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }

  if (compact.length <= maxLength) {
    return compact;
  }

  const truncatedLength = Math.max(1, maxLength - 3);
  return `${compact.slice(0, truncatedLength).trimEnd()}...`;
}

function normalizeOptions(rawOptions: unknown): string[] {
  if (!Array.isArray(rawOptions)) {
    return [];
  }

  const seen = new Set<string>();
  const options: string[] = [];

  for (const option of rawOptions) {
    const normalized = normalizeInlineText(option, MAX_OPTION_TEXT_LENGTH);
    if (!normalized) {
      continue;
    }

    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    options.push(normalized);
  }

  return options;
}

function shuffle(items: number[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

export function parseQuestions(raw: unknown): ParsedQuestion[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((question) => {
      if (!question || typeof question !== "object") {
        return null;
      }

      const q = question as Record<string, unknown>;
      const text = normalizeInlineText(q.text, MAX_QUESTION_TEXT_LENGTH);
      const options = normalizeOptions(q.options);

      if (!text || options.length < 2) {
        return null;
      }

      const parsedCorrectIndex = Number(q.correctIndex ?? -1);
      const correctIndex = Number.isInteger(parsedCorrectIndex)
        && parsedCorrectIndex >= 0
        && parsedCorrectIndex < options.length
        ? parsedCorrectIndex
        : 0;

      const explanationText = normalizeInlineText(q.explanation, MAX_EXPLANATION_LENGTH);
      const skillTagText = normalizeInlineText(q.skillTag, MAX_SKILL_TAG_LENGTH);

      return {
        text,
        options,
        correctIndex,
        explanation: explanationText || undefined,
        skillTag: skillTagText || undefined,
      };
    })
    .filter((question): question is ParsedQuestion => question !== null);
}

export function randomizeQuestionsForAttempt(questions: ParsedQuestion[]): ParsedQuestion[] {
  const questionOrder = shuffle(questions.map((_, index) => index));

  return questionOrder.map((questionIndex) => {
    const question = questions[questionIndex];
    const optionOrder = shuffle(question.options.map((_, index) => index));
    const randomizedOptions = optionOrder.map((optionIndex) => question.options[optionIndex]);
    const randomizedCorrectIndex = optionOrder.findIndex((optionIndex) => optionIndex === question.correctIndex);

    return {
      text: question.text,
      options: randomizedOptions,
      correctIndex: randomizedCorrectIndex >= 0 ? randomizedCorrectIndex : question.correctIndex,
      explanation: question.explanation,
      skillTag: question.skillTag,
    };
  });
}

export function scoreSubmission(
  questions: ParsedQuestion[],
  answers: Array<{ questionIndex: number; selectedOption: number }>,
) {
  const answersWithOutcome = answers.map((answer) => {
    const question = questions[answer.questionIndex];
    const isCorrect = Boolean(question) && answer.selectedOption === question.correctIndex;

    return {
      questionIndex: answer.questionIndex,
      selectedOption: answer.selectedOption,
      isCorrect,
    };
  });

  const correctCount = answersWithOutcome.filter((answer) => answer.isCorrect).length;
  const totalQuestions = Math.max(questions.length, 1);
  const score = Number(((correctCount / totalQuestions) * 100).toFixed(2));

  return {
    answersWithOutcome,
    correctCount,
    totalQuestions,
    score,
  };
}

export function computeTimeTakenSec(startedAtIso: string, now = new Date()): number {
  const startedAt = new Date(startedAtIso);
  return Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000));
}

export function assertTimeWithinDuration(timeTakenSec: number, durationSec: number): void {
  if (durationSec > 0 && timeTakenSec > durationSec + 5) {
    throw new AppError("TIME_VALIDATION_FAILED", "Submission exceeded allowed duration", 400);
  }
}
