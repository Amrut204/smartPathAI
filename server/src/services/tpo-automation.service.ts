import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { DriveRepository } from "../repositories/drive.repository.js";
import { buildStudentDeclarationStatus } from "../utils/student-declaration.js";
import { buildStudentProfileSummary } from "../utils/student-profile.js";
import { getMongoDb } from "../utils/mongodb.js";
import { CommunicationService } from "./communication.service.js";
import { ReportService, type ReportFilters, type ReportType } from "./report.service.js";
import { TpoControlCenterService } from "./tpo-control-center.service.js";

export type TpoAutomationType =
  | "eligible_not_applied"
  | "blocked_profile_followup"
  | "weekly_tpo_digest"
  | "scheduled_report_pack"
  | "unplaced_intervention_refresh"
  | "result_notification_review";

export type TpoAutomationRunStatus =
  | "draft"
  | "ready"
  | "sent"
  | "completed"
  | "failed"
  | "dismissed";

export type TpoAutomationTriggerSource =
  | "scheduled"
  | "manual"
  | "result_release"
  | "drive_update";

type AutomationRunItemInput = {
  entity_type: string;
  entity_id: string;
  reason_key: string;
  reason_label: string;
  payload: Record<string, unknown>;
  status?: "pending" | "sent" | "dismissed" | "completed";
};

type StoredRun = {
  id: string;
  automationType: TpoAutomationType;
  triggerSource: TpoAutomationTriggerSource;
  status: TpoAutomationRunStatus;
  scope: Record<string, unknown>;
  dateBucket: string;
  idempotencyKey: string;
  explanation: string;
  counts: Record<string, number>;
  filters: Record<string, unknown>;
  audienceSummary: string | null;
  preview: Record<string, unknown>;
  linkedCommunicationId: string | null;
  linkedReportPackId: string | null;
  releasedAt: string | null;
  releasedBy: string | null;
  dismissedAt: string | null;
  dismissedBy: string | null;
  completedAt: string | null;
  failedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type StoredRunItem = {
  id: string;
  runId: string;
  automationType: TpoAutomationType;
  entityType: string;
  entityId: string;
  reasonKey: string;
  reasonLabel: string;
  status: "pending" | "sent" | "dismissed" | "completed";
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type StudentBlockerState = {
  studentId: string;
  userId: string;
  fullName: string;
  email: string;
  branch: string;
  batch: string;
  hasResume: boolean;
  isCertified: boolean;
  isComplete: boolean;
  declarationAccepted: boolean;
  profileCompletenessPct: number;
  missingFields: string[];
  readinessScore: number;
  eligibleUpcomingDriveCount: number;
  appliedRecently: boolean;
  mockAttempts30d: number;
  lastMockSubmittedAt: string | null;
  placementStatus: {
    isPlaced: boolean;
  };
};

const RUNS_COLLECTION = "tpo_automation_runs";
const RUN_ITEMS_COLLECTION = "tpo_automation_run_items";
const PREFS_COLLECTION = "tpo_automation_preferences";
const ELIGIBLE_REMINDER_WINDOW_DAYS = 3;

let indexesEnsured = false;

function startOfDay(value = new Date()) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function weekBucket(value = new Date()) {
  const day = startOfDay(value);
  const currentDay = day.getDay();
  const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
  day.setDate(day.getDate() + mondayOffset);
  return `week:${toIsoDate(day)}`;
}

function monthBucket(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  return `month:${year}-${month}`;
}

function formatDriveName(drive: { company: string; role: string | null }) {
  return `${drive.company}${drive.role ? ` - ${drive.role}` : ""}`;
}

function daysUntilDrive(dateIso: string): number | null {
  if (!dateIso) return null;
  const target = new Date(dateIso);
  if (Number.isNaN(target.getTime())) return null;
  const today = startOfDay();
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function parseRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mapRun(row: Record<string, unknown>): StoredRun {
  return {
    id: String(row.id),
    automationType: String(row.automation_type) as TpoAutomationType,
    triggerSource: String(row.trigger_source) as TpoAutomationTriggerSource,
    status: String(row.status) as TpoAutomationRunStatus,
    scope: parseRecord(row.scope),
    dateBucket: String(row.date_bucket ?? ""),
    idempotencyKey: String(row.idempotency_key ?? ""),
    explanation: String(row.explanation ?? ""),
    counts: parseRecord(row.counts) as Record<string, number>,
    filters: parseRecord(row.filters),
    audienceSummary: row.audience_summary ? String(row.audience_summary) : null,
    preview: parseRecord(row.preview),
    linkedCommunicationId: row.linked_communication_id ? String(row.linked_communication_id) : null,
    linkedReportPackId: row.linked_report_pack_id ? String(row.linked_report_pack_id) : null,
    releasedAt: row.released_at ? String(row.released_at) : null,
    releasedBy: row.released_by ? String(row.released_by) : null,
    dismissedAt: row.dismissed_at ? String(row.dismissed_at) : null,
    dismissedBy: row.dismissed_by ? String(row.dismissed_by) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    failedReason: row.failed_reason ? String(row.failed_reason) : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? row.created_at ?? ""),
  };
}

function mapRunItem(row: Record<string, unknown>): StoredRunItem {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    automationType: String(row.automation_type) as TpoAutomationType,
    entityType: String(row.entity_type ?? ""),
    entityId: String(row.entity_id ?? ""),
    reasonKey: String(row.reason_key ?? ""),
    reasonLabel: String(row.reason_label ?? ""),
    status: String(row.status ?? "pending") as StoredRunItem["status"],
    payload: parseRecord(row.payload),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? row.created_at ?? ""),
  };
}

