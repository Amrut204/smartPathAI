import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { getMongoDb } from "../utils/mongodb.js";
import type {
  StudyGuideCategory,
  StudyGuideCostLogEntry,
  StudyGuideDifficulty,
  StudyGuideDocument,
  StudyGuidePracticeQuestion,
  StudyGuideSection,
  StudyGuideStatus,
} from "../models/StudyGuide.js";
import {
  STUDY_GUIDE_COLLECTION,
  STUDY_GUIDE_COST_LOG_COLLECTION,
  STUDY_GUIDE_TOPIC_COLLECTION,
} from "../models/StudyGuide.js";

let indexesEnsured = false;

function buildTenantVisibilityFilter(tenantId: string | null | undefined) {
  if (tenantId === undefined) {
    return null;
  }

  return {
    $or: [{ tenant_id: tenantId }, { tenant_id: null }],
  };
}

interface ListFilters {
  category?: StudyGuideCategory;
  difficulty?: StudyGuideDifficulty;
  search?: string;
  status?: StudyGuideStatus;
  tenantId?: string | null;
  limit: number;
  cursor?: string;
}

interface CreateGuideInput {
  tenantId: string | null;
  topicName: string;
  title: string;
  slug: string;
  category: StudyGuideCategory;
  subcategory: string;
  difficulty: StudyGuideDifficulty;
  summary: string;
  markdownContent: string;
  sections: StudyGuideSection[];
  keyConcepts: string[];
  practiceQuestions: StudyGuidePracticeQuestion[];
  placementTips: string[];
  estimatedReadMinutes: number;
  wordCount: number;
  aiProvider: string;
  aiModel: string;
  generationPromptHash: string;
  generationCostEstimateUsd: number;
  createdBy: string;
}

