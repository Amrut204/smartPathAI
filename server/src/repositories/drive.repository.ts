import { createHash, randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { getMongoDb } from "../utils/mongodb.js";

export interface DriveCriteria {
  minCgpa?: number;
  /** Legacy field (treated as active backlogs). */
  maxBacklogs?: number;
  maxActiveBacklogs?: number;
  maxTotalBacklogs?: number;
  branches?: string[];
  minAttendance?: number;
  excludePlacedStudents?: boolean;
}

interface DriveWriteInput {
  company: string;
  role?: string;
  driveDate: string;
  sectorOrIndustry?: string;
  ctcMinLpa?: number;
  ctcMaxLpa?: number;
  ctcFinalLpa?: number;
  visitDate?: string;
  roundsConducted?: string[];
  mouStatus?: "not_started" | "in_discussion" | "signed" | "not_applicable";
  reportingNotes?: string;
  registrationInstructions?: string;
  requiredDocuments?: string[];
  location?: string;
  mode?: "on_campus" | "off_campus" | "hybrid";
  dressCode?: string;
  criteria: DriveCriteria;
  status: DriveLifecycle;
  previewDigest?: string | null;
}

interface DriveResultIntakeInput {
  source?: "employer_email" | "employer_portal" | "manual_update";
  receivedAt?: string;
  companyResultReference?: string;
  attachmentNote?: string;
  receivedBy?: string;
}

interface DriveListQuery {
  limit: number;
  cursor?: string;
  status?: DriveLifecycle;
}

interface DriveResultWrite {
  studentId: string;
  status: "eligible" | "applied" | "not_eligible";
  applicationState?: DriveApplicationState;
  outcome: "pending" | "shortlisted" | "selected" | "rejected";
  remarks?: string;
  registered?: boolean;
  appeared?: boolean;
  shortlistedRound?: string;
  offerDate?: string;
  designationOffered?: string;
  finalCtcLpa?: number;
  joiningStatus?: "pending" | "joined" | "not_joined" | "deferred";
  offerLetterReference?: string;
  offerLetterUrl?: string;
  joiningLetterUrl?: string;
  selectionSource?: "on_campus" | "off_campus" | "self_reported";
  verificationStatus?: "pending" | "verified" | "rejected";
  sourceNote?: string;
  nonPlacementReason?: string;
  actionPlan?: string;
  rounds?: DriveResultRound[];
}

interface ResumeSnapshotWriteInput {
  provider: string;
  fileId?: string | null;
  webLink: string;
  filename?: string | null;
  uploadedAt?: string | null;
}

interface DriveResultReleaseStatusUpdate {
  studentId: string;
  resultReleasedAt?: string | null;
  resultReleasedBy?: string | null;
  resultNotificationStatus?: "queued" | "sent" | "failed" | null;
  resultNotificationCommunicationId?: string | null;
  offerLetterSharedAt?: string | null;
  offerLetterSharedBy?: string | null;
}

interface StudentEligibilityRow {
  id: string;
  user_id: string;
  roll_number: string | null;
  branch: string;
  batch: string;
  cgpa: number | null;
  backlogs: number;
  backlogs_total?: number | null;
  attendance_pct: number | null;
  readiness_score: number;
}

export interface EnrichedStudent {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  rollNumber: string;
  branch: string;
  batch: string;
  cgpa: number;
  backlogs: number;
  backlogsTotal: number;
  attendancePct: number;
  readinessScore: number;
}

export interface EligibilityReasonCount {
  code: string;
  label: string;
  count: number;
}

export type DriveLifecycle =
  | "draft"
  | "published"
  | "registration_closed"
  | "in_process"
  | "results_pending"
  | "completed"
  | "archived"
  | "cancelled";

export type LegacyDriveStatus = "upcoming" | "active" | "completed" | "cancelled";
type DriveResultStatus = "eligible" | "applied" | "not_eligible";
export type DriveApplicationState = "not_applied" | "applied" | "withdrawn" | "absent";

export interface DriveResultRound {
  key: string;
  label: string;
  stageType: "screening" | "aptitude" | "group_discussion" | "technical_interview" | "hr_interview" | "final_decision" | "custom";
  status: "pending" | "qualified" | "not_qualified" | "scheduled" | "completed";
  decidedAt?: string | null;
  releasedAt?: string | null;
  notes?: string | null;
}

export interface DriveEligibilitySnapshot {
  id: string;
  driveId: string;
  version: number;
  criteria: DriveCriteria;
  totalStudents: number;
  eligibleCount: number;
  ineligibleCount: number;
  reasons: EligibilityReasonCount[];
  computedAt: string;
  computedBy: string;
  branchBreakdown?: Array<{ branch: string; eligibleCount: number; ineligibleCount: number; totalStudents: number }>;
  sampleExcludedStudents?: Array<{ studentId: string; fullName: string; branch: string; cgpa: number; attendancePct: number; reasons: EligibilityReasonCount["code"][] }>;
  previewDigest?: string;
}

export interface DriveResultReleaseStatusRow {
  studentId: string;
  fullName: string;
  email: string;
  outcome: "pending" | "shortlisted" | "selected" | "rejected";
  resultReleasedAt: string | null;
  resultReleasedBy: string | null;
  resultNotificationStatus: "queued" | "sent" | "failed" | null;
  resultNotificationCommunicationId: string | null;
  offerLetterReference: string | null;
  offerLetterUrl: string | null;
  offerLetterSharedAt: string | null;
  offerLetterSharedBy: string | null;
  updatedAt: string | null;
}

export interface DriveResultRowRecord {
  id: string;
  studentId: string;
  status: "eligible" | "applied" | "not_eligible";
  applicationState: DriveApplicationState;
  outcome: "pending" | "shortlisted" | "selected" | "rejected";
  resultReleasedAt: string | null;
  offerLetterUrl: string | null;
  offerLetterReference: string | null;
}

export interface DriveResumeExportRow {
  studentId: string;
  fullName: string;
  email: string;
  rollNumber: string;
  branch: string;
  batch: string;
  cgpa: number;
  applicationState: DriveApplicationState;
  outcome: "pending" | "shortlisted" | "selected" | "rejected";
  resumeFilename: string | null;
  resumeUrl: string;
}

const LEGACY_TO_CANONICAL_STATUS: Record<LegacyDriveStatus, DriveLifecycle> = {
  upcoming: "published",
  active: "in_process",
  completed: "completed",
  cancelled: "cancelled",
};

export function normalizeDriveLifecycle(value: unknown): DriveLifecycle {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized in LEGACY_TO_CANONICAL_STATUS) {
    return LEGACY_TO_CANONICAL_STATUS[normalized as LegacyDriveStatus];
  }
  if (
    normalized === "draft"
    || normalized === "published"
    || normalized === "registration_closed"
    || normalized === "in_process"
    || normalized === "results_pending"
    || normalized === "completed"
    || normalized === "archived"
    || normalized === "cancelled"
  ) {
    return normalized;
  }
  return "draft";
}

