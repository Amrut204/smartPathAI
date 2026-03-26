import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import {
  SALES_PIPELINE_COLLECTION,
  SALES_PIPELINE_STAGES,
  type SalesPipelineDocument,
  type SalesPipelinePriority,
  type SalesPipelineStage,
} from "../models/SalesPipeline.js";
import { getMongoDb } from "../utils/mongodb.js";

type CreateSalesPipelineInput = {
  collegeName: string;
  collegeLocation?: string | null;
  studentCount?: number | null;
  tpoName: string;
  tpoEmail?: string | null;
  tpoPhone?: string | null;
  tpoLinkedIn?: string | null;
  stage?: SalesPipelineStage;
  priority?: SalesPipelinePriority;
  contactDate?: string | null;
  demoDate?: string | null;
  pilotStartDate?: string | null;
  conversionDate?: string | null;
  expectedRevenue?: number | null;
  lostReason?: string | null;
  nextAction?: string | null;
  nextActionDate?: string | null;
  notes?: string[];
  linkedDemoFeedback?: string | null;
};

type UpdateSalesPipelineInput = Partial<CreateSalesPipelineInput> & {
  addNote?: string;
};

type ListSalesPipelineInput = {
  stage?: SalesPipelineStage;
  priority?: SalesPipelinePriority;
  search?: string;
  nextActionDateFrom?: string | null;
  nextActionDateTo?: string | null;
  limit: number;
};

let indexesEnsured = false;