async function ensureIndexes() {
  if (indexesEnsured) return;
  const db = await getMongoDb();
  await Promise.all([
    db.collection(RUNS_COLLECTION).createIndex({ tenant_id: 1, id: 1 }, { unique: true }),
    db.collection(RUNS_COLLECTION).createIndex({ tenant_id: 1, idempotency_key: 1 }, { unique: true }),
    db.collection(RUNS_COLLECTION).createIndex({ tenant_id: 1, status: 1, created_at: -1 }),
    db.collection(RUNS_COLLECTION).createIndex({ tenant_id: 1, automation_type: 1, created_at: -1 }),
    db.collection(RUN_ITEMS_COLLECTION).createIndex({ tenant_id: 1, run_id: 1, created_at: 1 }),
    db.collection(RUN_ITEMS_COLLECTION).createIndex({ tenant_id: 1, automation_type: 1, entity_id: 1, created_at: -1 }),
    db.collection(PREFS_COLLECTION).createIndex({ tenant_id: 1 }, { unique: true }),
  ]);
  indexesEnsured = true;
}

async function listActiveTenantIds() {
  const db = await getMongoDb();
  const rows = await db.collection("tenants").find(
    { is_active: true },
    { projection: { _id: 0, id: 1 } },
  ).toArray();
  return rows.map((row) => String(row.id));
}

async function loadRunById(tenantId: string, runId: string) {
  const db = await getMongoDb();
  const row = await db.collection(RUNS_COLLECTION).findOne(
    { tenant_id: tenantId, id: runId },
    { projection: { _id: 0 } },
  );
  return row ? mapRun(row as Record<string, unknown>) : null;
}

async function loadRunItems(tenantId: string, runId: string) {
  const db = await getMongoDb();
  const rows = await db.collection(RUN_ITEMS_COLLECTION).find(
    { tenant_id: tenantId, run_id: runId },
    { projection: { _id: 0 } },
  ).sort({ created_at: 1 }).toArray();
  return rows.map((row) => mapRunItem(row as Record<string, unknown>));
}

async function upsertRun(params: {
  tenantId: string;
  automationType: TpoAutomationType;
  triggerSource: TpoAutomationTriggerSource;
  status: TpoAutomationRunStatus;
  scope: Record<string, unknown>;
  dateBucket: string;
  idempotencyKey: string;
  explanation: string;
  counts: Record<string, number>;
  filters: Record<string, unknown>;
  audienceSummary?: string | null;
  preview?: Record<string, unknown>;
  linkedCommunicationId?: string | null;
  linkedReportPackId?: string | null;
  failedReason?: string | null;
  completedAt?: string | null;
  items?: AutomationRunItemInput[];
}) {
  await ensureIndexes();
  const db = await getMongoDb();
  const now = new Date().toISOString();
  const existing = await db.collection(RUNS_COLLECTION).findOne(
    { tenant_id: params.tenantId, idempotency_key: params.idempotencyKey },
    { projection: { _id: 0, id: 1 } },
  );

  const runId = existing?.id ? String(existing.id) : randomUUID();
  await db.collection(RUNS_COLLECTION).updateOne(
    { tenant_id: params.tenantId, id: runId },
    {
      $set: {
        automation_type: params.automationType,
        trigger_source: params.triggerSource,
        status: params.status,
        scope: params.scope,
        date_bucket: params.dateBucket,
        idempotency_key: params.idempotencyKey,
        explanation: params.explanation,
        counts: params.counts,
        filters: params.filters,
        audience_summary: params.audienceSummary ?? null,
        preview: params.preview ?? {},
        linked_communication_id: params.linkedCommunicationId ?? null,
        linked_report_pack_id: params.linkedReportPackId ?? null,
        failed_reason: params.failedReason ?? null,
        completed_at: params.completedAt ?? null,
        updated_at: now,
      },
      $setOnInsert: {
        id: runId,
        tenant_id: params.tenantId,
        created_at: now,
        released_at: null,
        released_by: null,
        dismissed_at: null,
        dismissed_by: null,
      },
    },
    { upsert: true },
  );

  if (params.items) {
    await db.collection(RUN_ITEMS_COLLECTION).deleteMany({ tenant_id: params.tenantId, run_id: runId });
    if (params.items.length > 0) {
      await db.collection(RUN_ITEMS_COLLECTION).insertMany(
        params.items.map((item) => ({
          id: randomUUID(),
          tenant_id: params.tenantId,
          run_id: runId,
          automation_type: params.automationType,
          entity_type: item.entity_type,
          entity_id: item.entity_id,
          reason_key: item.reason_key,
          reason_label: item.reason_label,
          status: item.status ?? "pending",
          payload: item.payload,
          created_at: now,
          updated_at: now,
        })),
      );
    }
  }

  const run = await loadRunById(params.tenantId, runId);
  if (!run) {
    throw new AppError("AUTOMATION_RUN_MISSING", "Automation run could not be loaded after save.", 500);
  }
  return {
    ...run,
    items: await loadRunItems(params.tenantId, runId),
  };
}

