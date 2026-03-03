import { AppError } from "../middleware/error-handler.js";
import { MockTestRepository } from "../repositories/mock-test.repository.js";
import {
  assertTimeWithinDuration,
  computeTimeTakenSec,
  parseQuestions,
  scoreSubmission,
} from "./mock-test-scoring.js";
import { PointsService } from "./points.service.js";
import { ReadinessService } from "./readiness.service.js";
import { StudentRepository } from "../repositories/student.repository.js";

interface ListTestsInput {
  tenantId: string;
  userId: string;
  role: "student" | "tpo" | "admin";
  topicId?: string;
  companyId?: string;
  difficulty?: "easy" | "medium" | "hard";
  limit: number;
  cursor?: string;
}

interface SubmitInput {
  tenantId: string;
  userId: string;
  attemptId: string;
  answers: Array<{ questionIndex: number; selectedOption: number }>;
  idempotencyKey: string;
}

export const MockTestService = {
  async listTests(input: ListTestsInput) {
    const listed = await MockTestRepository.listTests(input.tenantId, {
      topicId: input.topicId,
      companyId: input.companyId,
      difficulty: input.difficulty,
      limit: input.limit,
      cursor: input.cursor,
      includeInactive: input.role !== "student",
    });

    if (input.role !== "student") {
      return {
        items: listed.items.map((item) => ({
          ...item,
          attemptCount: 0,
        })),
        hasMore: listed.hasMore,
        nextCursor: listed.nextCursor,
      };
    }

    const student = await StudentRepository.getStudentByUserId(input.tenantId, input.userId);
    const attemptCounts = await MockTestRepository.countAttemptsByStudent(
      input.tenantId,
      String(student.id),
      listed.items.map((item) => item.id),
    );

    return {
      items: listed.items.map((item) => ({
        ...item,
        attemptCount: attemptCounts.get(item.id) ?? 0,
      })),
      hasMore: listed.hasMore,
      nextCursor: listed.nextCursor,
    };
  },

  async getTestMetadata(tenantId: string, testId: string) {
    const test = await MockTestRepository.getTestById(tenantId, testId);
    const questions = parseQuestions(test.questions);

    return {
      id: String(test.id),
      title: String(test.title),
      topicId: test.topic_id ? String(test.topic_id) : null,
      companyId: test.company_id ? String(test.company_id) : null,
      durationSec: Number(test.duration_sec ?? 0),
      difficulty: String(test.difficulty ?? "medium"),
      questionCount: questions.length,
    };
  },

  async createTest(
    tenantId: string,
    createdBy: string,
    input: {
      title: string;
      topicId?: string;
      companyId?: string;
      durationSec: number;
      difficulty: "easy" | "medium" | "hard";
      questions: Array<{
        text: string;
        options: string[];
        correctIndex: number;
        explanation?: string;
      }>;
      isActive: boolean;
    },
  ) {
    const created = await MockTestRepository.createTest(tenantId, createdBy, input);
    const questions = parseQuestions(created.questions);

    return {
      id: String(created.id),
      title: String(created.title),
      topicId: created.topic_id ? String(created.topic_id) : null,
      companyId: created.company_id ? String(created.company_id) : null,
      durationSec: Number(created.duration_sec ?? 0),
      difficulty: String(created.difficulty ?? "medium"),
      isActive: Boolean(created.is_active),
      questionCount: questions.length,
    };
  },

  async updateTest(
    tenantId: string,
    testId: string,
    input: Partial<{
      title: string;
      topicId: string;
      companyId: string;
      durationSec: number;
      difficulty: "easy" | "medium" | "hard";
      isActive: boolean;
    }>,
  ) {
    const updated = await MockTestRepository.updateTest(tenantId, testId, input);
    const questions = parseQuestions(updated.questions);

    return {
      id: String(updated.id),
      title: String(updated.title),
      topicId: updated.topic_id ? String(updated.topic_id) : null,
      companyId: updated.company_id ? String(updated.company_id) : null,
      durationSec: Number(updated.duration_sec ?? 0),
      difficulty: String(updated.difficulty ?? "medium"),
      isActive: Boolean(updated.is_active),
      questionCount: questions.length,
    };
  },

  async publishTest(tenantId: string, testId: string, isActive: boolean) {
    const updated = await MockTestRepository.setPublished(tenantId, testId, isActive);
    const questions = parseQuestions(updated.questions);

    return {
      id: String(updated.id),
      title: String(updated.title),
      isActive: Boolean(updated.is_active),
      questionCount: questions.length,
    };
  },

  async getQuestions(
    tenantId: string,
    testId: string,
    role: "student" | "tpo" | "admin",
  ) {
    const existing = await MockTestRepository.getQuestions(tenantId, testId);
    const questions = parseQuestions(existing.questions);

    if (role === "student") {
      return questions.map((question) => ({
        text: question.text,
        options: question.options,
      }));
    }

    return questions;
  },

  async upsertQuestions(
    tenantId: string,
    testId: string,
    input: {
      append: boolean;
      questions: Array<{
        text: string;
        options: string[];
        correctIndex: number;
        explanation?: string;
      }>;
    },
  ) {
    return MockTestRepository.upsertQuestions(tenantId, testId, input.questions, input.append);
  },

  async startAttempt(tenantId: string, userId: string, testId: string) {
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    const test = await MockTestRepository.getTestById(tenantId, testId);

    const existingPending = await MockTestRepository.getPendingAttempt(
      tenantId,
      String(student.id),
      String(test.id),
    );

    const attempt =
      existingPending ??
      (await MockTestRepository.createPendingAttempt(tenantId, String(student.id), String(test.id)));

    const questions = parseQuestions(test.questions).map((question) => ({
      text: question.text,
      options: question.options,
    }));

    return {
      attemptId: String(attempt.id),
      startedAt: String(attempt.started_at),
      serverTime: new Date().toISOString(),
      durationSec: Number(test.duration_sec ?? 0),
      questions,
    };
  },

  async submitAttempt(input: SubmitInput) {
    const student = await StudentRepository.getStudentByUserId(input.tenantId, input.userId);

    const existingAttempt = await MockTestRepository.findAttemptByIdempotency(
      input.tenantId,
      String(student.id),
      input.idempotencyKey,
    );

    if (existingAttempt) {
      return {
        attemptId: String(existingAttempt.id),
        score: Number(existingAttempt.score ?? 0),
        timeTakenSec: Number(existingAttempt.time_taken_sec ?? 0),
        topicBreakdown: existingAttempt.topic_breakdown,
        pointsAwarded: 0,
        readinessScore: Number(student.readiness_score ?? 0),
        idempotent: true,
      };
    }

    const attempt = await MockTestRepository.getAttemptById(
      input.tenantId,
      input.attemptId,
      String(student.id),
    );

    if (String(attempt.status) !== "pending") {
      throw new AppError("ATTEMPT_ALREADY_SUBMITTED", "Attempt already submitted", 409);
    }

    const test = await MockTestRepository.getTestById(input.tenantId, String(attempt.test_id));
    const questions = parseQuestions(test.questions);

    const { answersWithOutcome, correctCount, totalQuestions, score } = scoreSubmission(
      questions,
      input.answers,
    );
    const timeTakenSec = computeTimeTakenSec(String(attempt.started_at));
    const durationSec = Number(test.duration_sec ?? 0);
    assertTimeWithinDuration(timeTakenSec, durationSec);

    const topicId = test.topic_id ? String(test.topic_id) : "unknown";
    const topicBreakdown = {
      [topicId]: {
        correct: correctCount,
        total: totalQuestions,
      },
    };

    const submitted = await MockTestRepository.submitAttempt({
      tenantId: input.tenantId,
      studentId: String(student.id),
      attemptId: input.attemptId,
      answers: answersWithOutcome,
      score,
      timeTakenSec,
      topicBreakdown,
      idempotencyKey: input.idempotencyKey,
    });

    if (test.topic_id) {
      await MockTestRepository.upsertTopicMastery({
        tenantId: input.tenantId,
        studentId: String(student.id),
        topicId: String(test.topic_id),
        totalQuestions,
        correctAnswers: correctCount,
      });
    }

    const pointsAwarded = await PointsService.awardTestCompletionPoints({
      tenantId: input.tenantId,
      studentId: String(student.id),
      scorePercent: score,
    });

    const readinessScore = await ReadinessService.calculate(input.tenantId, String(student.id));

    return {
      attemptId: String(submitted.id),
      score,
      timeTakenSec,
      topicBreakdown,
      pointsAwarded,
      readinessScore,
      idempotent: false,
    };
  },

  async getAttemptResult(tenantId: string, userId: string, attemptId: string) {
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    const attempt = await MockTestRepository.getAttemptById(tenantId, attemptId, String(student.id));
    const test = await MockTestRepository.getTestById(tenantId, String(attempt.test_id));
    const questions = parseQuestions(test.questions);
    const answers = Array.isArray(attempt.answers) ? attempt.answers : [];

    return {
      attemptId: String(attempt.id),
      testId: String(attempt.test_id),
      title: String(test.title),
      score: Number(attempt.score ?? 0),
      timeTakenSec: Number(attempt.time_taken_sec ?? 0),
      topicBreakdown: attempt.topic_breakdown ?? {},
      submittedAt: attempt.submitted_at ? String(attempt.submitted_at) : null,
      answers,
      questions: questions.map((question) => ({
        text: question.text,
        options: question.options,
        correctIndex: question.correctIndex,
        explanation: question.explanation ?? "",
      })),
    };
  },
};
