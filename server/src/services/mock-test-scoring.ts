import { AppError } from "../middleware/error-handler.js";

export interface ParsedQuestion {
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string | undefined;
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
      if (!Array.isArray(q.options)) {
        return null;
      }

      return {
        text: String(q.text ?? ""),
        options: q.options.map((option) => String(option)),
        correctIndex: Number(q.correctIndex ?? -1),
        explanation: q.explanation ? String(q.explanation) : undefined,
      };
    })
    .filter((question): question is ParsedQuestion => question !== null);
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