async function buildStudentStates(tenantId: string): Promise<StudentBlockerState[]> {
  const db = await getMongoDb();
  const [students, users, attempts, driveResults] = await Promise.all([
    db.collection("students").find(
      { tenant_id: tenantId },
      {
        projection: {
          _id: 0,
          id: 1,
          user_id: 1,
          profile_data: 1,
          branch: 1,
          batch: 1,
          readiness_score: 1,
        },
      },
    ).toArray(),
    db.collection("users").find(
      { tenant_id: tenantId, role: "student" },
      { projection: { _id: 0, id: 1, full_name: 1, email: 1 } },
    ).toArray(),
    db.collection("student_attempts").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, student_id: 1, submitted_at: 1 } },
    ).toArray(),
    db.collection("drive_results").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, student_id: 1, status: 1, outcome: 1, application_state: 1 } },
    ).toArray(),
  ]);

  const userMap = new Map(users.map((row) => [String(row.id), row]));
  const attemptsByStudent = new Map<string, Array<Record<string, unknown>>>();
  attempts.forEach((row) => {
    const studentId = String(row.student_id ?? "");
    if (!studentId) return;
    const list = attemptsByStudent.get(studentId) ?? [];
    list.push(row as Record<string, unknown>);
    attemptsByStudent.set(studentId, list);
  });
  const driveResultsByStudent = new Map<string, Array<Record<string, unknown>>>();
  driveResults.forEach((row) => {
    const studentId = String(row.student_id ?? "");
    if (!studentId) return;
    const list = driveResultsByStudent.get(studentId) ?? [];
    list.push(row as Record<string, unknown>);
    driveResultsByStudent.set(studentId, list);
  });

  return students.map((student) => {
    const user = userMap.get(String(student.user_id ?? ""));
    const profileSummary = buildStudentProfileSummary({
      student: student as Record<string, unknown>,
      user: {
        full_name: String(user?.full_name ?? ""),
        email: String(user?.email ?? ""),
      },
    });
    const declarationStatus = buildStudentDeclarationStatus({
      student: student as Record<string, unknown>,
      user: {
        full_name: String(user?.full_name ?? ""),
        email: String(user?.email ?? ""),
      },
    });
    const missingFields = profileSummary.missingRequiredFields
      .filter((field) => !field.complete)
      .map((field) => field.label);
    const studentResults = driveResultsByStudent.get(String(student.id)) ?? [];
    const eligibleUpcomingDriveCount = studentResults.filter((row) => String(row.status ?? "") === "eligible").length;
    const appliedRecently = studentResults.some((row) => {
      const state = String(row.application_state ?? "");
      const outcome = String(row.outcome ?? "");
      return ["applied", "shortlisted", "selected", "waitlisted"].includes(state)
        || ["applied", "shortlisted", "selected", "waitlisted"].includes(outcome);
    });
    const studentAttempts = attemptsByStudent.get(String(student.id)) ?? [];
    const mockAttempts30d = studentAttempts.filter((row) => {
      const submittedAt = row.submitted_at ? String(row.submitted_at) : null;
      if (!submittedAt) return false;
      const parsed = new Date(submittedAt);
      return !Number.isNaN(parsed.getTime()) && parsed >= new Date(Date.now() - 30 * 86_400_000);
    }).length;
    const sortedAttemptDates = studentAttempts
      .map((row) => row.submitted_at ? String(row.submitted_at) : null)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => b.localeCompare(a));
    const isPlaced = studentResults.some((row) => String(row.outcome ?? "") === "selected");

    return {
      studentId: String(student.id),
      userId: String(student.user_id ?? ""),
      fullName: String(user?.full_name ?? "Student"),
      email: String(user?.email ?? ""),
      branch: String(student.branch ?? ""),
      batch: String(student.batch ?? ""),
      hasResume: Boolean(profileSummary.studentEditableProfile.resumeDriveWebLink || profileSummary.studentEditableProfile.resumeUrl),
      isCertified: declarationStatus.profileCertification.isCertified,
      isComplete: profileSummary.missingRequiredFields.every((field) => field.complete),
      declarationAccepted: Boolean(declarationStatus.onboarding.acceptedAt),
      profileCompletenessPct: profileSummary.profileCompleteness.pct,
      missingFields,
      readinessScore: Number(student.readiness_score ?? 0),
      eligibleUpcomingDriveCount,
      appliedRecently,
      mockAttempts30d,
      lastMockSubmittedAt: sortedAttemptDates[0] ?? null,
      placementStatus: {
        isPlaced,
      },
    };
  });
}

