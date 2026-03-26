import { AppError } from "../middleware/error-handler.js";
import { getMongoDb } from "../utils/mongodb.js";

const COLLECTION = "question_bank_items";

type ListQuestionBankInput = {
  status?: "draft" | "reviewed" | "approved" | "rejected";
  llmSource?: string;
  topic?: string;
  search?: string;
  duplicatesOnly?: boolean;
  flaggedOnly?: boolean;
  limit: number;
};

type ReviewQuestionBankInput = {
  status?: "draft" | "reviewed" | "approved" | "rejected";
  qualityScore?: number;
  reviewNotes?: string | null;
  flaggedForMocks?: boolean;
};

function toNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mapQuestion(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    questionText: String(row.question_text ?? ""),
    options: Array.isArray(row.options) ? row.options.map((option) => String(option)) : [],
    correctAnswer: String(row.correct_answer ?? ""),
    explanation: String(row.explanation ?? ""),
    topic: String(row.topic ?? ""),
    subject: String(row.subject ?? ""),
    category: String(row.category ?? ""),
    difficulty: String(row.difficulty ?? "medium"),
    subtopic: row.subtopic ? String(row.subtopic) : null,
    tags: Array.isArray(row.tags) ? row.tags.map((tag) => String(tag)) : [],
    llmSource: String(row.llm_source ?? "unknown"),
    providerModel: row.provider_model ? String(row.provider_model) : null,
    generatedAt: row.generated_at ? String(row.generated_at) : null,
    generationCostInr: toNumber(row.generation_cost_inr, 0),
    estimatedTime: toNumber(row.estimated_time, 60),
    usageCount: toNumber(row.usage_count, 0),
    qualityScore: row.quality_score == null ? null : toNumber(row.quality_score, 0),
    status: String(row.status ?? "draft"),
    validated: Boolean(row.validated),
    validationErrors: Array.isArray(row.validation_errors)
      ? row.validation_errors.map((entry) => String(entry))
      : [],
    isDuplicate: Boolean(row.is_duplicate),
    duplicateOf: row.duplicate_of ? String(row.duplicate_of) : null,
    duplicateType: row.duplicate_type ? String(row.duplicate_type) : null,
    duplicateSimilarity: row.duplicate_similarity == null ? null : toNumber(row.duplicate_similarity, 0),
    flaggedForMocks: Boolean(row.flagged_for_mocks),
    reviewNotes: row.review_notes ? String(row.review_notes) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

export const QuestionBankService = {
  async list(input: ListQuestionBankInput) {
    const db = await getMongoDb();
    const filter: Record<string, unknown> = {};

    if (input.status) filter.status = input.status;
    if (input.llmSource) filter.llm_source = input.llmSource;
    if (input.topic) filter.topic = input.topic;
    if (input.duplicatesOnly) filter.is_duplicate = true;
    if (input.flaggedOnly) filter.flagged_for_mocks = true;
    if (input.search) {
      const regex = { $regex: input.search, $options: "i" };
      filter.$or = [
        { question_text: regex },
        { explanation: regex },
        { topic: regex },
        { subtopic: regex },
        { tags: regex },
      ];
    }

    const rows = await db.collection(COLLECTION).find(
      filter,
      { projection: { _id: 0 } },
    ).sort({ status: 1, quality_score: -1, updated_at: -1 }).limit(input.limit).toArray();

    return {
      items: rows.map((row) => mapQuestion(row as Record<string, unknown>)),
      total: rows.length,
    };
  },

  async getById(id: string) {
    const db = await getMongoDb();
    const row = await db.collection(COLLECTION).findOne(
      { id },
      { projection: { _id: 0 } },
    );

    if (!row) {
      throw new AppError("QUESTION_BANK_NOT_FOUND", "Question bank item not found", 404);
    }

    return mapQuestion(row as Record<string, unknown>);
  },

  async review(id: string, userId: string, input: ReviewQuestionBankInput) {
    const db = await getMongoDb();
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      updated_at: now,
      reviewed_at: now,
      reviewed_by: userId,
    };

    if (input.status !== undefined) payload.status = input.status;
    if (input.qualityScore !== undefined) payload.quality_score = input.qualityScore;
    if (input.reviewNotes !== undefined) payload.review_notes = input.reviewNotes || null;
    if (input.flaggedForMocks !== undefined) payload.flagged_for_mocks = input.flaggedForMocks;

    const result = await db.collection(COLLECTION).findOneAndUpdate(
      { id },
      { $set: payload },
      { returnDocument: "after", projection: { _id: 0 } },
    );

    if (!result) {
      throw new AppError("QUESTION_BANK_NOT_FOUND", "Question bank item not found", 404);
    }

    return mapQuestion(result as Record<string, unknown>);
  },

  async getStats() {
    const db = await getMongoDb();
    const rows = await db.collection(COLLECTION).find(
      {},
      {
        projection: {
          _id: 0,
          status: 1,
          llm_source: 1,
          topic: 1,
          quality_score: 1,
          is_duplicate: 1,
          flagged_for_mocks: 1,
        },
      },
    ).toArray();

    const byStatus = {
      draft: 0,
      reviewed: 0,
      approved: 0,
      rejected: 0,
    };
    const bySource: Record<string, number> = {};
    const byTopic: Record<string, number> = {};
    let duplicateCount = 0;
    let flaggedCount = 0;
    let qualityTotal = 0;
    let qualityCount = 0;

    rows.forEach((row) => {
      const status = String(row.status ?? "draft") as keyof typeof byStatus;
      if (status in byStatus) byStatus[status] += 1;

      const source = String(row.llm_source ?? "unknown");
      bySource[source] = (bySource[source] ?? 0) + 1;

      const topic = String(row.topic ?? "unknown");
      byTopic[topic] = (byTopic[topic] ?? 0) + 1;

      if (row.is_duplicate) duplicateCount += 1;
      if (row.flagged_for_mocks) flaggedCount += 1;
      if (typeof row.quality_score === "number") {
        qualityTotal += row.quality_score;
        qualityCount += 1;
      }
    });

    return {
      total: rows.length,
      byStatus,
      bySource,
      byTopic,
      duplicateCount,
      flaggedCount,
      averageQualityScore: qualityCount > 0 ? Number((qualityTotal / qualityCount).toFixed(1)) : 0,
    };
  },
};