function buildStatusFilter(status: DriveLifecycle) {
  if (status === "published") return { $in: ["published", "upcoming"] };
  if (status === "in_process") return { $in: ["in_process", "active"] };
  return status;
}

export function buildDriveCriteriaDigest(criteria: DriveCriteria) {
  const normalized = {
    minCgpa: criteria.minCgpa ?? null,
    maxBacklogs: criteria.maxBacklogs ?? null,
    maxActiveBacklogs: criteria.maxActiveBacklogs ?? null,
    maxTotalBacklogs: criteria.maxTotalBacklogs ?? null,
    branches: Array.isArray(criteria.branches) ? [...criteria.branches].map(String).sort() : [],
    minAttendance: criteria.minAttendance ?? null,
    excludePlacedStudents: Boolean(criteria.excludePlacedStudents),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function deriveApplicationState(row: Record<string, unknown>): DriveApplicationState {
  const explicit = String(row.application_state ?? "").trim().toLowerCase();
  if (explicit === "applied" || explicit === "withdrawn" || explicit === "absent" || explicit === "not_applied") {
    return explicit;
  }
  const status = String(row.status ?? "").trim().toLowerCase();
  if (status === "applied") return "applied";
  return "not_applied";
}

function normalizeRounds(value: unknown): DriveResultRound[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): DriveResultRound | null => {
      if (!item || typeof item !== "object") return null;
      const entry = item as Record<string, unknown>;
      const key = String(entry.key ?? "").trim();
      const label = String(entry.label ?? "").trim();
      const stageType = String(entry.stage_type ?? entry.stageType ?? "").trim();
      const status = String(entry.status ?? "").trim();
      if (!key || !label || !stageType || !status) return null;
      return {
        key,
        label,
        stageType: stageType as DriveResultRound["stageType"],
        status: status as DriveResultRound["status"],
        decidedAt: entry.decided_at ? String(entry.decided_at) : entry.decidedAt ? String(entry.decidedAt) : undefined,
        releasedAt: entry.released_at ? String(entry.released_at) : entry.releasedAt ? String(entry.releasedAt) : undefined,
        notes: entry.notes ? String(entry.notes) : null,
      } satisfies DriveResultRound;
    })
    .filter((item): item is DriveResultRound => item !== null);
}

async function enrichStudents(
  tenantId: string,
  students: StudentEligibilityRow[],
) {
  if (students.length === 0) return [];

  const db = await getMongoDb();
  const userIds = students.map((s) => String(s.user_id));
  const users = await db.collection("users").find(
    { tenant_id: tenantId, id: { $in: userIds } },
    { projection: { id: 1, full_name: 1, email: 1 } },
  ).toArray();

  const userMap = new Map(users.map((u) => [String(u.id), u]));

  return students.map((student) => ({
    id: String(student.id),
    userId: String(student.user_id),
    fullName: String(userMap.get(String(student.user_id))?.full_name ?? ""),
    email: String(userMap.get(String(student.user_id))?.email ?? ""),
    rollNumber: student.roll_number ? String(student.roll_number) : "",
    branch: String(student.branch),
    batch: String(student.batch),
    cgpa: Number(student.cgpa ?? 0),
    backlogs: Number(student.backlogs ?? 0),
    backlogsTotal: Number((student as unknown as { backlogs_total?: unknown }).backlogs_total ?? 0),
    attendancePct: Number(student.attendance_pct ?? 0),
    readinessScore: Number(student.readiness_score ?? 0),
  })) satisfies EnrichedStudent[];
}