async function createEligibleNotAppliedRuns(params: {
  tenantId: string;
  triggerSource: TpoAutomationTriggerSource;
  date?: Date;
  driveId?: string;
}) {
  const db = await getMongoDb();
  const date = params.date ?? new Date();
  const dateBucket = toIsoDate(date);
  const cutoff = startOfDay(date);
  cutoff.setDate(cutoff.getDate() + ELIGIBLE_REMINDER_WINDOW_DAYS);
  const todayIso = toIsoDate(startOfDay(date));
  const cutoffIso = toIsoDate(cutoff);

  const drives = await db.collection("drives").find(
    {
      tenant_id: params.tenantId,
      deleted_at: null,
      status: { $in: ["published", "upcoming"] },
      drive_date: { $gte: todayIso, $lte: cutoffIso },
      ...(params.driveId ? { id: params.driveId } : {}),
    },
    {
      projection: {
        _id: 0,
        id: 1,
        company: 1,
        role: 1,
        drive_date: 1,
      },
    },
  ).toArray();

  const studentStates = await buildStudentStates(params.tenantId);
  const stateMap = new Map(studentStates.map((row) => [row.studentId, row]));
  const runs: Array<Awaited<ReturnType<typeof upsertRun>>> = [];

  for (const drive of drives) {
    const rows = await db.collection("drive_results").find(
      {
        tenant_id: params.tenantId,
        drive_id: String(drive.id),
        status: "eligible",
      },
      {
        projection: {
          _id: 0,
          student_id: 1,
          application_state: 1,
        },
      },
    ).toArray();

    const pendingRows = rows.filter((row) => {
      const applicationState = String(row.application_state ?? "");
      return applicationState !== "applied" && applicationState !== "withdrawn" && applicationState !== "absent";
    });
    if (pendingRows.length === 0) continue;

    const pendingStudents = pendingRows
      .map((row) => stateMap.get(String(row.student_id ?? "")))
      .filter((row): row is StudentBlockerState => Boolean(row));
    if (pendingStudents.length === 0) continue;

    const readyCount = pendingStudents.filter((student) => student.hasResume && student.isCertified).length;
    const blockedCount = pendingStudents.length - readyCount;
    const driveName = formatDriveName({
      company: String(drive.company ?? "Drive"),
      role: drive.role ? String(drive.role) : null,
    });
    const daysRemaining = daysUntilDrive(String(drive.drive_date ?? ""));
    const studentIds = pendingStudents.map((student) => student.studentId);

    runs.push(await upsertRun({
      tenantId: params.tenantId,
      automationType: "eligible_not_applied",
      triggerSource: params.triggerSource,
      status: "draft",
      scope: { driveId: String(drive.id) },
      dateBucket,
      idempotencyKey: `${params.tenantId}:eligible_not_applied:${String(drive.id)}:${dateBucket}`,
      explanation: `${pendingStudents.length} eligible student${pendingStudents.length === 1 ? "" : "s"} have not applied for ${driveName}${daysRemaining === null ? "." : ` and the deadline is ${daysRemaining} day(s) away.`}`,
      counts: {
        candidateCount: pendingStudents.length,
        readyCount,
        blockedCount,
      },
      filters: {
        driveId: String(drive.id),
        studentIds,
      },
      audienceSummary: `${pendingStudents.length} eligible students for ${driveName}`,
      preview: {
        title: `Eligible but not applied: ${driveName}`,
        channel: "email",
        subject: `Reminder: you are eligible for ${driveName}`,
        body: `Dear {{student_name}},\n\nYou are currently eligible for ${driveName}.${daysRemaining === null ? "" : ` The drive closes in ${daysRemaining} day(s).`} Please review the drive and complete your application. If your resume or certification is pending, update it immediately so you do not miss the deadline.\n\nRegards,\nPlacement Cell`,
        preset: "eligible-reminder",
        targetPath: `/tpo/communication?mode=email&preset=eligible-reminder&studentIds=${encodeURIComponent(studentIds.join(","))}`,
      },
      items: pendingStudents.map((student) => ({
        entity_type: "student",
        entity_id: student.studentId,
        reason_key: student.hasResume && student.isCertified ? "ready_to_apply" : "blocked_before_apply",
        reason_label: student.hasResume && student.isCertified ? "Ready to apply" : "Blocked before apply",
        payload: {
          fullName: student.fullName,
          email: student.email,
          branch: student.branch,
          batch: student.batch,
          readinessScore: student.readinessScore,
          hasResume: student.hasResume,
          isCertified: student.isCertified,
          missingFields: student.missingFields,
        },
      })),
    }));
  }

  return runs;
}

async function createBlockedProfileRun(params: {
  tenantId: string;
  triggerSource: TpoAutomationTriggerSource;
  date?: Date;
}) {
  const dateBucket = toIsoDate(params.date ?? new Date());
  const students = await buildStudentStates(params.tenantId);
  const blockedStudents = students.filter((student) =>
    !student.hasResume || !student.isCertified || !student.isComplete || !student.declarationAccepted,
  );
  if (blockedStudents.length === 0) return null;

  const studentIds = blockedStudents.map((student) => student.studentId);
  const missingResume = blockedStudents.filter((student) => !student.hasResume).length;
  const uncertified = blockedStudents.filter((student) => !student.isCertified).length;
  const incompleteProfile = blockedStudents.filter((student) => !student.isComplete).length;
  const missingDeclaration = blockedStudents.filter((student) => !student.declarationAccepted).length;

  return upsertRun({
    tenantId: params.tenantId,
    automationType: "blocked_profile_followup",
    triggerSource: params.triggerSource,
    status: "draft",
    scope: { cohort: "tenant" },
    dateBucket,
    idempotencyKey: `${params.tenantId}:blocked_profile_followup:${dateBucket}`,
    explanation: `${blockedStudents.length} students are blocked by profile completion, resume readiness, certification, or declaration issues.`,
    counts: {
      candidateCount: blockedStudents.length,
      missingResume,
      uncertified,
      incompleteProfile,
      missingDeclaration,
    },
    filters: {
      studentIds,
    },
    audienceSummary: `${blockedStudents.length} students need profile follow-up`,
    preview: {
      title: "Blocked profile follow-up",
      channel: "email",
      subject: "Complete your placement profile",
      body: "Dear {{student_name}},\n\nYour placement profile still has pending items that can block eligibility, applications, or results. Please complete your profile, upload your resume, and recertify the profile if needed.\n\nRegards,\nPlacement Cell",
      preset: "profile-completion",
      targetPath: `/tpo/communication?mode=email&preset=profile-completion&studentIds=${encodeURIComponent(studentIds.join(","))}`,
    },
    items: blockedStudents.map((student) => ({
      entity_type: "student",
      entity_id: student.studentId,
      reason_key: !student.hasResume
        ? "missing_resume"
        : !student.isCertified
          ? "uncertified"
          : !student.declarationAccepted
            ? "missing_declaration"
            : "incomplete_profile",
      reason_label: !student.hasResume
        ? "Missing resume"
        : !student.isCertified
          ? "Profile uncertified"
          : !student.declarationAccepted
            ? "Declaration pending"
            : "Incomplete profile",
      payload: {
        fullName: student.fullName,
        email: student.email,
        branch: student.branch,
        batch: student.batch,
        missingFields: student.missingFields,
        profileCompletenessPct: student.profileCompletenessPct,
      },
    })),
  });
}

