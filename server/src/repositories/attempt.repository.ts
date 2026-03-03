import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { getMongoDb } from "../utils/mongodb.js";

export const AttemptRepository = {
  async getAttempt(tenantId: string, studentId: string, attemptId: string) {
    const db = await getMongoDb();
    const data = await db.collection("student_attempts").findOne(
      { tenant_id: tenantId, student_id: studentId, id: attemptId },
      { projection: { _id: 0, id: 1, test_id: 1, status: 1, started_at: 1, submitted_at: 1, score: 1, answers: 1 } },
    );

    if (!data) {
      throw new AppError("ATTEMPT_NOT_FOUND", "Attempt not found", 404);
    }

    return data;
  },

  async createPendingAttempt(tenantId: string, studentId: string, testId: string) {
    const db = await getMongoDb();
    const now = new Date().toISOString();
    const id = randomUUID();

    await db.collection("student_attempts").insertOne({
      id,
      tenant_id: tenantId,
      student_id: studentId,
      test_id: testId,
      status: "pending",
      started_at: now,
      submitted_at: null,
      answers: [],
      score: 0,
      time_taken_sec: 0,
      topic_breakdown: {},
      idempotency_key: null,
      created_at: now,
    });

    return { id, started_at: now };
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
          status: "submitted",
          answers: params.answers,
          score: params.score,
          time_taken_sec: params.timeTakenSec,
          topic_breakdown: params.topicBreakdown,
          idempotency_key: params.idempotencyKey,
          submitted_at: now,
        },
      },
      { returnDocument: "after", projection: { _id: 0, id: 1, submitted_at: 1, score: 1 } },
    );

    if (!result) {
      throw new AppError("ATTEMPT_SUBMIT_FAILED", "Unable to submit attempt", 400);
    }

    return result;
  },
};