export const DriveRepository = {
  async listDrives(tenantId: string, query: DriveListQuery) {
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { tenant_id: tenantId, deleted_at: null };

    if (query.status) filter.status = buildStatusFilter(query.status);
    if (query.cursor) filter.id = { $lt: query.cursor };

    const data = await db.collection("drives").find(
      filter,
      {
        projection: {
          _id: 0,
          id: 1,
          company: 1,
          role: 1,
          drive_date: 1,
          sector_or_industry: 1,
          ctc_min_lpa: 1,
          ctc_max_lpa: 1,
          ctc_final_lpa: 1,
          visit_date: 1,
          rounds_conducted: 1,
          mou_status: 1,
          reporting_notes: 1,
          registration_instructions: 1,
          required_documents: 1,
          location: 1,
          mode: 1,
          dress_code: 1,
          criteria: 1,
          status: 1,
          eligible_count: 1,
          created_at: 1,
        },
      },
    ).sort({ drive_date: -1, id: -1 }).limit(query.limit + 1).toArray();

    const hasMore = data.length > query.limit;
    const items = hasMore ? data.slice(0, query.limit) : data;

    return {
      items: items.map((drive) => ({
        id: String(drive.id),
        company: String(drive.company),
        role: drive.role ? String(drive.role) : null,
        driveDate: String(drive.drive_date),
        sectorOrIndustry: drive.sector_or_industry ? String(drive.sector_or_industry) : null,
        ctcMinLpa: drive.ctc_min_lpa === undefined || drive.ctc_min_lpa === null ? null : Number(drive.ctc_min_lpa),
        ctcMaxLpa: drive.ctc_max_lpa === undefined || drive.ctc_max_lpa === null ? null : Number(drive.ctc_max_lpa),
        ctcFinalLpa: drive.ctc_final_lpa === undefined || drive.ctc_final_lpa === null ? null : Number(drive.ctc_final_lpa),
        visitDate: drive.visit_date ? String(drive.visit_date) : null,
        roundsConducted: Array.isArray(drive.rounds_conducted) ? drive.rounds_conducted.map((item) => String(item)) : [],
        mouStatus: drive.mou_status ? String(drive.mou_status) : "not_started",
        reportingNotes: drive.reporting_notes ? String(drive.reporting_notes) : null,
        registrationInstructions: drive.registration_instructions ? String(drive.registration_instructions) : null,
        requiredDocuments: Array.isArray(drive.required_documents) ? drive.required_documents.map((item) => String(item)) : [],
        location: drive.location ? String(drive.location) : null,
        mode: drive.mode ? String(drive.mode) : null,
        dressCode: drive.dress_code ? String(drive.dress_code) : null,
        criteria: (drive.criteria ?? {}) as DriveCriteria,
        status: normalizeDriveLifecycle(drive.status),
        eligibleCount: Number(drive.eligible_count ?? 0),
        createdAt: String(drive.created_at),
      })),
      hasMore,
      nextCursor: hasMore ? String(items[items.length - 1]?.id) : null,
    };
  },

  async createDrive(tenantId: string, createdBy: string, input: DriveWriteInput) {
    const db = await getMongoDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    await db.collection("drives").insertOne({
      id,
      tenant_id: tenantId,
      company: input.company,
      role: input.role ?? null,
      drive_date: input.driveDate,
      sector_or_industry: input.sectorOrIndustry ?? null,
      ctc_min_lpa: input.ctcMinLpa ?? null,
      ctc_max_lpa: input.ctcMaxLpa ?? null,
      ctc_final_lpa: input.ctcFinalLpa ?? null,
      visit_date: input.visitDate ?? null,
      rounds_conducted: input.roundsConducted ?? [],
      mou_status: input.mouStatus ?? "not_started",
      reporting_notes: input.reportingNotes ?? null,
      registration_instructions: input.registrationInstructions ?? null,
      required_documents: input.requiredDocuments ?? [],
      location: input.location ?? null,
      mode: input.mode ?? null,
      dress_code: input.dressCode ?? null,
      criteria: input.criteria,
      status: input.status,
      eligible_count: 0,
      criteria_preview_digest: input.previewDigest ?? null,
      criteria_previewed_at: input.previewDigest ? now : null,
      created_by: createdBy,
      created_at: now,
      updated_at: now,
      latest_eligibility_version: null,
      latest_eligibility_computed_at: null,
      result_source: null,
      result_received_at: null,
      result_received_by: null,
      company_result_reference: null,
      result_attachment_note: null,
      deleted_at: null,
    });

    return this.getDriveById(tenantId, id);
  },

  async getDriveById(tenantId: string, driveId: string) {
    const db = await getMongoDb();
    const drive = await db.collection("drives").findOne(
      { tenant_id: tenantId, id: driveId, deleted_at: null },
      {
        projection: {
          _id: 0,
          id: 1,
          company: 1,
          role: 1,
          drive_date: 1,
          sector_or_industry: 1,
          ctc_min_lpa: 1,
          ctc_max_lpa: 1,
          ctc_final_lpa: 1,
          visit_date: 1,
          rounds_conducted: 1,
          mou_status: 1,
          reporting_notes: 1,
          registration_instructions: 1,
          required_documents: 1,
          location: 1,
          mode: 1,
          dress_code: 1,
          criteria: 1,
          status: 1,
          eligible_count: 1,
          created_at: 1,
          updated_at: 1,
          latest_eligibility_version: 1,
          latest_eligibility_computed_at: 1,
          criteria_preview_digest: 1,
          criteria_previewed_at: 1,
          result_source: 1,
          result_received_at: 1,
          result_received_by: 1,
          company_result_reference: 1,
          result_attachment_note: 1,
        },
      },
    );

    if (!drive) {
      throw new AppError("DRIVE_NOT_FOUND", "Drive not found", 404);
    }

    const results = await this.listDriveResults(tenantId, driveId);
    const snapshots = await this.listEligibilitySnapshots(tenantId, driveId, 10);

    return {
      id: String(drive.id),
      company: String(drive.company),
      role: drive.role ? String(drive.role) : null,
      driveDate: String(drive.drive_date),
      sectorOrIndustry: drive.sector_or_industry ? String(drive.sector_or_industry) : null,
      ctcMinLpa: drive.ctc_min_lpa === undefined || drive.ctc_min_lpa === null ? null : Number(drive.ctc_min_lpa),
      ctcMaxLpa: drive.ctc_max_lpa === undefined || drive.ctc_max_lpa === null ? null : Number(drive.ctc_max_lpa),
      ctcFinalLpa: drive.ctc_final_lpa === undefined || drive.ctc_final_lpa === null ? null : Number(drive.ctc_final_lpa),
      visitDate: drive.visit_date ? String(drive.visit_date) : null,
      roundsConducted: Array.isArray(drive.rounds_conducted) ? drive.rounds_conducted.map((item) => String(item)) : [],
      mouStatus: drive.mou_status ? String(drive.mou_status) : "not_started",
      reportingNotes: drive.reporting_notes ? String(drive.reporting_notes) : null,
      registrationInstructions: drive.registration_instructions ? String(drive.registration_instructions) : null,
      requiredDocuments: Array.isArray(drive.required_documents) ? drive.required_documents.map((item) => String(item)) : [],
      location: drive.location ? String(drive.location) : null,
      mode: drive.mode ? String(drive.mode) : null,
      dressCode: drive.dress_code ? String(drive.dress_code) : null,
      criteria: (drive.criteria ?? {}) as DriveCriteria,
      status: normalizeDriveLifecycle(drive.status),
      eligibleCount: Number(drive.eligible_count ?? 0),
      createdAt: String(drive.created_at),
      updatedAt: drive.updated_at ? String(drive.updated_at) : String(drive.created_at),
      previewDigest: drive.criteria_preview_digest ? String(drive.criteria_preview_digest) : null,
      previewedAt: drive.criteria_previewed_at ? String(drive.criteria_previewed_at) : null,
      eligibility: {
        latestVersion: drive.latest_eligibility_version ? Number(drive.latest_eligibility_version) : null,
        lastComputedAt: drive.latest_eligibility_computed_at
          ? String(drive.latest_eligibility_computed_at)
          : null,
        snapshots,
      },
      resultIntake: {
        source: drive.result_source ? String(drive.result_source) : null,
        receivedAt: drive.result_received_at ? String(drive.result_received_at) : null,
        receivedBy: drive.result_received_by ? String(drive.result_received_by) : null,
        companyResultReference: drive.company_result_reference ? String(drive.company_result_reference) : null,
        attachmentNote: drive.result_attachment_note ? String(drive.result_attachment_note) : null,
      },
      results,
    };
  },

  async updateDrive(
    tenantId: string,
    driveId: string,
    updates: Partial<{
      company: string;
      role: string;
      driveDate: string;
      sectorOrIndustry: string;
      ctcMinLpa: number;
      ctcMaxLpa: number;
      ctcFinalLpa: number;
      visitDate: string;
      roundsConducted: string[];
      mouStatus: "not_started" | "in_discussion" | "signed" | "not_applicable";
      reportingNotes: string;
      registrationInstructions: string;
      requiredDocuments: string[];
      location: string;
      mode: "on_campus" | "off_campus" | "hybrid";
      dressCode: string;
      criteria: DriveCriteria;
      status: DriveLifecycle;
      previewDigest: string;
    }>,
  ) {
    const db = await getMongoDb();
    const payload: Record<string, unknown> = {};

    if (updates.company !== undefined) payload.company = updates.company;
    if (updates.role !== undefined) payload.role = updates.role;
    if (updates.driveDate !== undefined) payload.drive_date = updates.driveDate;
    if (updates.sectorOrIndustry !== undefined) payload.sector_or_industry = updates.sectorOrIndustry;
    if (updates.ctcMinLpa !== undefined) payload.ctc_min_lpa = updates.ctcMinLpa;
    if (updates.ctcMaxLpa !== undefined) payload.ctc_max_lpa = updates.ctcMaxLpa;
    if (updates.ctcFinalLpa !== undefined) payload.ctc_final_lpa = updates.ctcFinalLpa;
    if (updates.visitDate !== undefined) payload.visit_date = updates.visitDate;
    if (updates.roundsConducted !== undefined) payload.rounds_conducted = updates.roundsConducted;
    if (updates.mouStatus !== undefined) payload.mou_status = updates.mouStatus;
    if (updates.reportingNotes !== undefined) payload.reporting_notes = updates.reportingNotes;
    if (updates.registrationInstructions !== undefined) payload.registration_instructions = updates.registrationInstructions;
    if (updates.requiredDocuments !== undefined) payload.required_documents = updates.requiredDocuments;
    if (updates.location !== undefined) payload.location = updates.location;
    if (updates.mode !== undefined) payload.mode = updates.mode;
    if (updates.dressCode !== undefined) payload.dress_code = updates.dressCode;
    if (updates.criteria !== undefined) payload.criteria = updates.criteria;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.previewDigest !== undefined) {
      payload.criteria_preview_digest = updates.previewDigest;
      payload.criteria_previewed_at = updates.previewDigest ? payload.updated_at : null;
    }
    payload.updated_at = new Date().toISOString();

    const result = await db.collection("drives").updateOne(
      { tenant_id: tenantId, id: driveId, deleted_at: null },
      { $set: payload },
    );

    if (result.matchedCount === 0) {
      throw new AppError("DRIVE_UPDATE_FAILED", "Drive not found", 500);
    }

    return this.getDriveById(tenantId, driveId);
  },

  async softDeleteDrive(tenantId: string, driveId: string) {
    const db = await getMongoDb();
    const result = await db.collection("drives").updateOne(
      { tenant_id: tenantId, id: driveId, deleted_at: null },
      { $set: { status: "cancelled", deleted_at: new Date().toISOString() } },
    );

    if (result.matchedCount === 0) {
      throw new AppError("DRIVE_DELETE_FAILED", "Drive not found", 500);
    }
  },

  async getDriveCriteria(tenantId: string, driveId: string) {
    const db = await getMongoDb();
    const data = await db.collection("drives").findOne(
      { tenant_id: tenantId, id: driveId, deleted_at: null },
      { projection: { _id: 0, id: 1, criteria: 1 } },
    );

    if (!data) {
      throw new AppError("DRIVE_NOT_FOUND", "Drive not found", 404);
    }

    return {
      id: String(data.id),
      criteria: (data.criteria ?? {}) as DriveCriteria,
    };
  },

  async listStudentsForEligibility(tenantId: string, criteria: DriveCriteria) {
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { tenant_id: tenantId };
    const maxActiveBacklogs = criteria.maxActiveBacklogs ?? criteria.maxBacklogs;

    if (criteria.minCgpa !== undefined) {
      filter.cgpa = { ...(filter.cgpa as Record<string, unknown> ?? {}), $gte: criteria.minCgpa };
    }
    if (maxActiveBacklogs !== undefined) {
      filter.backlogs = { $lte: maxActiveBacklogs };
    }
    if (criteria.maxTotalBacklogs !== undefined) {
      // Optional field; when missing, compute-time checks still apply.
      filter.backlogs_total = { $lte: criteria.maxTotalBacklogs };
    }
    if (criteria.minAttendance !== undefined) {
      filter.attendance_pct = { $gte: criteria.minAttendance };
    }
    if (criteria.branches && criteria.branches.length > 0) {
      filter.branch = { $in: criteria.branches };
    }

    const students = await db.collection("students").find(
      filter,
      { projection: { _id: 0, id: 1, user_id: 1, roll_number: 1, branch: 1, batch: 1, cgpa: 1, backlogs: 1, backlogs_total: 1, attendance_pct: 1, readiness_score: 1 } },
    ).sort({ cgpa: -1, id: 1 }).toArray();

    return enrichStudents(tenantId, students as unknown as StudentEligibilityRow[]);
  },

  async listStudentsForEligibilityPool(tenantId: string) {
    const db = await getMongoDb();
    const students = await db.collection("students").find(
      { tenant_id: tenantId },
      {
        projection: {
          _id: 0,
          id: 1,
          user_id: 1,
          roll_number: 1,
          branch: 1,
          batch: 1,
          cgpa: 1,
          backlogs: 1,
          backlogs_total: 1,
          attendance_pct: 1,
          readiness_score: 1,
        },
      },
    ).sort({ cgpa: -1, id: 1 }).toArray();

    return enrichStudents(tenantId, students as unknown as StudentEligibilityRow[]);
  },

  async listPlacedStudentIds(tenantId: string) {
    const db = await getMongoDb();
    const rows = await db.collection("students").find(
      { tenant_id: tenantId, "profile_data.placementStatus.isPlaced": true },
      { projection: { _id: 0, id: 1 } },
    ).toArray();
    return rows.map((row) => String(row.id));
  },

  async getEligibilityOverrideMap(tenantId: string, driveId: string) {
    const db = await getMongoDb();
    const rows = await db.collection("drive_results").find(
      { tenant_id: tenantId, drive_id: driveId, "eligibility_override.decision": { $in: ["eligible", "not_eligible"] } },
      { projection: { _id: 0, student_id: 1, eligibility_override: 1 } },
    ).toArray();

    const map = new Map<string, "eligible" | "not_eligible">();
    rows.forEach((row) => {
      const override = (row.eligibility_override ?? null) as null | { decision?: unknown };
      const decision = String(override?.decision ?? "");
      if (decision === "eligible" || decision === "not_eligible") {
        map.set(String(row.student_id), decision);
      }
    });
    return map;
  },

  async replaceDriveResults(tenantId: string, driveId: string, studentIds: string[]) {
    // Backwards-compatible name: this now merges eligibility without deleting outcomes.
    return this.syncDriveEligibility(tenantId, driveId, studentIds);
  },

  async syncDriveEligibility(tenantId: string, driveId: string, eligibleStudentIds: string[]) {
    const db = await getMongoDb();
    const now = new Date().toISOString();
    const eligibleSet = new Set(eligibleStudentIds.map(String));

    const existing = await db.collection("drive_results").find(
      { tenant_id: tenantId, drive_id: driveId },
      { projection: { _id: 0, student_id: 1, status: 1, outcome: 1, eligibility_override: 1, application_state: 1 } },
    ).toArray();
    const statusByStudent = new Map(existing.map((row) => [String(row.student_id), String(row.status ?? "")]));
    const applicationStateByStudent = new Map(existing.map((row) => [String(row.student_id), deriveApplicationState(row as Record<string, unknown>)]));

    const overrideByStudent = new Map<string, "eligible" | "not_eligible">();
    existing.forEach((row) => {
      const override = (row.eligibility_override ?? null) as null | { decision?: unknown };
      const decision = String(override?.decision ?? "");
      if (decision === "eligible" || decision === "not_eligible") {
        overrideByStudent.set(String(row.student_id), decision);
      }
    });

    // Apply overrides to the computed eligible set.
    for (const [studentId, decision] of overrideByStudent.entries()) {
      if (decision === "eligible") eligibleSet.add(studentId);
      if (decision === "not_eligible") eligibleSet.delete(studentId);
    }

    const bulkOps: Array<Record<string, unknown>> = [];

    // Upsert eligible rows (preserve applied status).
    for (const studentId of eligibleSet) {
      const currentStatus = statusByStudent.get(studentId) as DriveResultStatus | undefined;
      const nextStatus: DriveResultStatus = currentStatus === "applied" ? "applied" : "eligible";

      bulkOps.push({
        updateOne: {
          filter: { tenant_id: tenantId, drive_id: driveId, student_id: studentId },
          update: {
            $set: {
              status: nextStatus,
              application_state: applicationStateByStudent.get(studentId) ?? "not_applied",
              updated_at: now,
            },
            $setOnInsert: {
              id: randomUUID(),
              tenant_id: tenantId,
              drive_id: driveId,
              student_id: studentId,
              status: nextStatus,
              application_state: applicationStateByStudent.get(studentId) ?? "not_applied",
              outcome: "pending",
              remarks: null,
              eligibility_override: null,
              created_at: now,
              updated_at: now,
            },
          },
          upsert: true,
        },
      });
    }

    // Mark previously-eligible rows that are now ineligible as not_eligible (only if they never progressed).
    const toMarkNotEligible = existing
      .filter((row) => {
        const studentId = String(row.student_id);
        if (eligibleSet.has(studentId)) return false;
        const status = String(row.status ?? "") as DriveResultStatus;
        const outcome = String(row.outcome ?? "");
        const applicationState = applicationStateByStudent.get(studentId) ?? "not_applied";
        if (status === "applied") return false; // Keep applied rows stable across recomputes.
        if (applicationState === "withdrawn") return false;
        if (outcome !== "pending") return false; // Preserve progressed outcomes.
        return status === "eligible";
      })
      .map((row) => String(row.student_id));

    if (toMarkNotEligible.length > 0) {
      bulkOps.push({
        updateMany: {
          filter: {
            tenant_id: tenantId,
            drive_id: driveId,
            student_id: { $in: toMarkNotEligible },
          },
          update: { $set: { status: "not_eligible", updated_at: now } },
        },
      });
    }

    if (bulkOps.length > 0) {
      await db.collection("drive_results").bulkWrite(bulkOps as any);
    }
  },

  async markDriveApplied(
    tenantId: string,
    driveId: string,
    studentId: string,
    resumeSnapshot?: ResumeSnapshotWriteInput | null,
  ) {
    const db = await getMongoDb();
    const now = new Date().toISOString();

    await db.collection("drive_results").updateOne(
      { tenant_id: tenantId, drive_id: driveId, student_id: studentId },
      {
        $set: {
          status: "applied",
          application_state: "applied",
          ...(resumeSnapshot ? {
            resume_snapshot_provider: resumeSnapshot.provider,
            resume_drive_file_id_at_application: resumeSnapshot.fileId ?? null,
            resume_drive_web_link_at_application: resumeSnapshot.webLink,
            resume_filename_at_application: resumeSnapshot.filename ?? null,
            resume_uploaded_at_application: resumeSnapshot.uploadedAt ?? null,
            resume_snapshot_taken_at: now,
          } : {}),
          updated_at: now,
        },
        $setOnInsert: {
          id: randomUUID(),
          tenant_id: tenantId,
          drive_id: driveId,
          student_id: studentId,
          outcome: "pending",
          remarks: null,
          created_at: now,
        },
      },
      { upsert: true },
    );
  },

  async getDriveResultForStudent(tenantId: string, driveId: string, studentId: string): Promise<DriveResultRowRecord | null> {
    const db = await getMongoDb();
    const row = await db.collection("drive_results").findOne(
      { tenant_id: tenantId, drive_id: driveId, student_id: studentId },
      {
        projection: {
          _id: 0,
          id: 1,
          student_id: 1,
          status: 1,
          application_state: 1,
          outcome: 1,
          result_released_at: 1,
          offer_letter_url: 1,
          offer_letter_reference: 1,
        },
      },
    );

    if (!row) return null;

    return {
      id: String(row.id),
      studentId: String(row.student_id),
      status: String(row.status) as DriveResultRowRecord["status"],
      applicationState: deriveApplicationState(row as Record<string, unknown>),
      outcome: String(row.outcome) as DriveResultRowRecord["outcome"],
      resultReleasedAt: row.result_released_at ? String(row.result_released_at) : null,
      offerLetterUrl: row.offer_letter_url ? String(row.offer_letter_url) : null,
      offerLetterReference: row.offer_letter_reference ? String(row.offer_letter_reference) : null,
    };
  },

  async updateDriveEligibleCount(tenantId: string, driveId: string, count: number) {
    const db = await getMongoDb();
    const result = await db.collection("drives").updateOne(
      { tenant_id: tenantId, id: driveId, deleted_at: null },
      { $set: { eligible_count: count } },
    );

    if (result.matchedCount === 0) {
      throw new AppError("DRIVE_COUNT_UPDATE_FAILED", "Drive not found", 500);
    }
  },

  async recountDriveEligibleCount(tenantId: string, driveId: string) {
    const db = await getMongoDb();
    const count = await db.collection("drive_results").countDocuments({
      tenant_id: tenantId,
      drive_id: driveId,
      status: { $in: ["eligible", "applied"] },
      application_state: { $ne: "withdrawn" },
    });
    await this.updateDriveEligibleCount(tenantId, driveId, count);
    return count;
  },

  async setEligibilityOverride(params: {
    tenantId: string;
    driveId: string;
    studentId: string;
    decision: "eligible" | "not_eligible";
    reason: string;
    actorUserId: string;
    actorEmail: string;
  }) {
    const db = await getMongoDb();
    const now = new Date().toISOString();

    await db.collection("drive_results").updateOne(
      { tenant_id: params.tenantId, drive_id: params.driveId, student_id: params.studentId },
      {
        $set: {
          status: params.decision,
          application_state: "not_applied",
          eligibility_override: {
            decision: params.decision,
            reason: params.reason,
            actor_user_id: params.actorUserId,
            actor_email: params.actorEmail,
            created_at: now,
          },
          updated_at: now,
        },
        $setOnInsert: {
          id: randomUUID(),
          tenant_id: params.tenantId,
          drive_id: params.driveId,
          student_id: params.studentId,
          application_state: "not_applied",
          outcome: "pending",
          remarks: null,
          created_at: now,
          updated_at: now,
        },
      },
      { upsert: true },
    );

    return this.recountDriveEligibleCount(params.tenantId, params.driveId);
  },

  async clearEligibilityOverride(params: { tenantId: string; driveId: string; studentId: string }) {
    const db = await getMongoDb();
    const now = new Date().toISOString();

    await db.collection("drive_results").updateOne(
      { tenant_id: params.tenantId, drive_id: params.driveId, student_id: params.studentId },
      {
        $unset: { eligibility_override: "" },
        $set: { updated_at: now },
      },
    );

    // After clearing, a recompute should be run to restore deterministic status.
    return this.recountDriveEligibleCount(params.tenantId, params.driveId);
  },

  async createEligibilitySnapshot(
    tenantId: string,
    driveId: string,
    input: {
      criteria: DriveCriteria;
      totalStudents: number;
      eligibleCount: number;
      ineligibleCount: number;
      reasons: EligibilityReasonCount[];
      computedBy: string;
      branchBreakdown?: Array<{ branch: string; eligibleCount: number; ineligibleCount: number; totalStudents: number }>;
      sampleExcludedStudents?: Array<{ studentId: string; fullName: string; branch: string; cgpa: number; attendancePct: number; reasons: string[] }>;
      previewDigest?: string;
    },
  ) {
    const db = await getMongoDb();
    const latest = await db.collection("drive_eligibility_snapshots").findOne(
      { tenant_id: tenantId, drive_id: driveId },
      { projection: { _id: 0, version: 1 }, sort: { version: -1 } },
    );

    const version = Number(latest?.version ?? 0) + 1;
    const now = new Date().toISOString();
    const snapshotId = randomUUID();

    await db.collection("drive_eligibility_snapshots").insertOne({
      id: snapshotId,
      tenant_id: tenantId,
      drive_id: driveId,
      version,
      criteria: input.criteria,
      total_students: input.totalStudents,
      eligible_count: input.eligibleCount,
      ineligible_count: input.ineligibleCount,
      reasons: input.reasons,
      branch_breakdown: input.branchBreakdown ?? [],
      sample_excluded_students: input.sampleExcludedStudents ?? [],
      preview_digest: input.previewDigest ?? null,
      computed_by: input.computedBy,
      computed_at: now,
      created_at: now,
    });

    await db.collection("drives").updateOne(
      { tenant_id: tenantId, id: driveId, deleted_at: null },
      {
        $set: {
          latest_eligibility_version: version,
          latest_eligibility_computed_at: now,
          criteria_preview_digest: input.previewDigest ?? null,
          criteria_previewed_at: input.previewDigest ? now : null,
          updated_at: now,
        },
      },
    );

    return {
      id: snapshotId,
      driveId,
      version,
      criteria: input.criteria,
      totalStudents: input.totalStudents,
      eligibleCount: input.eligibleCount,
      ineligibleCount: input.ineligibleCount,
      reasons: input.reasons,
      computedAt: now,
      computedBy: input.computedBy,
      branchBreakdown: input.branchBreakdown ?? [],
      sampleExcludedStudents: input.sampleExcludedStudents ?? [],
      previewDigest: input.previewDigest ?? undefined,
    } satisfies DriveEligibilitySnapshot;
  },

  async listEligibilitySnapshots(tenantId: string, driveId: string, limit = 10) {
    const db = await getMongoDb();
    const rows = await db.collection("drive_eligibility_snapshots").find(
      { tenant_id: tenantId, drive_id: driveId },
      {
        projection: {
          _id: 0,
          id: 1,
          drive_id: 1,
          version: 1,
          criteria: 1,
          total_students: 1,
          eligible_count: 1,
          ineligible_count: 1,
          reasons: 1,
          branch_breakdown: 1,
          sample_excluded_students: 1,
          preview_digest: 1,
          computed_at: 1,
          computed_by: 1,
        },
      },
    ).sort({ version: -1 }).limit(limit).toArray();

    return rows.map((row) => ({
      id: String(row.id),
      driveId: String(row.drive_id),
      version: Number(row.version ?? 0),
      criteria: (row.criteria ?? {}) as DriveCriteria,
      totalStudents: Number(row.total_students ?? 0),
      eligibleCount: Number(row.eligible_count ?? 0),
      ineligibleCount: Number(row.ineligible_count ?? 0),
      reasons: Array.isArray(row.reasons) ? (row.reasons as EligibilityReasonCount[]) : [],
      branchBreakdown: Array.isArray(row.branch_breakdown)
        ? row.branch_breakdown.map((item) => ({
          branch: String((item as Record<string, unknown>).branch ?? ""),
          eligibleCount: Number((item as Record<string, unknown>).eligibleCount ?? 0),
          ineligibleCount: Number((item as Record<string, unknown>).ineligibleCount ?? 0),
          totalStudents: Number((item as Record<string, unknown>).totalStudents ?? 0),
        }))
        : [],
      sampleExcludedStudents: Array.isArray(row.sample_excluded_students)
        ? row.sample_excluded_students.map((item) => ({
          studentId: String((item as Record<string, unknown>).studentId ?? ""),
          fullName: String((item as Record<string, unknown>).fullName ?? ""),
          branch: String((item as Record<string, unknown>).branch ?? ""),
          cgpa: Number((item as Record<string, unknown>).cgpa ?? 0),
          attendancePct: Number((item as Record<string, unknown>).attendancePct ?? 0),
          reasons: Array.isArray((item as Record<string, unknown>).reasons)
            ? ((item as Record<string, unknown>).reasons as unknown[]).map((reason) => String(reason))
            : [],
        }))
        : [],
      previewDigest: row.preview_digest ? String(row.preview_digest) : undefined,
      computedAt: String(row.computed_at ?? ""),
      computedBy: String(row.computed_by ?? ""),
    })) satisfies DriveEligibilitySnapshot[];
  },

  async listDriveResults(tenantId: string, driveId: string) {
    const db = await getMongoDb();
    const rows = await db.collection("drive_results").find(
      { tenant_id: tenantId, drive_id: driveId },
      {
        projection: {
          _id: 0,
          student_id: 1,
          status: 1,
          application_state: 1,
          outcome: 1,
          remarks: 1,
          registered: 1,
          appeared: 1,
          rounds: 1,
          shortlisted_round: 1,
          offer_date: 1,
          designation_offered: 1,
          final_ctc_lpa: 1,
          joining_status: 1,
          offer_letter_reference: 1,
          offer_letter_url: 1,
          joining_letter_url: 1,
          selection_source: 1,
          verification_status: 1,
          source_note: 1,
          non_placement_reason: 1,
          action_plan: 1,
          verified_by: 1,
          verified_at: 1,
          result_released_at: 1,
          result_released_by: 1,
          result_notification_status: 1,
          result_notification_communication_id: 1,
          offer_letter_shared_at: 1,
          offer_letter_shared_by: 1,
          student_result_viewed_at: 1,
          created_at: 1,
          updated_at: 1,
        },
      },
    ).sort({ updated_at: -1 }).toArray();

    const studentIds = rows.map((row) => String(row.student_id));
    if (studentIds.length === 0) return [];

    const students = await db.collection("students").find(
      { tenant_id: tenantId, id: { $in: studentIds } },
      { projection: { _id: 0, id: 1, user_id: 1, roll_number: 1, branch: 1, batch: 1, cgpa: 1, backlogs: 1, backlogs_total: 1, attendance_pct: 1, readiness_score: 1 } },
    ).toArray();

    const enrichedStudents = await enrichStudents(
      tenantId,
      students as unknown as StudentEligibilityRow[],
    );
    const studentMap = new Map(enrichedStudents.map((s) => [s.id, s]));

    return rows
      .map((row) => {
        const student = studentMap.get(String(row.student_id));
        if (!student) return null;
        return {
          ...student,
          status: String(row.status),
          applicationState: deriveApplicationState(row as Record<string, unknown>),
          outcome: String(row.outcome),
          remarks: row.remarks ? String(row.remarks) : null,
          registered: row.registered === undefined || row.registered === null ? null : Boolean(row.registered),
          appeared: row.appeared === undefined || row.appeared === null ? null : Boolean(row.appeared),
          rounds: normalizeRounds(row.rounds),
          shortlistedRound: row.shortlisted_round ? String(row.shortlisted_round) : null,
          offerDate: row.offer_date ? String(row.offer_date) : null,
          designationOffered: row.designation_offered ? String(row.designation_offered) : null,
          finalCtcLpa: row.final_ctc_lpa === undefined || row.final_ctc_lpa === null ? null : Number(row.final_ctc_lpa),
          joiningStatus: row.joining_status ? String(row.joining_status) : "pending",
          offerLetterReference: row.offer_letter_reference ? String(row.offer_letter_reference) : null,
          offerLetterUrl: row.offer_letter_url ? String(row.offer_letter_url) : null,
          joiningLetterUrl: row.joining_letter_url ? String(row.joining_letter_url) : null,
          selectionSource: row.selection_source ? String(row.selection_source) : "on_campus",
          verificationStatus: row.verification_status ? String(row.verification_status) : "pending",
          sourceNote: row.source_note ? String(row.source_note) : null,
          nonPlacementReason: row.non_placement_reason ? String(row.non_placement_reason) : null,
          actionPlan: row.action_plan ? String(row.action_plan) : null,
          verifiedBy: row.verified_by ? String(row.verified_by) : null,
          verifiedAt: row.verified_at ? String(row.verified_at) : null,
          resultReleasedAt: row.result_released_at ? String(row.result_released_at) : null,
          resultReleasedBy: row.result_released_by ? String(row.result_released_by) : null,
          resultNotificationStatus: row.result_notification_status ? String(row.result_notification_status) : null,
          resultNotificationCommunicationId: row.result_notification_communication_id ? String(row.result_notification_communication_id) : null,
          offerLetterSharedAt: row.offer_letter_shared_at ? String(row.offer_letter_shared_at) : null,
          offerLetterSharedBy: row.offer_letter_shared_by ? String(row.offer_letter_shared_by) : null,
          studentResultViewedAt: row.student_result_viewed_at ? String(row.student_result_viewed_at) : null,
          updatedAt: row.updated_at ? String(row.updated_at) : String(row.created_at ?? ""),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  },

  async upsertDriveResults(tenantId: string, driveId: string, updates: DriveResultWrite[]) {
    const db = await getMongoDb();
    const now = new Date().toISOString();
    const bulkOps = updates.map((update) => ({
      updateOne: {
        filter: { tenant_id: tenantId, drive_id: driveId, student_id: update.studentId },
        update: {
          $set: {
            status: update.status,
            application_state: update.applicationState ?? (update.status === "applied" ? "applied" : "not_applied"),
            outcome: update.outcome,
            remarks: update.remarks ?? null,
            registered: update.registered ?? null,
            appeared: update.appeared ?? null,
            rounds: (update.rounds ?? []).map((round) => ({
              key: round.key,
              label: round.label,
              stage_type: round.stageType,
              status: round.status,
              decided_at: round.decidedAt ?? null,
              released_at: round.releasedAt ?? null,
              notes: round.notes ?? null,
            })),
            shortlisted_round: update.shortlistedRound ?? null,
            offer_date: update.offerDate ?? null,
            designation_offered: update.designationOffered ?? null,
            final_ctc_lpa: update.finalCtcLpa ?? null,
            joining_status: update.joiningStatus ?? "pending",
            offer_letter_reference: update.offerLetterReference ?? null,
            offer_letter_url: update.offerLetterUrl ?? null,
            joining_letter_url: update.joiningLetterUrl ?? null,
            selection_source: update.selectionSource ?? "on_campus",
            verification_status: update.verificationStatus ?? "pending",
            source_note: update.sourceNote ?? null,
            non_placement_reason: update.nonPlacementReason ?? null,
            action_plan: update.actionPlan ?? null,
            verified_by: update.verificationStatus === "verified" ? "tpo" : null,
            verified_at: update.verificationStatus === "verified" ? now : null,
            updated_at: now,
          },
          $setOnInsert: {
            id: randomUUID(),
            tenant_id: tenantId,
            drive_id: driveId,
            student_id: update.studentId,
            created_at: now,
          },
        },
        upsert: true,
      },
    }));

    if (bulkOps.length > 0) {
      await db.collection("drive_results").bulkWrite(bulkOps);
    }
  },

  async updateDriveStatus(
    tenantId: string,
    driveId: string,
    status: DriveLifecycle,
  ) {
    const db = await getMongoDb();
    const result = await db.collection("drives").updateOne(
      { tenant_id: tenantId, id: driveId, deleted_at: null },
      { $set: { status, updated_at: new Date().toISOString() } },
    );

    if (result.matchedCount === 0) {
      throw new AppError("DRIVE_STATUS_UPDATE_FAILED", "Drive not found", 500);
    }
  },

  async updateDriveResultIntake(tenantId: string, driveId: string, intake: DriveResultIntakeInput) {
    const db = await getMongoDb();
    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (intake.source !== undefined) payload.result_source = intake.source ?? null;
    if (intake.receivedAt !== undefined) payload.result_received_at = intake.receivedAt ?? null;
    if (intake.receivedBy !== undefined) payload.result_received_by = intake.receivedBy ?? null;
    if (intake.companyResultReference !== undefined) payload.company_result_reference = intake.companyResultReference ?? null;
    if (intake.attachmentNote !== undefined) payload.result_attachment_note = intake.attachmentNote ?? null;

    const result = await db.collection("drives").updateOne(
      { tenant_id: tenantId, id: driveId, deleted_at: null },
      { $set: payload },
    );

    if (result.matchedCount === 0) {
      throw new AppError("DRIVE_UPDATE_FAILED", "Drive not found", 500);
    }
  },

  async updateDriveResultReleaseStatus(
    tenantId: string,
    driveId: string,
    updates: DriveResultReleaseStatusUpdate[],
  ) {
    if (updates.length === 0) return;
    const db = await getMongoDb();
    const now = new Date().toISOString();
    const bulkOps = updates.map((update) => {
      const setPayload: Record<string, unknown> = {
        updated_at: now,
      };

      if (update.resultReleasedAt !== undefined) setPayload.result_released_at = update.resultReleasedAt ?? null;
      if (update.resultReleasedBy !== undefined) setPayload.result_released_by = update.resultReleasedBy ?? null;
      if (update.resultNotificationStatus !== undefined) setPayload.result_notification_status = update.resultNotificationStatus ?? null;
      if (update.resultNotificationCommunicationId !== undefined) {
        setPayload.result_notification_communication_id = update.resultNotificationCommunicationId ?? null;
      }
      if (update.offerLetterSharedAt !== undefined) setPayload.offer_letter_shared_at = update.offerLetterSharedAt ?? null;
      if (update.offerLetterSharedBy !== undefined) setPayload.offer_letter_shared_by = update.offerLetterSharedBy ?? null;

      return {
        updateOne: {
          filter: { tenant_id: tenantId, drive_id: driveId, student_id: update.studentId },
          update: { $set: setPayload },
        },
      };
    });

    await db.collection("drive_results").bulkWrite(bulkOps);
  },

  async listDriveReleaseStatusRows(tenantId: string, driveId: string) {
    const rows = await this.listDriveResults(tenantId, driveId);
    return rows
      .filter((row) => row.outcome === "selected" || row.outcome === "rejected")
      .map((row) => ({
        studentId: row.id,
        fullName: row.fullName,
        email: row.email,
        outcome: row.outcome as DriveResultReleaseStatusRow["outcome"],
        resultReleasedAt: row.resultReleasedAt ?? null,
        resultReleasedBy: row.resultReleasedBy ?? null,
        resultNotificationStatus: (row.resultNotificationStatus ?? null) as DriveResultReleaseStatusRow["resultNotificationStatus"],
        resultNotificationCommunicationId: row.resultNotificationCommunicationId ?? null,
        offerLetterReference: row.offerLetterReference ?? null,
        offerLetterUrl: row.offerLetterUrl ?? null,
        offerLetterSharedAt: row.offerLetterSharedAt ?? null,
        offerLetterSharedBy: row.offerLetterSharedBy ?? null,
        updatedAt: row.updatedAt ?? null,
      })) satisfies DriveResultReleaseStatusRow[];
  },

  async listDriveResumeExportRows(tenantId: string, driveId: string) {
    const db = await getMongoDb();
    const rows = await db.collection("drive_results").find(
      {
        tenant_id: tenantId,
        drive_id: driveId,
        application_state: { $in: ["applied", "absent"] },
      },
      {
        projection: {
          _id: 0,
          student_id: 1,
          application_state: 1,
          outcome: 1,
          resume_filename_at_application: 1,
          resume_drive_web_link_at_application: 1,
        },
      },
    ).toArray();

    const studentIds = rows.map((row) => String(row.student_id));
    if (studentIds.length === 0) return [] satisfies DriveResumeExportRow[];

    const students = await db.collection("students").find(
      {
        tenant_id: tenantId,
        id: { $in: studentIds },
      },
      {
        projection: {
          _id: 0,
          id: 1,
          user_id: 1,
          roll_number: 1,
          branch: 1,
          batch: 1,
          cgpa: 1,
          profile_data: 1,
        },
      },
    ).toArray();

    const users = await db.collection("users").find(
      {
        tenant_id: tenantId,
        id: { $in: students.map((student) => String(student.user_id)) },
      },
      {
        projection: {
          _id: 0,
          id: 1,
          email: 1,
          full_name: 1,
        },
      },
    ).toArray();

    const studentMap = new Map(students.map((student) => [String(student.id), student]));
    const userMap = new Map(users.map((user) => [String(user.id), user]));

    return rows
      .map((row) => {
        const student = studentMap.get(String(row.student_id));
        const user = student ? userMap.get(String(student.user_id)) : null;
        const profileData = student?.profile_data && typeof student.profile_data === "object"
          ? student.profile_data as Record<string, unknown>
          : {};
        const resumeUrl = String(
          row.resume_drive_web_link_at_application
          ?? profileData.resumeDriveWebLink
          ?? profileData.resumeUrl
          ?? "",
        ).trim();
        if (!student || !user || !resumeUrl) return null;

        return {
          studentId: String(row.student_id),
          fullName: String(user.full_name ?? ""),
          email: String(user.email ?? ""),
          rollNumber: String(student.roll_number ?? ""),
          branch: String(student.branch ?? ""),
          batch: String(student.batch ?? ""),
          cgpa: Number(student.cgpa ?? 0),
          applicationState: deriveApplicationState(row as Record<string, unknown>),
          outcome: String(row.outcome ?? "pending") as DriveResumeExportRow["outcome"],
          resumeFilename: row.resume_filename_at_application
            ? String(row.resume_filename_at_application)
            : profileData.resumeFilename
              ? String(profileData.resumeFilename)
              : null,
          resumeUrl,
        } satisfies DriveResumeExportRow;
      })
      .filter((row): row is DriveResumeExportRow => row !== null);
  },

  async markDriveWithdrawn(tenantId: string, driveId: string, studentId: string) {
    const db = await getMongoDb();
    const now = new Date().toISOString();

    await db.collection("drive_results").updateOne(
      { tenant_id: tenantId, drive_id: driveId, student_id: studentId },
      {
        $set: {
          application_state: "withdrawn",
          status: "eligible",
          appeared: false,
          updated_at: now,
        },
      },
    );
  },
};