async function createWeeklyDigestRun(params: {
  tenantId: string;
  triggerSource: TpoAutomationTriggerSource;
  date?: Date;
}) {
  const controlCenter = await TpoControlCenterService.getControlCenter(params.tenantId);
  const dateBucket = weekBucket(params.date ?? new Date());
  const db = await getMongoDb();
  const recipients = await db.collection("users").find(
    {
      tenant_id: params.tenantId,
      role: { $in: ["tpo", "admin"] },
      is_active: true,
    },
    { projection: { _id: 0, id: 1, full_name: 1, email: 1, role: 1 } },
  ).toArray();
  const uniqueRecipients = recipients
    .filter((user, index, list) => user.email && list.findIndex((item) => item.email === user.email) === index);
  if (uniqueRecipients.length === 0) return null;

  const digestLines = [
    `${controlCenter.summary.upcomingDrives} upcoming drive(s) need monitoring.`,
    `${controlCenter.actionCenter.eligibleButNotApplied.length} drive queue(s) still have eligible students who have not applied.`,
    `${controlCenter.blockerSegments.missingResume} students are still missing resumes and ${controlCenter.blockerSegments.uncertified} are uncertified.`,
    `${controlCenter.riskSummary.totalAtRisk} students are at risk, including ${controlCenter.riskSummary.highRisk} high-risk cases.`,
    `${controlCenter.actionCenter.readyButInactive.length} students are ready but inactive.`,
  ];

  return upsertRun({
    tenantId: params.tenantId,
    automationType: "weekly_tpo_digest",
    triggerSource: params.triggerSource,
    status: "draft",
    scope: { frequency: "weekly" },
    dateBucket,
    idempotencyKey: `${params.tenantId}:weekly_tpo_digest:${dateBucket}`,
    explanation: "Weekly digest prepared for placement-office review before sending.",
    counts: {
      recipientCount: uniqueRecipients.length,
      upcomingDrives: controlCenter.summary.upcomingDrives,
      atRiskStudents: controlCenter.riskSummary.totalAtRisk,
      eligibleNotAppliedQueues: controlCenter.actionCenter.eligibleButNotApplied.length,
      readyButInactive: controlCenter.actionCenter.readyButInactive.length,
    },
    filters: {},
    audienceSummary: `${uniqueRecipients.length} placement office recipients`,
    preview: {
      title: "Weekly TPO digest",
      channel: "digest_email",
      subject: `Weekly placement digest - ${dateBucket.replace("week:", "")}`,
      body: ["Placement operations summary:", ...digestLines.map((line) => `- ${line}`)].join("\n"),
      recipients: uniqueRecipients.map((user) => ({
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
      })),
      targetPath: "/tpo/communication?mode=email",
    },
    items: uniqueRecipients.map((user) => ({
      entity_type: "user",
      entity_id: user.id,
      reason_key: "weekly_digest_recipient",
      reason_label: "Weekly digest recipient",
      payload: {
        fullName: user.full_name,
        email: user.email,
        role: user.role,
      },
    })),
  });
}

function defaultScheduledReportFilters(frequency: "weekly" | "monthly"): ReportFilters {
  return frequency === "monthly"
    ? { preset: "academic_year", academicYear: "2025-2026" }
    : { preset: "placement_season", academicYear: "2025-2026" };
}

