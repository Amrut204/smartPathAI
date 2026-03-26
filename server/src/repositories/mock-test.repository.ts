import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { getMongoDb } from "../utils/mongodb.js";

interface ListFilters {
  topicId?: string;
  companyId?: string;
  difficulty?: "easy" | "medium" | "hard";
  limit: number;
  cursor?: string;
  includeInactive?: boolean;
  minQuestionCount?: number;
}

function buildMinimumQuestionFilter(minQuestionCount?: number) {
  if (!minQuestionCount || minQuestionCount <= 0) {
    return {};
  }

  return {
    $expr: {
      $gte: [
        { $size: { $ifNull: ["$questions", []] } },
        minQuestionCount,
      ],
    },
  };
}

export const MockTestRepository = {
  async listTests(tenantId: string, filters: ListFilters) {
    const db = await getMongoDb();

    const filter: Record<string, unknown> = {};

    if (filters.includeInactive) {
      filter.tenant_id = tenantId;
    } else {
      filter.is_active = true;
      filter.$or = [{ tenant_id: tenantId }, { tenant_id: null }];
    }

    if (filters.cursor) {
      filter.created_at = { $lt: filters.cursor };
    }
    if (filters.topicId) filter.topic_id = filters.topicId;
    if (filters.companyId) filter.company_id = filters.companyId;
    if (filters.difficulty) filter.difficulty = filters.difficulty;
    Object.assign(filter, buildMinimumQuestionFilter(filters.minQuestionCount));

    const data = await db.collection("mock_tests").find(
      filter,
      { projection: { _id: 0, id: 1, title: 1, topic_id: 1, company_id: 1, duration_sec: 1, difficulty: 1, is_active: 1, created_at: 1 } },
    ).sort({ created_at: -1 }).limit(filters.limit + 1).toArray();

    const hasMore = data.length > filters.limit;
    const items = hasMore ? data.slice(0, filters.limit) : data;

    return {
      items: items.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        topicId: row.topic_id ? String(row.topic_id) : null,
        companyId: row.company_id ? String(row.company_id) : null,
        durationSec: Number(row.duration_sec ?? 0),
        difficulty: String(row.difficulty ?? "medium"),
        isActive: Boolean(row.is_active),
      })),
      hasMore,
      nextCursor: hasMore ? String(items[items.length - 1]?.created_at) : null,
    };
  },

  async getTestById(tenantId: string, testId: string, options?: { includeInactive?: boolean; minQuestionCount?: number }) {
    const db = await getMongoDb();
    const filter: Record<string, unknown> = {
      id: testId,
      $or: [{ tenant_id: tenantId }, { tenant_id: null }],
      ...buildMinimumQuestionFilter(options?.minQuestionCount),
    };

    if (!options?.includeInactive) {
      filter.is_active = true;
    }

    const data = await db.collection("mock_tests").findOne(
      filter,
      { projection: { _id: 0, id: 1, title: 1, topic_id: 1, company_id: 1, questions: 1, duration_sec: 1, difficulty: 1, is_active: 1 } },
    );

    if (!data) {
      throw new AppError("TEST_NOT_FOUND", "Mock test not found", 404);
    }

    return data;
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
      questions: unknown[];
      isActive: boolean;
    },
  ) {
    const db = await getMongoDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    await db.collection("mock_tests").insertOne({
      id,
      tenant_id: tenantId,
      created_by: createdBy,
      title: input.title,
      topic_id: input.topicId ?? null,
      company_id: input.companyId ?? null,
      duration_sec: input.durationSec,
      difficulty: input.difficulty,
      questions: input.questions,
      is_active: input.isActive,
      created_at: now,
      updated_at: now,
    });

    return this.getTestById(tenantId, id, { includeInactive: true });
  },

  async updateTest(
    tenantId: string,
    testId: string,
    updates: Partial<{
      title: string;
      topicId: string;
      companyId: string;
      durationSec: number;
      difficulty: "easy" | "medium" | "hard";
      isActive: boolean;
    }>,
  ) {
    const db = await getMongoDb();
    const payload: Record<string, unknown> = {};
    if (updates.title !== undefined) payload.title = updates.title;
    if (updates.topicId !== undefined) payload.topic_id = updates.topicId;
    if (updates.companyId !== undefined) payload.company_id = updates.companyId;
    if (updates.durationSec !== undefined) payload.duration_sec = updates.durationSec;
    if (updates.difficulty !== undefined) payload.difficulty = updates.difficulty;
    if (updates.isActive !== undefined) payload.is_active = updates.isActive;
    payload.updated_at = new Date().toISOString();

    const result = await db.collection("mock_tests").updateOne(
      { tenant_id: tenantId, id: testId },
      { $set: payload },
    );

    if (result.matchedCount === 0) {
      throw new AppError("TEST_UPDATE_FAILED", "Test not found", 500);
    }

    return this.getTestById(tenantId, testId, { includeInactive: true });
  },

  async setPublished(tenantId: string, testId: string, isActive: boolean) {
    const db = await getMongoDb();
    const result = await db.collection("mock_tests").updateOne(
      { tenant_id: tenantId, id: testId },
      { $set: { is_active: isActive, updated_at: new Date().toISOString() } },
    );

    if (result.matchedCount === 0) {
      throw new AppError("TEST_PUBLISH_FAILED", "Test not found", 500);
    }

    return this.getTestById(tenantId, testId, { includeInactive: true });
  },

  async getQuestions(tenantId: string, testId: string) {
    const db = await getMongoDb();
    const data = await db.collection("mock_tests").findOne(
      { id: testId, $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
      { projection: { _id: 0, id: 1, questions: 1 } },
    );

    if (!data) {
      throw new AppError("TEST_NOT_FOUND", "Mock test not found", 404);
    }

    return {
      id: String(data.id),
      questions: Array.isArray(data.questions) ? data.questions : [],
    };
  },

  async upsertQuestions(tenantId: string, testId: string, questions: unknown[], append = true) {
    const existing = await this.getQuestions(tenantId, testId);
    const nextQuestions = append ? [...existing.questions, ...questions] : [...questions];

    const db = await getMongoDb();
    const result = await db.collection("mock_tests").updateOne(
      { tenant_id: tenantId, id: testId },
      { $set: { questions: nextQuestions, updated_at: new Date().toISOString() } },
    );

    if (result.matchedCount === 0) {
      throw new AppError("TEST_QUESTIONS_UPDATE_FAILED", "Test not found", 500);
    }

    return { testId, questionCount: nextQuestions.length };
  },

  async getAttemptById(tenantId: string, attemptId: string, studentId: string) {
    const db = await getMongoDb();
    const data = await db.collection("student_attempts").findOne(
      { tenant_id: tenantId, student_id: studentId, id: attemptId },
      { projection: { _id: 0, id: 1, test_id: 1, answers: 1, score: 1, time_taken_sec: 1, topic_breakdown: 1, status: 1, started_at: 1, submitted_at: 1, questions_snapshot: 1, integrity_summary: 1 } },
    );

    if (!data) {
      throw new AppError("ATTEMPT_NOT_FOUND", "Attempt not found", 404);
    }

    return data;
  },

  async getPendingAttempt(tenantId: string, studentId: string, testId: string) {
    const db = await getMongoDb();
    return db.collection("student_attempts").findOne(
      { tenant_id: tenantId, student_id: studentId, test_id: testId, status: "pending" },
      {
        projection: { _id: 0, id: 1, started_at: 1, questions_snapshot: 1 },
        sort: { started_at: -1 },
      },
    );
  },

  async createPendingAttempt(tenantId: string, studentId: string, testId: string, questionsSnapshot: unknown[]) {
    const db = await getMongoDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    await db.collection("student_attempts").insertOne({
      id,
      tenant_id: tenantId,
      student_id: studentId,
      test_id: testId,
      status: "pending",
      started_at: now,
      submitted_at: null,
      answers: [],
      questions_snapshot: questionsSnapshot,
      score: 0,
      time_taken_sec: 0,
      topic_breakdown: {},
      integrity_summary: null,
      idempotency_key: null,
      created_at: now,
    });

    return { id, started_at: now };
  },

  async expirePendingAttempt(tenantId: string, studentId: string, attemptId: string, durationSec: number) {
    const db = await getMongoDb();
    const now = new Date().toISOString();

    await db.collection("student_attempts").updateOne(
      {
        tenant_id: tenantId,
        student_id: studentId,
        id: attemptId,
        status: "pending",
      },
      {
        $set: {
          status: "expired",
          submitted_at: now,
          time_taken_sec: Math.max(0, Math.round(durationSec)),
          updated_at: now,
        },
      },
    );
  },

  async submitAttempt(params: {
    tenantId: string;
    studentId: string;
    attemptId: string;
    answers: unknown[];
    score: number;
    timeTakenSec: number;
    topicBreakdown: Record<string, unknown>;
    idempotencyKey: string;
    integritySummary?: Record<string, unknown> | null;
  }) {
    const db = await getMongoDb();
    const now = new Date().toISOString();

    const result = await db.collection("student_attempts").findOneAndUpdate(
      {
        tenant_id: params.tenantId,
        student_id: params.studentId,
        id: params.attemptId,
        status: "pending",
      },
      {
        $set: {
          answers: params.answers,
          score: params.score,
          time_taken_sec: params.timeTakenSec,
          topic_breakdown: params.topicBreakdown,
          idempotency_key: params.idempotencyKey,
          integrity_summary: params.integritySummary ?? null,
          status: "submitted",
          submitted_at: now,
        },
      },
      { returnDocument: "after", projection: { _id: 0, id: 1, score: 1, time_taken_sec: 1, topic_breakdown: 1, submitted_at: 1 } },
    );

    if (!result) {
      throw new AppError("ATTEMPT_SUBMIT_FAILED", "Submit failed", 400);
    }

    return result;
  },

  async findAttemptByIdempotency(tenantId: string, studentId: string, idempotencyKey: string) {
    const db = await getMongoDb();
    return db.collection("student_attempts").findOne(
      { tenant_id: tenantId, student_id: studentId, idempotency_key: idempotencyKey },
      { projection: { _id: 0, id: 1, score: 1, time_taken_sec: 1, topic_breakdown: 1, submitted_at: 1 } },
    );
  },

  async countAttemptsByStudent(tenantId: string, studentId: string, testIds: string[]) {
    if (testIds.length === 0) {
      return new Map<string, number>();
    }

    const db = await getMongoDb();
    const data = await db.collection("student_attempts").find(
      { tenant_id: tenantId, student_id: studentId, status: "submitted", test_id: { $in: testIds } },
      { projection: { test_id: 1 } },
    ).toArray();

    const counts = new Map<string, number>();
    data.forEach((row) => {
      const key = String(row.test_id);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });

    return counts;
  },

  async upsertTopicMastery(params: {
    tenantId: string;
    studentId: string;
    topicId: string;
    totalQuestions: number;
    correctAnswers: number;
  }) {
    const db = await getMongoDb();
    const existing = await db.collection("topic_mastery").findOne(
      { tenant_id: params.tenantId, student_id: params.studentId, topic_id: params.topicId },
      { projection: { id: 1, total_attempts: 1, correct_attempts: 1 } },
    );

    const nextTotal = Number(existing?.total_attempts ?? 0) + params.totalQuestions;
    const nextCorrect = Number(existing?.correct_attempts ?? 0) + params.correctAnswers;
    const mastery = nextTotal > 0 ? Number(((nextCorrect / nextTotal) * 100).toFixed(2)) : 0;
    const now = new Date().toISOString();

    if (!existing) {
      await db.collection("topic_mastery").insertOne({
        id: randomUUID(),
        tenant_id: params.tenantId,
        student_id: params.studentId,
        topic_id: params.topicId,
        mastery_level: mastery,
        total_attempts: nextTotal,
        correct_attempts: nextCorrect,
        last_assessed: now,
        confidence_score: Math.min(100, nextTotal * 5),
      });
      return;
    }

    await db.collection("topic_mastery").updateOne(
      { id: String(existing.id) },
      {
        $set: {
          total_attempts: nextTotal,
          correct_attempts: nextCorrect,
          mastery_level: mastery,
          last_assessed: now,
          confidence_score: Math.min(100, nextTotal * 5),
        },
      },
    );
  },
};