export const StudyGuideRepository = {
  async ensureIndexes() {
    if (indexesEnsured) return;
    const db = await getMongoDb();

    await Promise.all([
      db.collection(STUDY_GUIDE_COLLECTION).createIndex({ slug: 1 }, { unique: true }),
      db.collection(STUDY_GUIDE_COLLECTION).createIndex({ category: 1, status: 1, created_at: -1 }),
      db.collection(STUDY_GUIDE_COLLECTION).createIndex({ tenant_id: 1, status: 1 }),
      db.collection(STUDY_GUIDE_COLLECTION).createIndex({ status: 1, quality_score: -1 }),
      db.collection(STUDY_GUIDE_TOPIC_COLLECTION).createIndex({ category: 1 }),
      db.collection(STUDY_GUIDE_TOPIC_COLLECTION).createIndex({ name: 1 }, { unique: true }),
      db.collection(STUDY_GUIDE_COST_LOG_COLLECTION).createIndex({ created_at: -1 }),
      db.collection(STUDY_GUIDE_COST_LOG_COLLECTION).createIndex({ guide_id: 1 }),
    ]);

    indexesEnsured = true;
  },

  async listGuides(filters: ListFilters) {
    await this.ensureIndexes();
    const db = await getMongoDb();

    const clauses: Record<string, unknown>[] = [];

    clauses.push({ status: filters.status ?? "published" });

    const tenantVisibility = buildTenantVisibilityFilter(filters.tenantId);
    if (tenantVisibility) clauses.push(tenantVisibility);
    if (filters.category) clauses.push({ category: filters.category });
    if (filters.difficulty) clauses.push({ difficulty: filters.difficulty });
    if (filters.cursor) clauses.push({ created_at: { $lt: filters.cursor } });
    if (filters.search) {
      clauses.push({
        $or: [
          { topic_name: { $regex: filters.search, $options: "i" } },
          { title: { $regex: filters.search, $options: "i" } },
          { key_concepts: { $regex: filters.search, $options: "i" } },
        ],
      });
    }

    const query = clauses.length === 1 ? clauses[0] : { $and: clauses };

    const data = await db.collection(STUDY_GUIDE_COLLECTION).find(
      query,
      {
        projection: {
          _id: 0, id: 1, topic_name: 1, title: 1, slug: 1, category: 1, subcategory: 1,
          difficulty: 1, status: 1, summary: 1, key_concepts: 1, estimated_read_minutes: 1,
          word_count: 1, quality_score: 1, created_at: 1, published_at: 1,
        },
      },
    ).sort({ created_at: -1 }).limit(filters.limit + 1).toArray();

    const hasMore = data.length > filters.limit;
    const items = hasMore ? data.slice(0, filters.limit) : data;

    return {
      items: items.map((row) => ({
        id: String(row.id),
        topicName: String(row.topic_name ?? ""),
        title: String(row.title ?? ""),
        slug: String(row.slug ?? ""),
        category: String(row.category ?? ""),
        subcategory: String(row.subcategory ?? ""),
        difficulty: String(row.difficulty ?? "intermediate"),
        status: String(row.status ?? "draft"),
        summary: String(row.summary ?? ""),
        keyConcepts: Array.isArray(row.key_concepts) ? row.key_concepts.map(String) : [],
        estimatedReadMinutes: Number(row.estimated_read_minutes ?? 0),
        wordCount: Number(row.word_count ?? 0),
        qualityScore: row.quality_score != null ? Number(row.quality_score) : null,
        createdAt: String(row.created_at ?? ""),
        publishedAt: row.published_at ? String(row.published_at) : null,
      })),
      hasMore,
      nextCursor: hasMore ? String(items[items.length - 1]?.created_at) : null,
    };
  },

  async getGuideById(guideId: string, tenantId?: string | null) {
    await this.ensureIndexes();
    const db = await getMongoDb();
    const clauses: Record<string, unknown>[] = [{ id: guideId }];
    const tenantVisibility = buildTenantVisibilityFilter(tenantId);
    if (tenantVisibility) clauses.push(tenantVisibility);

    const data = await db.collection(STUDY_GUIDE_COLLECTION).findOne(
      clauses.length === 1 ? clauses[0] : { $and: clauses },
      { projection: { _id: 0 } },
    );

    if (!data) {
      throw new AppError("STUDY_GUIDE_NOT_FOUND", "Study guide not found", 404);
    }

    return data as unknown as StudyGuideDocument;
  },

  async getGuideBySlug(slug: string, tenantId?: string | null) {
    await this.ensureIndexes();
    const db = await getMongoDb();
    const clauses: Record<string, unknown>[] = [{ slug }];
    const tenantVisibility = buildTenantVisibilityFilter(tenantId);
    if (tenantVisibility) clauses.push(tenantVisibility);

    const data = await db.collection(STUDY_GUIDE_COLLECTION).findOne(
      clauses.length === 1 ? clauses[0] : { $and: clauses },
      { projection: { _id: 0 } },
    );

    if (!data) {
      throw new AppError("STUDY_GUIDE_NOT_FOUND", "Study guide not found", 404);
    }

    return data as unknown as StudyGuideDocument;
  },

  async createGuide(input: CreateGuideInput): Promise<StudyGuideDocument> {
    await this.ensureIndexes();
    const db = await getMongoDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    const slug = await this.generateUniqueSlug(input.slug);

    const doc: StudyGuideDocument = {
      id,
      tenant_id: input.tenantId,
      topic_name: input.topicName,
      title: input.title,
      slug,
      category: input.category,
      subcategory: input.subcategory,
      difficulty: input.difficulty,
      status: "review",
      summary: input.summary,
      markdown_content: input.markdownContent,
      sections: input.sections,
      key_concepts: input.keyConcepts,
      practice_questions: input.practiceQuestions,
      placement_tips: input.placementTips,
      estimated_read_minutes: input.estimatedReadMinutes,
      word_count: input.wordCount,
      version: 1,
      ai_provider: input.aiProvider,
      ai_model: input.aiModel,
      generation_prompt_hash: input.generationPromptHash,
      generation_cost_estimate_usd: input.generationCostEstimateUsd,
      quality_score: null,
      review_notes: null,
      reviewed_by: null,
      reviewed_at: null,
      created_by: input.createdBy,
      created_at: now,
      updated_at: now,
      published_at: null,
    };

    await db.collection(STUDY_GUIDE_COLLECTION).insertOne(doc as unknown as Record<string, unknown>);
    return doc;
  },

  async generateUniqueSlug(baseSlug: string) {
    await this.ensureIndexes();
    const db = await getMongoDb();
    const normalizedBase = baseSlug.trim() || "study-guide";
    let candidate = normalizedBase;
    let suffix = 2;

    while (true) {
      const exists = await db.collection(STUDY_GUIDE_COLLECTION).findOne(
        { slug: candidate },
        { projection: { _id: 1 } },
      );

      if (!exists) {
        return candidate;
      }

      candidate = `${normalizedBase}-${suffix}`;
      suffix += 1;
    }
  },

  async updateGuideStatus(
    guideId: string,
    status: StudyGuideStatus,
    reviewData?: { qualityScore: number; reviewNotes?: string; reviewedBy: string },
  ) {
    await this.ensureIndexes();
    const db = await getMongoDb();
    const now = new Date().toISOString();

    const payload: Record<string, unknown> = {
      status,
      updated_at: now,
    };

    if (status === "published") {
      payload.published_at = now;
    }

    if (reviewData) {
      payload.quality_score = reviewData.qualityScore;
      payload.review_notes = reviewData.reviewNotes ?? null;
      payload.reviewed_by = reviewData.reviewedBy;
      payload.reviewed_at = now;
    }

    const result = await db.collection(STUDY_GUIDE_COLLECTION).updateOne(
      { id: guideId },
      { $set: payload },
    );

    if (result.matchedCount === 0) {
      throw new AppError("STUDY_GUIDE_NOT_FOUND", "Study guide not found", 404);
    }

    return this.getGuideById(guideId);
  },

  async countByCategory(tenantId: string | null) {
    await this.ensureIndexes();
    const db = await getMongoDb();

    const matchFilter: Record<string, unknown> = { status: "published" };
    if (tenantId) {
      matchFilter.$or = [{ tenant_id: tenantId }, { tenant_id: null }];
    }

    const data = await db.collection(STUDY_GUIDE_COLLECTION).aggregate([
      { $match: matchFilter },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray();

    return data.map((row) => ({
      category: String(row._id),
      count: Number(row.count),
    }));
  },

  async logCost(entry: Omit<StudyGuideCostLogEntry, "id" | "created_at">) {
    const db = await getMongoDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    await db.collection(STUDY_GUIDE_COST_LOG_COLLECTION).insertOne({
      id,
      ...entry,
      created_at: now,
    });
  },

  async getCostSummary(since?: string) {
    const db = await getMongoDb();
    const matchFilter: Record<string, unknown> = {};
    if (since) {
      matchFilter.created_at = { $gte: since };
    }

    const data = await db.collection(STUDY_GUIDE_COST_LOG_COLLECTION).aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: { provider: "$provider", model: "$model" },
          totalInputTokens: { $sum: "$input_tokens" },
          totalOutputTokens: { $sum: "$output_tokens" },
          totalCostUsd: { $sum: "$estimated_cost_usd" },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalCostUsd: -1 } },
    ]).toArray();

    const totalCostUsd = data.reduce((sum, row) => sum + Number(row.totalCostUsd), 0);
    const totalGuides = data.reduce((sum, row) => sum + Number(row.count), 0);

    return {
      byProvider: data.map((row) => ({
        provider: String(row._id.provider),
        model: String(row._id.model),
        totalInputTokens: Number(row.totalInputTokens),
        totalOutputTokens: Number(row.totalOutputTokens),
        totalCostUsd: Number(row.totalCostUsd),
        count: Number(row.count),
      })),
      totalCostUsd,
      totalGuides,
      avgCostPerGuide: totalGuides > 0 ? totalCostUsd / totalGuides : 0,
    };
  },

  async getTopics(category?: StudyGuideCategory) {
    const db = await getMongoDb();
    const filter: Record<string, unknown> = {};
    if (category) filter.category = category;

    return db.collection(STUDY_GUIDE_TOPIC_COLLECTION).find(
      filter,
      { projection: { _id: 0 } },
    ).sort({ priority: 1, name: 1 }).toArray();
  },

  async deleteGuide(guideId: string) {
    const db = await getMongoDb();
    const result = await db.collection(STUDY_GUIDE_COLLECTION).deleteOne({ id: guideId });
    if (result.deletedCount === 0) {
      throw new AppError("STUDY_GUIDE_NOT_FOUND", "Study guide not found", 404);
    }
  },
};