async function createScheduledReportPackRun(params: {
  tenantId: string;
  triggerSource: TpoAutomationTriggerSource;
  frequency: "weekly" | "monthly";
  date?: Date;
}) {
  const reportTypes: ReportType[] = [
    "final_placement_statistics",
    "monthly_branch_breakdown",
    "unplaced_student_action_report",
    "naac_5_2_progression",
  ];
  const dateBucket = params.frequency === "monthly" ? monthBucket(params.date ?? new Date()) : weekBucket(params.date ?? new Date());
  const filters = defaultScheduledReportFilters(params.frequency);
  const previews = await Promise.all(reportTypes.map((type) => ReportService.preview(params.tenantId, type, filters)));
  const templates = ReportService.getTemplates();

  return upsertRun({
    tenantId: params.tenantId,
    automationType: "scheduled_report_pack",
    triggerSource: params.triggerSource,
    status: "completed",
    scope: { frequency: params.frequency },
    dateBucket,
    idempotencyKey: `${params.tenantId}:scheduled_report_pack:${params.frequency}:${dateBucket}`,
    explanation: `${params.frequency === "monthly" ? "Monthly" : "Weekly"} report pack generated for quick download.`,
    counts: {
      reportCount: previews.length,
      readyCount: previews.filter((preview) => preview.ready).length,
      blockerCount: previews.filter((preview) => !preview.ready).length,
    },
    filters: filters as unknown as Record<string, unknown>,
    audienceSummary: `${previews.length} scheduled exports`,
    preview: {
      title: `${params.frequency === "monthly" ? "Monthly" : "Weekly"} scheduled export pack`,
      channel: "report_pack",
      targetPath: "/tpo/reports",
      items: previews.map((preview) => ({
        reportType: preview.type,
        title: preview.title,
        ready: preview.ready,
        blockers: preview.blockers,
        rowCount: preview.rows.length,
        filters,
        exportFormats: templates.find((template) => template.type === preview.type)?.exportFormats ?? ["xlsx", "csv", "pdf"],
        generatedAt: preview.generatedAt,
      })),
    },
    linkedReportPackId: `${params.frequency}:${dateBucket}`,
    completedAt: new Date().toISOString(),
    items: previews.map((preview) => ({
      entity_type: "report",
      entity_id: preview.type,
      reason_key: "scheduled_report",
      reason_label: preview.ready ? "Scheduled export ready" : "Scheduled export needs follow-up",
      status: "completed",
      payload: {
        reportType: preview.type,
        title: preview.title,
        ready: preview.ready,
        blockers: preview.blockers,
        rowCount: preview.rows.length,
        filters,
        exportFormats: templates.find((template) => template.type === preview.type)?.exportFormats ?? ["xlsx", "csv", "pdf"],
        generatedAt: preview.generatedAt,
      },
    })),
  });
}

async function createUnplacedInterventionRun(params: {
  tenantId: string;
  triggerSource: TpoAutomationTriggerSource;
  date?: Date;
}) {
  const controlCenter = await TpoControlCenterService.getControlCenter(params.tenantId);
  const dateBucket = toIsoDate(params.date ?? new Date());
  const actionCenter = controlCenter.actionCenter;
  const groupedItems = [
    ...actionCenter.readyButInactive.map((student) => ({
      entity_type: "student",
      entity_id: student.studentId,
      reason_key: "high_readiness_unplaced",
      reason_label: "High readiness but unplaced",
      payload: student as unknown as Record<string, unknown>,
    })),
    ...actionCenter.studentsNeedingMockPush.map((student) => ({
      entity_type: "student",
      entity_id: student.studentId,
      reason_key: "low_mock_activity",
      reason_label: "Low mock activity",
      payload: student as unknown as Record<string, unknown>,
    })),
    ...actionCenter.studentsNotUsingResources.map((student) => ({
      entity_type: "student",
      entity_id: student.studentId,
      reason_key: "no_drive_history_or_engagement",
      reason_label: "No recent drive-ready engagement",
      payload: student as unknown as Record<string, unknown>,
    })),
    ...actionCenter.eligibleButNotApplied.flatMap((drive) => drive.students.map((student) => ({
      entity_type: "student",
      entity_id: student.studentId,
      reason_key: "eligible_but_inactive",
      reason_label: "Eligible but inactive",
      payload: {
        ...(student as unknown as Record<string, unknown>),
        driveId: drive.driveId,
        company: drive.company,
        driveDate: drive.driveDate,
      },
    }))),
  ];

  if (groupedItems.length === 0) return null;

  return upsertRun({
    tenantId: params.tenantId,
    automationType: "unplaced_intervention_refresh",
    triggerSource: params.triggerSource,
    status: "ready",
    scope: { cohort: "unplaced" },
    dateBucket,
    idempotencyKey: `${params.tenantId}:unplaced_intervention_refresh:${dateBucket}`,
    explanation: "Unplaced intervention buckets were refreshed from the latest readiness and drive data.",
    counts: {
      candidateCount: groupedItems.length,
      highReadinessUnplaced: actionCenter.readyButInactive.length,
      lowMockActivity: actionCenter.studentsNeedingMockPush.length,
      noDriveHistory: actionCenter.studentsNotUsingResources.length,
      eligibleButInactive: actionCenter.eligibleButNotApplied.reduce((total, drive) => total + drive.students.length, 0),
    },
    filters: { isPlaced: false, needsIntervention: true },
    audienceSummary: `${groupedItems.length} intervention rows`,
    preview: {
      title: "Unplaced intervention refresh",
      channel: "none",
      targetPath: "/tpo/students?mode=ops&view=all&isPlaced=false&needsIntervention=true&sortBy=risk_score&sortDir=desc",
    },
    items: groupedItems,
  });
}

async function recordResultNotificationReview(params: {
  tenantId: string;
  driveId: string;
  selectedCount: number;
  rejectedCount: number;
  communicationIds: string[];
  audience: string;
}) {
  const drive = await DriveRepository.getDriveById(params.tenantId, params.driveId);
  const driveName = formatDriveName({ company: drive.company, role: drive.role });
  const dateBucket = toIsoDate(new Date());
  return upsertRun({
    tenantId: params.tenantId,
    automationType: "result_notification_review",
    triggerSource: "result_release",
    status: "completed",
    scope: { driveId: params.driveId },
    dateBucket,
    idempotencyKey: `${params.tenantId}:result_notification_review:${params.driveId}:${dateBucket}:${params.audience}`,
    explanation: `Result notifications were released for ${driveName}.`,
    counts: {
      selectedCount: params.selectedCount,
      rejectedCount: params.rejectedCount,
      communicationCount: params.communicationIds.length,
    },
    filters: { driveId: params.driveId },
    audienceSummary: `${params.selectedCount + params.rejectedCount} released result notifications`,
    preview: {
      title: `Result notification review: ${driveName}`,
      channel: "none",
      targetPath: `/tpo/drives/${params.driveId}/results`,
      communicationIds: params.communicationIds,
    },
    linkedCommunicationId: params.communicationIds[0] ?? null,
    completedAt: new Date().toISOString(),
    items: params.communicationIds.map((communicationId) => ({
      entity_type: "communication",
      entity_id: communicationId,
      reason_key: "result_notification",
      reason_label: "Released result notification",
      status: "completed",
      payload: { audience: params.audience },
    })),
  });
}

