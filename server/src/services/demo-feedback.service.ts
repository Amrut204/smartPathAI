import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import {
  DEMO_FEEDBACK_COLLECTION,
  DEMO_FEEDBACK_STATUSES,
  type DemoFeedbackDocument,
} from "../models/DemoFeedback.js";
import { getMongoDb } from "../utils/mongodb.js";

type CreateDemoFeedbackInput = {
  collegeName: string;
  tpoName: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  demoDate?: string | null;
  demoRating?: number | null;
  productFit?: number | null;
  conversionLikelihood?: number | null;
  painPoints?: string[];
  featureRequests?: string[];
  concerns?: string[];
  competitorMentions?: string[];
  nextSteps?: string | null;
  followUpDate?: string | null;
  status?: (typeof DEMO_FEEDBACK_STATUSES)[number];
  notes?: string | null;
};

type ListDemoFeedbackInput = {
  status?: (typeof DEMO_FEEDBACK_STATUSES)[number];
  search?: string;
  demoDateFrom?: string | null;
  demoDateTo?: string | null;
  followUpDateFrom?: string | null;
  followUpDateTo?: string | null;
  limit: number;
};

let indexesEnsured = false;

function normalizeOptionalString(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStringArray(value: string[] | null | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function mapFeedbackDoc(doc: DemoFeedbackDocument) {
  return {
    id: String(doc.id),
    collegeName: String(doc.college_name),
    tpoName: String(doc.tpo_name),
    contactEmail: doc.contact_email ? String(doc.contact_email) : null,
    contactPhone: doc.contact_phone ? String(doc.contact_phone) : null,
    demoDate: String(doc.demo_date),
    demoRating: doc.demo_rating ?? null,
    productFit: doc.product_fit ?? null,
    conversionLikelihood: doc.conversion_likelihood ?? null,
    painPoints: Array.isArray(doc.pain_points) ? doc.pain_points.map((item) => String(item)) : [],
    featureRequests: Array.isArray(doc.feature_requests) ? doc.feature_requests.map((item) => String(item)) : [],
    concerns: Array.isArray(doc.concerns) ? doc.concerns.map((item) => String(item)) : [],
    competitorMentions: Array.isArray(doc.competitor_mentions) ? doc.competitor_mentions.map((item) => String(item)) : [],
    nextSteps: doc.next_steps ? String(doc.next_steps) : null,
    followUpDate: doc.follow_up_date ? String(doc.follow_up_date) : null,
    status: String(doc.status),
    notes: doc.notes ? String(doc.notes) : null,
    createdBy: String(doc.created_by),
    createdAt: String(doc.created_at),
    updatedAt: String(doc.updated_at),
  };
}

function buildDateFilter(from: string | null | undefined, to: string | null | undefined) {
  const filter = {
    ...(from ? { $gte: from } : {}),
    ...(to ? { $lte: to } : {}),
  };
  return Object.keys(filter).length > 0 ? filter : null;
}

function addRanking(map: Map<string, { label: string; count: number }>, values: string[]) {
  values.forEach((value) => {
    const trimmed = String(value).trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    map.set(key, { label: trimmed, count: 1 });
  });
}

async function ensureIndexes() {
  if (indexesEnsured) return;

  const db = await getMongoDb();
  await Promise.all([
    db.collection(DEMO_FEEDBACK_COLLECTION).createIndex({ tenant_id: 1, id: 1 }, { unique: true }),
    db.collection(DEMO_FEEDBACK_COLLECTION).createIndex({ tenant_id: 1, demo_date: -1 }),
    db.collection(DEMO_FEEDBACK_COLLECTION).createIndex({ tenant_id: 1, status: 1, demo_date: -1 }),
    db.collection(DEMO_FEEDBACK_COLLECTION).createIndex({ tenant_id: 1, follow_up_date: 1 }),
    db.collection(DEMO_FEEDBACK_COLLECTION).createIndex({ tenant_id: 1, college_name: 1 }),
  ]);
  indexesEnsured = true;
}

export const DemoFeedbackService = {
  async create(tenantId: string, userId: string, input: CreateDemoFeedbackInput) {
    await ensureIndexes();
    const db = await getMongoDb();
    const now = new Date().toISOString();
    const doc: DemoFeedbackDocument = {
      id: randomUUID(),
      tenant_id: tenantId,
      college_name: input.collegeName.trim(),
      tpo_name: input.tpoName.trim(),
      contact_email: normalizeOptionalString(input.contactEmail),
      contact_phone: normalizeOptionalString(input.contactPhone),
      demo_date: input.demoDate ? new Date(input.demoDate).toISOString() : now,
      demo_rating: input.demoRating ?? null,
      product_fit: input.productFit ?? null,
      conversion_likelihood: input.conversionLikelihood ?? null,
      pain_points: normalizeStringArray(input.painPoints),
      feature_requests: normalizeStringArray(input.featureRequests),
      concerns: normalizeStringArray(input.concerns),
      competitor_mentions: normalizeStringArray(input.competitorMentions),
      next_steps: normalizeOptionalString(input.nextSteps),
      follow_up_date: input.followUpDate ? new Date(input.followUpDate).toISOString() : null,
      status: input.status ?? "demo_completed",
      notes: normalizeOptionalString(input.notes),
      created_by: userId,
      created_at: now,
      updated_at: now,
    };

    await db.collection<DemoFeedbackDocument>(DEMO_FEEDBACK_COLLECTION).insertOne(doc);
    return mapFeedbackDoc(doc);
  },

  async list(tenantId: string, query: ListDemoFeedbackInput) {
    await ensureIndexes();
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { tenant_id: tenantId };

    if (query.status) {
      filter.status = query.status;
    }

    const demoDateFilter = buildDateFilter(query.demoDateFrom, query.demoDateTo);
    if (demoDateFilter) {
      filter.demo_date = demoDateFilter;
    }

    const followUpDateFilter = buildDateFilter(query.followUpDateFrom, query.followUpDateTo);
    if (followUpDateFilter) {
      filter.follow_up_date = followUpDateFilter;
    }

    if (query.search) {
      const regex = { $regex: query.search.trim(), $options: "i" };
      filter.$or = [
        { college_name: regex },
        { tpo_name: regex },
        { contact_email: regex },
        { contact_phone: regex },
        { notes: regex },
        { next_steps: regex },
        { pain_points: regex },
        { feature_requests: regex },
        { concerns: regex },
        { competitor_mentions: regex },
      ];
    }

    const rows = await db.collection<DemoFeedbackDocument>(DEMO_FEEDBACK_COLLECTION).find(
      filter,
      { projection: { _id: 0 } },
    ).sort({ demo_date: -1, created_at: -1 }).limit(query.limit).toArray();

    return {
      items: rows.map(mapFeedbackDoc),
      total: rows.length,
    };
  },

  async getById(tenantId: string, feedbackId: string) {
    await ensureIndexes();
    const db = await getMongoDb();
    const doc = await db.collection<DemoFeedbackDocument>(DEMO_FEEDBACK_COLLECTION).findOne(
      { tenant_id: tenantId, id: feedbackId },
      { projection: { _id: 0 } },
    );

    if (!doc) {
      throw new AppError("DEMO_FEEDBACK_NOT_FOUND", "Demo feedback not found", 404);
    }

    return mapFeedbackDoc(doc);
  },

  async update(tenantId: string, feedbackId: string, input: Partial<CreateDemoFeedbackInput>) {
    await ensureIndexes();
    const db = await getMongoDb();
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.collegeName !== undefined) updates.college_name = input.collegeName.trim();
    if (input.tpoName !== undefined) updates.tpo_name = input.tpoName.trim();
    if (input.contactEmail !== undefined) updates.contact_email = normalizeOptionalString(input.contactEmail);
    if (input.contactPhone !== undefined) updates.contact_phone = normalizeOptionalString(input.contactPhone);
    if (input.demoDate !== undefined) updates.demo_date = input.demoDate ? new Date(input.demoDate).toISOString() : new Date().toISOString();
    if (input.demoRating !== undefined) updates.demo_rating = input.demoRating ?? null;
    if (input.productFit !== undefined) updates.product_fit = input.productFit ?? null;
    if (input.conversionLikelihood !== undefined) updates.conversion_likelihood = input.conversionLikelihood ?? null;
    if (input.painPoints !== undefined) updates.pain_points = normalizeStringArray(input.painPoints);
    if (input.featureRequests !== undefined) updates.feature_requests = normalizeStringArray(input.featureRequests);
    if (input.concerns !== undefined) updates.concerns = normalizeStringArray(input.concerns);
    if (input.competitorMentions !== undefined) updates.competitor_mentions = normalizeStringArray(input.competitorMentions);
    if (input.nextSteps !== undefined) updates.next_steps = normalizeOptionalString(input.nextSteps);
    if (input.followUpDate !== undefined) updates.follow_up_date = input.followUpDate ? new Date(input.followUpDate).toISOString() : null;
    if (input.status !== undefined) updates.status = input.status;
    if (input.notes !== undefined) updates.notes = normalizeOptionalString(input.notes);

    const result = await db.collection<DemoFeedbackDocument>(DEMO_FEEDBACK_COLLECTION).findOneAndUpdate(
      { tenant_id: tenantId, id: feedbackId },
      { $set: updates },
      { returnDocument: "after", projection: { _id: 0 } },
    );

    if (!result) {
      throw new AppError("DEMO_FEEDBACK_NOT_FOUND", "Demo feedback not found", 404);
    }

    return mapFeedbackDoc(result);
  },

  async getAnalytics(tenantId: string) {
    await ensureIndexes();
    const db = await getMongoDb();
    const rows = await db.collection<DemoFeedbackDocument>(DEMO_FEEDBACK_COLLECTION).find(
      { tenant_id: tenantId },
      { projection: { _id: 0 } },
    ).toArray();

    const totalDemos = rows.length;
    const statusBreakdown = {
      demo_completed: 0,
      follow_up_scheduled: 0,
      pilot_started: 0,
      converted: 0,
      lost: 0,
    };
    const painPointMap = new Map<string, { label: string; count: number }>();
    const featureRequestMap = new Map<string, { label: string; count: number }>();

    let demoRatingTotal = 0;
    let demoRatingCount = 0;
    let productFitTotal = 0;
    let productFitCount = 0;
    let conversionLikelihoodTotal = 0;
    let conversionLikelihoodCount = 0;

    rows.forEach((row) => {
      statusBreakdown[row.status] += 1;
      if (typeof row.demo_rating === "number") {
        demoRatingTotal += row.demo_rating;
        demoRatingCount += 1;
      }
      if (typeof row.product_fit === "number") {
        productFitTotal += row.product_fit;
        productFitCount += 1;
      }
      if (typeof row.conversion_likelihood === "number") {
        conversionLikelihoodTotal += row.conversion_likelihood;
        conversionLikelihoodCount += 1;
      }

      addRanking(painPointMap, row.pain_points);
      addRanking(featureRequestMap, row.feature_requests);
    });

    const followUps = rows.filter((row) => ["follow_up_scheduled", "pilot_started", "converted"].includes(row.status)).length;
    const pilots = rows.filter((row) => ["pilot_started", "converted"].includes(row.status)).length;
    const conversions = statusBreakdown.converted;

    return {
      totalDemos,
      avgDemoRating: demoRatingCount > 0 ? Number((demoRatingTotal / demoRatingCount).toFixed(1)) : 0,
      avgProductFit: productFitCount > 0 ? Number((productFitTotal / productFitCount).toFixed(1)) : 0,
      avgConversionLikelihood: conversionLikelihoodCount > 0 ? Number((conversionLikelihoodTotal / conversionLikelihoodCount).toFixed(1)) : 0,
      statusBreakdown,
      commonPainPoints: [...painPointMap.values()]
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, 10)
        .map((item) => ({ painPoint: item.label, count: item.count })),
      topFeatureRequests: [...featureRequestMap.values()]
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, 10)
        .map((item) => ({ feature: item.label, count: item.count })),
      conversionFunnel: {
        demos: totalDemos,
        followUps,
        pilots,
        conversions,
        conversionRate: totalDemos > 0 ? Number(((conversions / totalDemos) * 100).toFixed(1)) : 0,
      },
    };
  },
};