function normalizeOptionalString(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeNotes(value: string[] | null | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeOptionalDate(value: string | null | undefined) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function mapSalesPipelineDoc(doc: SalesPipelineDocument) {
  return {
    id: String(doc.id),
    collegeName: String(doc.college_name),
    collegeLocation: doc.college_location ? String(doc.college_location) : null,
    studentCount: typeof doc.student_count === "number" ? doc.student_count : null,
    tpoName: String(doc.tpo_name),
    tpoEmail: doc.tpo_email ? String(doc.tpo_email) : null,
    tpoPhone: doc.tpo_phone ? String(doc.tpo_phone) : null,
    tpoLinkedIn: doc.tpo_linkedin ? String(doc.tpo_linkedin) : null,
    stage: doc.stage,
    priority: doc.priority,
    contactDate: doc.contact_date ? String(doc.contact_date) : null,
    demoDate: doc.demo_date ? String(doc.demo_date) : null,
    pilotStartDate: doc.pilot_start_date ? String(doc.pilot_start_date) : null,
    conversionDate: doc.conversion_date ? String(doc.conversion_date) : null,
    expectedRevenue: typeof doc.expected_revenue === "number" ? doc.expected_revenue : null,
    lostReason: doc.lost_reason ? String(doc.lost_reason) : null,
    nextAction: doc.next_action ? String(doc.next_action) : null,
    nextActionDate: doc.next_action_date ? String(doc.next_action_date) : null,
    notes: Array.isArray(doc.notes) ? doc.notes.map((item) => String(item)) : [],
    linkedDemoFeedback: doc.linked_demo_feedback ? String(doc.linked_demo_feedback) : null,
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

function safeAverage(values: number[]) {
  if (values.length === 0) return 0;
  const sum = values.reduce((total, value) => total + value, 0);
  return Number((sum / values.length).toFixed(1));
}

function diffDays(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return (endMs - startMs) / (1000 * 60 * 60 * 24);
}

function getStageDuration(stage: SalesPipelineStage, row: SalesPipelineDocument) {
  const now = new Date().toISOString();

  switch (stage) {
    case "contacted":
      return diffDays(row.contact_date, row.demo_date ?? row.pilot_start_date ?? row.conversion_date ?? (row.stage === "contacted" ? now : null));
    case "demo_scheduled":
      return diffDays(row.demo_date, row.pilot_start_date ?? row.conversion_date ?? (row.stage === "demo_scheduled" ? now : null));
    case "demo_completed":
      return diffDays(row.demo_date, row.pilot_start_date ?? row.conversion_date ?? (row.stage === "demo_completed" ? now : null));
    case "pilot_started":
      return diffDays(row.pilot_start_date, row.conversion_date ?? (row.stage === "pilot_started" ? now : null));
    case "pilot_completed":
      return diffDays(row.pilot_start_date, row.conversion_date ?? (row.stage === "pilot_completed" ? now : null));
    case "converted":
    case "lost":
      return 0;
    default:
      return null;
  }
}

async function ensureIndexes() {
  if (indexesEnsured) return;

  const db = await getMongoDb();
  await Promise.all([
    db.collection(SALES_PIPELINE_COLLECTION).createIndex({ tenant_id: 1, id: 1 }, { unique: true }),
    db.collection(SALES_PIPELINE_COLLECTION).createIndex({ tenant_id: 1, stage: 1, priority: 1 }),
    db.collection(SALES_PIPELINE_COLLECTION).createIndex({ tenant_id: 1, next_action_date: 1 }),
    db.collection(SALES_PIPELINE_COLLECTION).createIndex({ tenant_id: 1, college_name: 1 }),
    db.collection(SALES_PIPELINE_COLLECTION).createIndex({ tenant_id: 1, tpo_name: 1 }),
  ]);
  indexesEnsured = true;
}

export const SalesPipelineService = {
  async create(tenantId: string, userId: string, input: CreateSalesPipelineInput) {
    await ensureIndexes();
    const db = await getMongoDb();
    const now = new Date().toISOString();

    const doc: SalesPipelineDocument = {
      id: randomUUID(),
      tenant_id: tenantId,
      college_name: input.collegeName.trim(),
      college_location: normalizeOptionalString(input.collegeLocation),
      student_count: typeof input.studentCount === "number" ? input.studentCount : null,
      tpo_name: input.tpoName.trim(),
      tpo_email: normalizeOptionalString(input.tpoEmail),
      tpo_phone: normalizeOptionalString(input.tpoPhone),
      tpo_linkedin: normalizeOptionalString(input.tpoLinkedIn),
      stage: input.stage ?? "contacted",
      priority: input.priority ?? "B",
      contact_date: normalizeOptionalDate(input.contactDate) ?? now,
      demo_date: normalizeOptionalDate(input.demoDate),
      pilot_start_date: normalizeOptionalDate(input.pilotStartDate),
      conversion_date: normalizeOptionalDate(input.conversionDate),
      expected_revenue: typeof input.expectedRevenue === "number" ? input.expectedRevenue : null,
      lost_reason: normalizeOptionalString(input.lostReason),
      next_action: normalizeOptionalString(input.nextAction),
      next_action_date: normalizeOptionalDate(input.nextActionDate),
      notes: normalizeNotes(input.notes),
      linked_demo_feedback: normalizeOptionalString(input.linkedDemoFeedback),
      created_by: userId,
      created_at: now,
      updated_at: now,
    };

    await db.collection<SalesPipelineDocument>(SALES_PIPELINE_COLLECTION).insertOne(doc);
    return mapSalesPipelineDoc(doc);
  },

  async list(tenantId: string, query: ListSalesPipelineInput) {
    await ensureIndexes();
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { tenant_id: tenantId };

    if (query.stage) filter.stage = query.stage;
    if (query.priority) filter.priority = query.priority;

    const nextActionDateFilter = buildDateFilter(query.nextActionDateFrom, query.nextActionDateTo);
    if (nextActionDateFilter) {
      filter.next_action_date = nextActionDateFilter;
    }

    if (query.search) {
      const regex = { $regex: query.search.trim(), $options: "i" };
      filter.$or = [
        { college_name: regex },
        { college_location: regex },
        { tpo_name: regex },
        { tpo_email: regex },
        { tpo_phone: regex },
        { tpo_linkedin: regex },
        { next_action: regex },
        { notes: regex },
        { lost_reason: regex },
      ];
    }

    const rows = await db.collection<SalesPipelineDocument>(SALES_PIPELINE_COLLECTION).find(
      filter,
      { projection: { _id: 0 } },
    ).sort({ priority: 1, next_action_date: 1, updated_at: -1 }).limit(query.limit).toArray();

    return {
      items: rows.map(mapSalesPipelineDoc),
      total: rows.length,
    };
  },

  async getById(tenantId: string, pipelineId: string) {
    await ensureIndexes();
    const db = await getMongoDb();
    const doc = await db.collection<SalesPipelineDocument>(SALES_PIPELINE_COLLECTION).findOne(
      { tenant_id: tenantId, id: pipelineId },
      { projection: { _id: 0 } },
    );

    if (!doc) {
      throw new AppError("SALES_PIPELINE_NOT_FOUND", "Sales pipeline record not found", 404);
    }

    return mapSalesPipelineDoc(doc);
  },

  async update(tenantId: string, pipelineId: string, input: UpdateSalesPipelineInput) {
    await ensureIndexes();
    const db = await getMongoDb();
    const existing = await db.collection<SalesPipelineDocument>(SALES_PIPELINE_COLLECTION).findOne(
      { tenant_id: tenantId, id: pipelineId },
      { projection: { _id: 0 } },
    );

    if (!existing) {
      throw new AppError("SALES_PIPELINE_NOT_FOUND", "Sales pipeline record not found", 404);
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.collegeName !== undefined) updates.college_name = input.collegeName.trim();
    if (input.collegeLocation !== undefined) updates.college_location = normalizeOptionalString(input.collegeLocation);
    if (input.studentCount !== undefined) updates.student_count = typeof input.studentCount === "number" ? input.studentCount : null;
    if (input.tpoName !== undefined) updates.tpo_name = input.tpoName.trim();
    if (input.tpoEmail !== undefined) updates.tpo_email = normalizeOptionalString(input.tpoEmail);
    if (input.tpoPhone !== undefined) updates.tpo_phone = normalizeOptionalString(input.tpoPhone);
    if (input.tpoLinkedIn !== undefined) updates.tpo_linkedin = normalizeOptionalString(input.tpoLinkedIn);
    if (input.stage !== undefined) updates.stage = input.stage;
    if (input.priority !== undefined) updates.priority = input.priority;
    if (input.contactDate !== undefined) updates.contact_date = normalizeOptionalDate(input.contactDate);
    if (input.demoDate !== undefined) updates.demo_date = normalizeOptionalDate(input.demoDate);
    if (input.pilotStartDate !== undefined) updates.pilot_start_date = normalizeOptionalDate(input.pilotStartDate);
    if (input.conversionDate !== undefined) updates.conversion_date = normalizeOptionalDate(input.conversionDate);
    if (input.expectedRevenue !== undefined) updates.expected_revenue = typeof input.expectedRevenue === "number" ? input.expectedRevenue : null;
    if (input.lostReason !== undefined) updates.lost_reason = normalizeOptionalString(input.lostReason);
    if (input.nextAction !== undefined) updates.next_action = normalizeOptionalString(input.nextAction);
    if (input.nextActionDate !== undefined) updates.next_action_date = normalizeOptionalDate(input.nextActionDate);
    if (input.notes !== undefined) updates.notes = normalizeNotes(input.notes);
    if (input.linkedDemoFeedback !== undefined) updates.linked_demo_feedback = normalizeOptionalString(input.linkedDemoFeedback);
    if (input.addNote !== undefined) {
      updates.notes = normalizeNotes([...(existing.notes ?? []), input.addNote]);
    }

    const result = await db.collection<SalesPipelineDocument>(SALES_PIPELINE_COLLECTION).findOneAndUpdate(
      { tenant_id: tenantId, id: pipelineId },
      { $set: updates },
      { returnDocument: "after", projection: { _id: 0 } },
    );

    if (!result) {
      throw new AppError("SALES_PIPELINE_NOT_FOUND", "Sales pipeline record not found", 404);
    }

    return mapSalesPipelineDoc(result);
  },

  async getAnalytics(tenantId: string) {
    await ensureIndexes();
    const db = await getMongoDb();
    const rows = await db.collection<SalesPipelineDocument>(SALES_PIPELINE_COLLECTION).find(
      { tenant_id: tenantId },
      { projection: { _id: 0 } },
    ).toArray();

    const byStage = {
      contacted: 0,
      demo_scheduled: 0,
      demo_completed: 0,
      pilot_started: 0,
      pilot_completed: 0,
      converted: 0,
      lost: 0,
    };

    const expectedRevenueByStage = {
      contacted: 0,
      demo_scheduled: 0,
      demo_completed: 0,
      pilot_started: 0,
      pilot_completed: 0,
      converted: 0,
      lost: 0,
    };

    const durations = new Map<SalesPipelineStage, number[]>(
      SALES_PIPELINE_STAGES.map((stage) => [stage, []]),
    );

    rows.forEach((row) => {
      byStage[row.stage] += 1;
      expectedRevenueByStage[row.stage] += row.expected_revenue ?? 0;

      SALES_PIPELINE_STAGES.forEach((stage) => {
        const duration = getStageDuration(stage, row);
        if (duration !== null) {
          durations.get(stage)!.push(duration);
        }
      });
    });

    const totalContacts = rows.length;
    const demoOrBeyond = byStage.demo_scheduled + byStage.demo_completed + byStage.pilot_started + byStage.pilot_completed + byStage.converted;
    const pilotOrBeyond = byStage.pilot_started + byStage.pilot_completed + byStage.converted;
    const conversions = byStage.converted;

    return {
      totalContacts,
      byStage,
      conversionRates: {
        contactToDemo: totalContacts > 0 ? Number(((demoOrBeyond / totalContacts) * 100).toFixed(1)) : 0,
        demoToPilot: demoOrBeyond > 0 ? Number(((pilotOrBeyond / demoOrBeyond) * 100).toFixed(1)) : 0,
        pilotToConversion: pilotOrBeyond > 0 ? Number(((conversions / pilotOrBeyond) * 100).toFixed(1)) : 0,
        overallConversion: totalContacts > 0 ? Number(((conversions / totalContacts) * 100).toFixed(1)) : 0,
      },
      expectedRevenue: {
        total: Number(rows.reduce((sum, row) => sum + (row.expected_revenue ?? 0), 0).toFixed(2)),
        byStage: expectedRevenueByStage,
      },
      avgTimeInStage: {
        contacted: safeAverage(durations.get("contacted") ?? []),
        demo_scheduled: safeAverage(durations.get("demo_scheduled") ?? []),
        demo_completed: safeAverage(durations.get("demo_completed") ?? []),
        pilot_started: safeAverage(durations.get("pilot_started") ?? []),
        pilot_completed: safeAverage(durations.get("pilot_completed") ?? []),
        converted: safeAverage(durations.get("converted") ?? []),
        lost: safeAverage(durations.get("lost") ?? []),
      },
    };
  },
};