async function releaseEmailRun(tenantId: string, run: StoredRun, actorUserId: string) {
  const preview = parseRecord(run.preview);
  const channel = String(preview.channel ?? "");
  if (channel === "digest_email") {
    const recipients = Array.isArray(preview.recipients) ? preview.recipients : [];
    const queued = await CommunicationService.sendCustomToRecipients({
      tenantId,
      senderId: actorUserId,
      subject: String(preview.subject ?? "Placement digest"),
      body: String(preview.body ?? ""),
      recipients: recipients
        .map((recipient) => parseRecord(recipient))
        .filter((recipient) => String(recipient.email ?? "").trim())
        .map((recipient) => ({
          studentId: String(recipient.id ?? recipient.email ?? randomUUID()),
          fullName: String(recipient.fullName ?? "Placement team"),
          email: String(recipient.email),
          driveName: undefined,
        })),
      metadata: {
        automation_run_id: run.id,
        automation_type: run.automationType,
        trigger_source: run.triggerSource,
      },
      allowUnsubscribe: false,
    });
    return queued.communicationId;
  }

  const filters = parseRecord(run.filters);
  const queued = await CommunicationService.sendBulk(
    tenantId,
    actorUserId,
    {
      subject: String(preview.subject ?? ""),
      body: String(preview.body ?? ""),
      filters: {
        driveId: filters.driveId ? String(filters.driveId) : undefined,
        studentIds: Array.isArray(filters.studentIds) ? filters.studentIds.map((value) => String(value)) : undefined,
        eligibleOnly: true,
      },
      variables: {},
    },
  );
  return queued.communicationId;
}

export const TpoAutomationService = {
  async getActiveTenantIds() {
    return listActiveTenantIds();
  },

  async getSummary(tenantId: string) {
    await ensureIndexes();
    const db = await getMongoDb();
    const rows = await db.collection(RUNS_COLLECTION).find(
      { tenant_id: tenantId },
      { projection: { _id: 0 } },
    ).sort({ created_at: -1 }).limit(50).toArray();
    const runs = rows.map((row) => mapRun(row as Record<string, unknown>));
    const pendingRuns = runs.filter((run) => run.status === "draft" || run.status === "ready");
    const latestByType = new Map<TpoAutomationType, StoredRun>();
    for (const run of runs) {
      if (!latestByType.has(run.automationType)) {
        latestByType.set(run.automationType, run);
      }
    }

    return {
      pendingDrafts: pendingRuns.length,
      dueToday: pendingRuns.filter((run) => run.dateBucket === toIsoDate(new Date()) || run.dateBucket === weekBucket(new Date())).length,
      counts: {
        eligibleNotApplied: latestByType.get("eligible_not_applied")?.counts.candidateCount ?? 0,
        blockedProfiles: latestByType.get("blocked_profile_followup")?.counts.candidateCount ?? 0,
        unplacedIntervention: latestByType.get("unplaced_intervention_refresh")?.counts.candidateCount ?? 0,
      },
      lastWeeklyDigestAt: latestByType.get("weekly_tpo_digest")?.createdAt ?? null,
      lastReportPackAt: latestByType.get("scheduled_report_pack")?.createdAt ?? null,
      items: pendingRuns.slice(0, 6).map((run) => ({
        id: run.id,
        automationType: run.automationType,
        status: run.status,
        explanation: run.explanation,
        counts: run.counts,
        targetPath: String(parseRecord(run.preview).targetPath ?? "/tpo/communication"),
      })),
    };
  },

  async listRuns(tenantId: string, query?: {
    status?: TpoAutomationRunStatus;
    automationType?: TpoAutomationType;
    triggerSource?: TpoAutomationTriggerSource;
    limit?: number;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { tenant_id: tenantId };
    if (query?.status) filter.status = query.status;
    if (query?.automationType) filter.automation_type = query.automationType;
    if (query?.triggerSource) filter.trigger_source = query.triggerSource;
    const rows = await db.collection(RUNS_COLLECTION).find(
      filter,
      { projection: { _id: 0 } },
    ).sort({ created_at: -1 }).limit(query?.limit ?? 30).toArray();
    return rows.map((row) => mapRun(row as Record<string, unknown>));
  },

  async getRun(tenantId: string, runId: string) {
    const run = await loadRunById(tenantId, runId);
    if (!run) {
      throw new AppError("AUTOMATION_RUN_NOT_FOUND", "Automation run not found.", 404);
    }
    return {
      ...run,
      items: await loadRunItems(tenantId, runId),
    };
  },

  async releaseRun(params: { tenantId: string; runId: string; actorUserId: string }) {
    const run = await loadRunById(params.tenantId, params.runId);
    if (!run) {
      throw new AppError("AUTOMATION_RUN_NOT_FOUND", "Automation run not found.", 404);
    }
    if (run.status === "dismissed") {
      throw new AppError("AUTOMATION_RUN_DISMISSED", "Dismissed automation runs cannot be released.", 409);
    }
    if (run.status === "sent" || run.status === "completed") {
      return this.getRun(params.tenantId, params.runId);
    }

    const preview = parseRecord(run.preview);
    const channel = String(preview.channel ?? "");
    let communicationId: string | null = null;
    if (channel === "email" || channel === "digest_email") {
      communicationId = await releaseEmailRun(params.tenantId, run, params.actorUserId);
    }

    const db = await getMongoDb();
    const now = new Date().toISOString();
    await db.collection(RUNS_COLLECTION).updateOne(
      { tenant_id: params.tenantId, id: params.runId },
      {
        $set: {
          status: communicationId ? "sent" : "completed",
          linked_communication_id: communicationId,
          released_at: now,
          released_by: params.actorUserId,
          completed_at: communicationId ? null : now,
          updated_at: now,
        },
      },
    );
    if (communicationId) {
      await db.collection(RUN_ITEMS_COLLECTION).updateMany(
        { tenant_id: params.tenantId, run_id: params.runId },
        { $set: { status: "sent", updated_at: now } },
      );
    }
    return this.getRun(params.tenantId, params.runId);
  },

  async dismissRun(params: { tenantId: string; runId: string; actorUserId: string }) {
    const run = await loadRunById(params.tenantId, params.runId);
    if (!run) {
      throw new AppError("AUTOMATION_RUN_NOT_FOUND", "Automation run not found.", 404);
    }
    const db = await getMongoDb();
    const now = new Date().toISOString();
    await db.collection(RUNS_COLLECTION).updateOne(
      { tenant_id: params.tenantId, id: params.runId },
      {
        $set: {
          status: "dismissed",
          dismissed_at: now,
          dismissed_by: params.actorUserId,
          updated_at: now,
        },
      },
    );
    await db.collection(RUN_ITEMS_COLLECTION).updateMany(
      { tenant_id: params.tenantId, run_id: params.runId },
      { $set: { status: "dismissed", updated_at: now } },
    );
    return this.getRun(params.tenantId, params.runId);
  },

  async runNow(params: {
    tenantId: string;
    actorUserId: string;
    automationType: TpoAutomationType;
    triggerSource?: TpoAutomationTriggerSource;
    frequency?: "weekly" | "monthly";
  }) {
    const triggerSource = params.triggerSource ?? "manual";
    if (params.automationType === "eligible_not_applied") {
      return createEligibleNotAppliedRuns({ tenantId: params.tenantId, triggerSource });
    }
    if (params.automationType === "blocked_profile_followup") {
      const run = await createBlockedProfileRun({ tenantId: params.tenantId, triggerSource });
      return run ? [run] : [];
    }
    if (params.automationType === "weekly_tpo_digest") {
      const run = await createWeeklyDigestRun({ tenantId: params.tenantId, triggerSource });
      return run ? [run] : [];
    }
    if (params.automationType === "scheduled_report_pack") {
      const run = await createScheduledReportPackRun({ tenantId: params.tenantId, triggerSource, frequency: params.frequency ?? "weekly" });
      return run ? [run] : [];
    }
    if (params.automationType === "unplaced_intervention_refresh") {
      const run = await createUnplacedInterventionRun({ tenantId: params.tenantId, triggerSource });
      return run ? [run] : [];
    }
    throw new AppError("AUTOMATION_RUN_NOT_SUPPORTED", "This automation cannot be started manually right now.", 400);
  },

  async listScheduledReportRuns(tenantId: string) {
    const runs = await this.listRuns(tenantId, { automationType: "scheduled_report_pack", limit: 20 });
    return Promise.all(runs.map(async (run) => ({ ...run, items: await loadRunItems(tenantId, run.id) })));
  },

  async regenerateScheduledReportRun(params: {
    tenantId: string;
    runId: string;
    actorUserId: string;
  }) {
    const run = await loadRunById(params.tenantId, params.runId);
    if (!run || run.automationType !== "scheduled_report_pack") {
      throw new AppError("SCHEDULED_REPORT_NOT_FOUND", "Scheduled report pack not found.", 404);
    }
    const frequency = String(run.scope.frequency ?? "weekly") === "monthly" ? "monthly" : "weekly";
    return createScheduledReportPackRun({ tenantId: params.tenantId, triggerSource: "manual", frequency });
  },

  async runScheduledEligibleNotAppliedForTenant(tenantId: string) {
    return createEligibleNotAppliedRuns({ tenantId, triggerSource: "scheduled" });
  },

  async runScheduledBlockedProfilesForTenant(tenantId: string) {
    return createBlockedProfileRun({ tenantId, triggerSource: "scheduled" });
  },

  async runScheduledWeeklyDigestForTenant(tenantId: string) {
    return createWeeklyDigestRun({ tenantId, triggerSource: "scheduled" });
  },

  async runScheduledReportPackForTenant(tenantId: string, frequency: "weekly" | "monthly") {
    return createScheduledReportPackRun({ tenantId, triggerSource: "scheduled", frequency });
  },

  async runScheduledUnplacedRefreshForTenant(tenantId: string) {
    return createUnplacedInterventionRun({ tenantId, triggerSource: "scheduled" });
  },

  async recordResultNotificationRun(params: {
    tenantId: string;
    driveId: string;
    selectedCount: number;
    rejectedCount: number;
    communicationIds: string[];
    audience: string;
  }) {
    return recordResultNotificationReview(params);
  },
};
