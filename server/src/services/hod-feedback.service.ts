import { randomUUID } from "node:crypto";

import * as XLSX from "xlsx";

import { AppError } from "../middleware/error-handler.js";
import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";
import { getMongoDb } from "../utils/mongodb.js";
import { normalizeStudentProfileData } from "../utils/student-profile.js";
import { CommunicationService } from "./communication.service.js";
import { NotificationService } from "./notification.service.js";

type FeedbackCampaignType =
  | "drive_feedback"
  | "faculty_feedback_single"
  | "faculty_feedback_all"
  | "training_activity_feedback"
  | "mock_test_feedback"
  | "general_department_feedback"
  | "custom_feedback";

type FeedbackCampaignStatus = "draft" | "published" | "closed" | "archived";
type AcademicYear = "first_year" | "second_year" | "third_year" | "final_year";

const CAMPAIGNS_COLLECTION = "feedback_campaigns";
const RESPONSES_COLLECTION = "feedback_responses";

type FeedbackTemplate = {
  key: string;
  subjectMode: "single" | "multi";
  subjectLabel: string;
  questions: Array<{ key: string; label: string }>;
  commentPrompt: string;
};

const feedbackTemplates: Record<Exclude<FeedbackCampaignType, "custom_feedback">, FeedbackTemplate> = {
  drive_feedback: {
    key: "drive_feedback_template",
    subjectMode: "single",
    subjectLabel: "Drive",
    questions: [
      { key: "process_clarity", label: "Process clarity" },
      { key: "communication_quality", label: "Communication quality" },
      { key: "difficulty_alignment", label: "Difficulty alignment" },
      { key: "fairness_transparency", label: "Fairness and transparency" },
      { key: "overall_experience", label: "Overall experience" },
    ],
    commentPrompt: "Share suggestions for improving the drive experience.",
  },
  faculty_feedback_single: {
    key: "faculty_single_template",
    subjectMode: "single",
    subjectLabel: "Faculty member",
    questions: [
      { key: "teaching_clarity", label: "Clarity of teaching" },
      { key: "punctuality", label: "Punctuality and preparedness" },
      { key: "doubt_support", label: "Support for doubts" },
      { key: "interaction", label: "Interaction with students" },
      { key: "overall_rating", label: "Overall rating" },
    ],
    commentPrompt: "Share specific feedback for this faculty member.",
  },
  faculty_feedback_all: {
    key: "faculty_all_template",
    subjectMode: "multi",
    subjectLabel: "Faculty member",
    questions: [
      { key: "teaching_clarity", label: "Clarity of teaching" },
      { key: "punctuality", label: "Punctuality and preparedness" },
      { key: "doubt_support", label: "Support for doubts" },
      { key: "interaction", label: "Interaction with students" },
      { key: "overall_rating", label: "Overall rating" },
    ],
    commentPrompt: "Share concise feedback for each faculty member.",
  },
  training_activity_feedback: {
    key: "training_feedback_template",
    subjectMode: "single",
    subjectLabel: "Training activity",
    questions: [
      { key: "relevance", label: "Relevance to placement preparation" },
      { key: "delivery", label: "Delivery quality" },
      { key: "usefulness", label: "Usefulness of the session" },
      { key: "engagement", label: "Student engagement" },
      { key: "overall_rating", label: "Overall rating" },
    ],
    commentPrompt: "Share suggestions for future training sessions.",
  },
  mock_test_feedback: {
    key: "mock_test_feedback_template",
    subjectMode: "single",
    subjectLabel: "Mock test",
    questions: [
      { key: "difficulty_balance", label: "Difficulty balance" },
      { key: "question_quality", label: "Question quality" },
      { key: "platform_experience", label: "Platform experience" },
      { key: "time_adequacy", label: "Time adequacy" },
      { key: "overall_rating", label: "Overall rating" },
    ],
    commentPrompt: "Share improvements for the mock test experience.",
  },
  general_department_feedback: {
    key: "general_department_template",
    subjectMode: "single",
    subjectLabel: "Department",
    questions: [
      { key: "communication", label: "Department communication" },
      { key: "support", label: "Support to students" },
      { key: "responsiveness", label: "Responsiveness to student needs" },
      { key: "opportunity_visibility", label: "Visibility of opportunities" },
      { key: "overall_rating", label: "Overall rating" },
    ],
    commentPrompt: "Share one suggestion that would help your department improve.",
  },
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeSemesterValue(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) return null;
  return parsed;
}

function deriveAcademicYearFromSemester(value: unknown): AcademicYear | null {
  const semester = normalizeSemesterValue(value);
  if (semester === null) return null;
  if (semester <= 2) return "first_year";
  if (semester <= 4) return "second_year";
  if (semester <= 6) return "third_year";
  return "final_year";
}

function slugifyQuestionKey(value: string, fallbackIndex: number) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || `question_${fallbackIndex + 1}`;
}

function buildCustomTemplate(raw: unknown): FeedbackTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as {
    subjectLabel?: unknown;
    commentPrompt?: unknown;
    questions?: unknown;
  };
  const subjectLabel = String(record.subjectLabel ?? "").trim();
  const commentPrompt = String(record.commentPrompt ?? "").trim();
  const questions = Array.isArray(record.questions)
    ? record.questions
      .map((item, index) => {
        const label = item && typeof item === "object"
          ? String((item as { label?: unknown }).label ?? "").trim()
          : "";
        if (!label) return null;
        return {
          key: slugifyQuestionKey(label, index),
          label,
        };
      })
      .filter((item): item is { key: string; label: string } => Boolean(item))
    : [];

  if (!subjectLabel || questions.length === 0) {
    return null;
  }

  return {
    key: "custom_feedback_template",
    subjectMode: "single",
    subjectLabel,
    questions,
    commentPrompt: commentPrompt || "Share your feedback.",
  };
}

function resolveTemplate(doc: Record<string, unknown>): FeedbackTemplate | null {
  if (String(doc.type) === "custom_feedback") {
    return buildCustomTemplate(doc.custom_template);
  }
  return feedbackTemplates[String(doc.type) as Exclude<FeedbackCampaignType, "custom_feedback">] ?? null;
}

function toCampaignSummary(doc: Record<string, unknown>) {
  return {
    id: String(doc.id),
    type: String(doc.type) as FeedbackCampaignType,
    title: String(doc.title),
    description: String(doc.description ?? ""),
    status: String(doc.status) as FeedbackCampaignStatus,
    department: String(doc.department ?? ""),
    targetBranches: Array.isArray(doc.target_branches) ? doc.target_branches.map((value) => String(value)) : [],
    targetBatches: Array.isArray(doc.target_batches) ? doc.target_batches.map((value) => String(value)) : [],
    targetAcademicYears: Array.isArray(doc.target_academic_years) ? doc.target_academic_years.map((value) => String(value) as AcademicYear) : [],
    facultyTargets: Array.isArray(doc.faculty_targets)
      ? doc.faculty_targets
        .map((value) => (value && typeof value === "object" ? {
          id: String((value as { id?: unknown }).id ?? ""),
          name: String((value as { name?: unknown }).name ?? ""),
        } : null))
        .filter(Boolean)
      : [],
    driveId: doc.drive_id ? String(doc.drive_id) : null,
    openAt: doc.open_at ? String(doc.open_at) : null,
    closeAt: doc.close_at ? String(doc.close_at) : null,
    publishedAt: doc.published_at ? String(doc.published_at) : null,
    createdAt: String(doc.created_at),
    updatedAt: String(doc.updated_at),
    responseCount: Number(doc.response_count ?? 0),
    pendingCount: Number(doc.pending_count ?? 0),
    template: resolveTemplate(doc),
  };
}

function matchesAudience(params: {
  branch: string;
  batch: string;
  academicYear: AcademicYear | null;
  campaign: Record<string, unknown>;
}) {
  const targetBranches = Array.isArray(params.campaign.target_branches) ? params.campaign.target_branches.map((value) => String(value)) : [];
  const targetBatches = Array.isArray(params.campaign.target_batches) ? params.campaign.target_batches.map((value) => String(value)) : [];
  const targetAcademicYears = Array.isArray(params.campaign.target_academic_years)
    ? params.campaign.target_academic_years.map((value) => String(value) as AcademicYear)
    : [];

  const branchAllowed = targetBranches.length === 0 || targetBranches.includes(params.branch);
  const batchAllowed = targetBatches.length === 0 || targetBatches.includes(params.batch);
  const yearAllowed = targetAcademicYears.length === 0 || (params.academicYear !== null && targetAcademicYears.includes(params.academicYear));

  return branchAllowed && batchAllowed && yearAllowed;
}

async function ensureIndexes() {
  const db = await getMongoDb();
  await db.collection(CAMPAIGNS_COLLECTION).createIndex({ tenant_id: 1, department: 1, updated_at: -1 });
  await db.collection(CAMPAIGNS_COLLECTION).createIndex({ tenant_id: 1, status: 1, department: 1, published_at: -1 });
  await db.collection(RESPONSES_COLLECTION).createIndex({ tenant_id: 1, campaign_id: 1, submitted_at: -1 });
  await db.collection(RESPONSES_COLLECTION).createIndex({ tenant_id: 1, campaign_id: 1, student_user_id: 1 }, { unique: true });
}

async function resolveHodScope(tenantId: string, userId: string) {
  const user = await MongoAuthRepository.findUserById(userId);
  if (!user || user.tenant_id !== tenantId || user.role !== "hod") {
    throw new AppError("HOD_NOT_FOUND", "HOD profile not found", 404);
  }

  const department = String(user.department ?? "").trim();
  if (!department) {
    throw new AppError("HOD_DEPARTMENT_MISSING", "HOD account is missing a department mapping.", 400);
  }

  return {
    userId: user.id,
    fullName: user.full_name ?? user.email,
    email: user.email,
    department,
  };
}

async function resolveStudentContext(tenantId: string, userId: string) {
  const db = await getMongoDb();
  const [user, student] = await Promise.all([
    MongoAuthRepository.findUserById(userId),
    db.collection("students").findOne(
      { tenant_id: tenantId, user_id: userId },
      { projection: { _id: 0, id: 1, branch: 1, batch: 1, roll_number: 1, profile_data: 1 } },
    ),
  ]);

  if (!user || user.tenant_id !== tenantId || user.role !== "student") {
    throw new AppError("FEEDBACK_STUDENT_NOT_FOUND", "Student profile not found", 404);
  }
  if (!student) {
    throw new AppError("FEEDBACK_STUDENT_RECORD_NOT_FOUND", "Student record not found", 404);
  }

  const profile = normalizeStudentProfileData(student.profile_data);
  return {
    userId: user.id,
    studentId: String(student.id),
    fullName: user.full_name ?? user.email,
    email: user.email,
    branch: String(student.branch ?? "").trim(),
    batch: String(student.batch ?? "").trim(),
    rollNumber: String(student.roll_number ?? "").trim(),
    prn: profile.prn,
    academicYear: deriveAcademicYearFromSemester(profile.currentSemester),
    currentSemester: profile.currentSemester,
  };
}

async function countMatchingStudents(params: {
  tenantId: string;
  department: string;
  batches: string[];
  academicYears: AcademicYear[];
}) {
  const db = await getMongoDb();
  const students = await db.collection("students").find(
    { tenant_id: params.tenantId, branch: params.department },
    { projection: { _id: 0, id: 1, batch: 1, profile_data: 1 } },
  ).toArray();

  return students.filter((student) => {
    const batch = String(student.batch ?? "").trim();
    const profile = normalizeStudentProfileData(student.profile_data);
    const academicYear = deriveAcademicYearFromSemester(profile.currentSemester);
    const batchAllowed = params.batches.length === 0 || params.batches.includes(batch);
    const yearAllowed = params.academicYears.length === 0 || (academicYear !== null && params.academicYears.includes(academicYear));
    return batchAllowed && yearAllowed;
  }).length;
}

async function resolveAnnouncementRecipients(params: {
  tenantId: string;
  campaign: Record<string, unknown>;
}) {
  const db = await getMongoDb();
  const studentRows = await db.collection("students").find(
    { tenant_id: params.tenantId, branch: String(params.campaign.department ?? "") },
    { projection: { _id: 0, id: 1, user_id: 1, branch: 1, batch: 1, profile_data: 1 } },
  ).toArray();

  return studentRows
    .filter((student) =>
      matchesAudience({
        branch: String(student.branch ?? "").trim(),
        batch: String(student.batch ?? "").trim(),
        academicYear: deriveAcademicYearFromSemester(normalizeStudentProfileData(student.profile_data).currentSemester),
        campaign: params.campaign,
      }))
    .map((student) => ({
      studentId: String(student.id),
      userId: String(student.user_id ?? "").trim(),
    }))
    .filter((student) => student.studentId && student.userId);
}

function buildExportRows(params: {
  template: FeedbackTemplate | null;
  responses: Array<Record<string, unknown>>;
}) {
  return params.responses.flatMap((response) => {
    const studentBase = {
      "Student Name": String(response.student_name ?? ""),
      "Student Email": String(response.student_email ?? ""),
      Branch: String(response.branch ?? ""),
      Batch: String(response.batch ?? ""),
      "Academic Year": response.academic_year ? String(response.academic_year) : "",
      "Current Semester": String(response.current_semester ?? ""),
      "Roll Number": String(response.roll_number ?? ""),
      PRN: String(response.prn ?? ""),
      "Submitted At": String(response.submitted_at ?? ""),
    };
    const items = Array.isArray(response.responses) ? response.responses as Array<Record<string, unknown>> : [];
    return items.map((item) => {
      const row: Record<string, string | number> = {
        ...studentBase,
        Subject: String(item.subjectLabel ?? ""),
        Comment: String(item.comment ?? ""),
      };
      const ratings = item.ratings && typeof item.ratings === "object" ? item.ratings as Record<string, unknown> : {};
      if (params.template) {
        params.template.questions.forEach((question) => {
          row[question.label] = Number(ratings[question.key] ?? "");
        });
      } else {
        Object.entries(ratings).forEach(([key, value]) => {
          row[key] = Number(value ?? "");
        });
      }
      return row;
    });
  });
}

function buildAnalytics(params: {
  campaign: Record<string, unknown>;
  responses: Array<Record<string, unknown>>;
}) {
  const template = resolveTemplate(params.campaign);
  if (!template) {
    return {
      totalResponses: params.responses.length,
      questionAverages: [] as Array<{ key: string; label: string; average: number; count: number }>,
      subjectBreakdown: [] as Array<{ subjectLabel: string; average: number; count: number }>,
      comments: [] as Array<{ studentName: string; subjectLabel: string; comment: string; submittedAt: string }>,
    };
  }
  const questionMap = new Map(template.questions.map((question) => [question.key, question.label]));
  const questionTotals = new Map<string, number[]>();
  const subjectTotals = new Map<string, number[]>();
  const comments: Array<{ studentName: string; subjectLabel: string; comment: string; submittedAt: string }> = [];

  params.responses.forEach((response) => {
    const items = Array.isArray(response.responses) ? response.responses as Array<Record<string, unknown>> : [];
    items.forEach((item) => {
      const subjectLabel = String(item.subjectLabel ?? "").trim() || "General";
      const ratings = item.ratings && typeof item.ratings === "object" ? item.ratings as Record<string, unknown> : {};
      const perItemScores: number[] = [];

      Object.entries(ratings).forEach(([key, rawValue]) => {
        const value = Number(rawValue);
        if (!Number.isFinite(value)) return;
        const bucket = questionTotals.get(key) ?? [];
        bucket.push(value);
        questionTotals.set(key, bucket);
        perItemScores.push(value);
      });

      if (perItemScores.length > 0) {
        const subjectBucket = subjectTotals.get(subjectLabel) ?? [];
        subjectBucket.push(perItemScores.reduce((sum, value) => sum + value, 0) / perItemScores.length);
        subjectTotals.set(subjectLabel, subjectBucket);
      }

      const comment = String(item.comment ?? "").trim();
      if (comment) {
        comments.push({
          studentName: String(response.student_name ?? "Student"),
          subjectLabel,
          comment,
          submittedAt: String(response.submitted_at ?? ""),
        });
      }
    });
  });

  return {
    totalResponses: params.responses.length,
    questionAverages: [...questionTotals.entries()].map(([key, values]) => ({
      key,
      label: questionMap.get(key) ?? key,
      average: values.length > 0 ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : 0,
      count: values.length,
    })),
    subjectBreakdown: [...subjectTotals.entries()].map(([subjectLabel, values]) => ({
      subjectLabel,
      average: values.length > 0 ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : 0,
      count: values.length,
    })),
    comments: comments
      .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt))
      .slice(0, 30),
  };
}

export const HodFeedbackService = {
  async createCampaign(input: {
    tenantId: string;
    hodUserId: string;
    type: FeedbackCampaignType;
    title: string;
    description?: string;
    targetBatches: string[];
    targetAcademicYears: AcademicYear[];
    facultyTargets: Array<{ id?: string; name: string }>;
    driveId?: string;
    openAt?: string;
    closeAt?: string;
    customTemplate?: {
      subjectLabel: string;
      commentPrompt?: string;
      questions: Array<{ label: string }>;
    };
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const hod = await resolveHodScope(input.tenantId, input.hodUserId);
    const now = nowIso();
    const pendingCount = await countMatchingStudents({
      tenantId: input.tenantId,
      department: hod.department,
      batches: input.targetBatches,
      academicYears: input.targetAcademicYears,
    });

    const doc = {
      id: randomUUID(),
      tenant_id: input.tenantId,
      department: hod.department,
      created_by_user_id: hod.userId,
      created_by_name: hod.fullName,
      created_by_email: hod.email,
      type: input.type,
      title: input.title.trim(),
      description: String(input.description ?? "").trim(),
      status: "draft" as FeedbackCampaignStatus,
      target_branches: [hod.department],
      target_batches: input.targetBatches,
      target_academic_years: input.targetAcademicYears,
      faculty_targets: input.facultyTargets.map((target) => ({
        id: String(target.id ?? "").trim() || null,
        name: target.name.trim(),
      })),
      custom_template: input.customTemplate
        ? {
          subjectLabel: input.customTemplate.subjectLabel.trim(),
          commentPrompt: String(input.customTemplate.commentPrompt ?? "").trim() || "Share your feedback.",
          questions: input.customTemplate.questions.map((question) => ({
            label: question.label.trim(),
          })),
        }
        : null,
      drive_id: input.driveId?.trim() || null,
      open_at: input.openAt ?? null,
      close_at: input.closeAt ?? null,
      published_at: null,
      response_count: 0,
      pending_count: pendingCount,
      created_at: now,
      updated_at: now,
    };

    await db.collection(CAMPAIGNS_COLLECTION).insertOne(doc);
    return toCampaignSummary(doc);
  },

  async listCampaigns(input: {
    tenantId: string;
    hodUserId: string;
    status?: FeedbackCampaignStatus;
    type?: FeedbackCampaignType;
    limit: number;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const hod = await resolveHodScope(input.tenantId, input.hodUserId);
    const filter: Record<string, unknown> = {
      tenant_id: input.tenantId,
      department: hod.department,
    };
    if (input.status) filter.status = input.status;
    if (input.type) filter.type = input.type;

    const rows = await db.collection(CAMPAIGNS_COLLECTION).find(filter, { projection: { _id: 0 } })
      .sort({ updated_at: -1 })
      .limit(input.limit)
      .toArray();

    return rows.map((row) => toCampaignSummary(row as Record<string, unknown>));
  },

  async getCampaignDetail(input: {
    tenantId: string;
    hodUserId: string;
    campaignId: string;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const hod = await resolveHodScope(input.tenantId, input.hodUserId);
    const campaign = await db.collection(CAMPAIGNS_COLLECTION).findOne(
      { tenant_id: input.tenantId, department: hod.department, id: input.campaignId },
      { projection: { _id: 0 } },
    );

    if (!campaign) {
      throw new AppError("FEEDBACK_CAMPAIGN_NOT_FOUND", "Feedback campaign not found", 404);
    }

    const responses = await db.collection(RESPONSES_COLLECTION).find(
      { tenant_id: input.tenantId, campaign_id: input.campaignId },
      { projection: { _id: 0 } },
    ).sort({ submitted_at: -1 }).toArray();

    return {
      ...toCampaignSummary(campaign as Record<string, unknown>),
      analytics: buildAnalytics({
        campaign: campaign as Record<string, unknown>,
        responses: responses as Array<Record<string, unknown>>,
      }),
    };
  },

  async listCampaignResponses(input: {
    tenantId: string;
    hodUserId: string;
    campaignId: string;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const hod = await resolveHodScope(input.tenantId, input.hodUserId);
    const campaign = await db.collection(CAMPAIGNS_COLLECTION).findOne(
      { tenant_id: input.tenantId, department: hod.department, id: input.campaignId },
      { projection: { _id: 0, id: 1, type: 1 } },
    );
    if (!campaign) {
      throw new AppError("FEEDBACK_CAMPAIGN_NOT_FOUND", "Feedback campaign not found", 404);
    }

    const responses = await db.collection(RESPONSES_COLLECTION).find(
      { tenant_id: input.tenantId, campaign_id: input.campaignId },
      { projection: { _id: 0 } },
    ).sort({ submitted_at: -1 }).limit(200).toArray();

    return {
      items: responses.map((response) => ({
        id: String(response.id),
        student: {
          userId: String(response.student_user_id),
          studentId: String(response.student_profile_id),
          fullName: String(response.student_name),
          email: String(response.student_email),
          branch: String(response.branch),
          batch: String(response.batch),
          academicYear: response.academic_year ? String(response.academic_year) : null,
          rollNumber: String(response.roll_number ?? ""),
          prn: String(response.prn ?? ""),
        },
        responses: Array.isArray(response.responses) ? response.responses : [],
        submittedAt: String(response.submitted_at),
      })),
    };
  },

  async exportCampaignWorkbook(input: {
    tenantId: string;
    hodUserId: string;
    campaignId: string;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const hod = await resolveHodScope(input.tenantId, input.hodUserId);
    const [campaign, responses] = await Promise.all([
      db.collection(CAMPAIGNS_COLLECTION).findOne(
        { tenant_id: input.tenantId, department: hod.department, id: input.campaignId },
        { projection: { _id: 0 } },
      ),
      db.collection(RESPONSES_COLLECTION).find(
        { tenant_id: input.tenantId, campaign_id: input.campaignId },
        { projection: { _id: 0 } },
      ).sort({ submitted_at: -1 }).toArray(),
    ]);

    if (!campaign) {
      throw new AppError("FEEDBACK_CAMPAIGN_NOT_FOUND", "Feedback campaign not found", 404);
    }

    const campaignSummary = toCampaignSummary(campaign as Record<string, unknown>);
    const workbook = XLSX.utils.book_new();
    const metadataRows = [
      { Field: "Title", Value: campaignSummary.title },
      { Field: "Type", Value: campaignSummary.type },
      { Field: "Department", Value: campaignSummary.department },
      { Field: "Status", Value: campaignSummary.status },
      { Field: "Response Count", Value: campaignSummary.responseCount },
      { Field: "Pending Count", Value: campaignSummary.pendingCount },
      { Field: "Published At", Value: campaignSummary.publishedAt ?? "" },
      { Field: "Target Batches", Value: campaignSummary.targetBatches.join(", ") },
      { Field: "Target Academic Years", Value: campaignSummary.targetAcademicYears.join(", ") },
      { Field: "Description", Value: campaignSummary.description },
    ];
    const rows = buildExportRows({
      template: campaignSummary.template,
      responses: responses as Array<Record<string, unknown>>,
    });

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(metadataRows), "Campaign");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Responses");

    return {
      filename: `${campaignSummary.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "feedback-campaign"}-responses.xlsx`,
      buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
    };
  },

  async publishCampaign(input: {
    tenantId: string;
    hodUserId: string;
    campaignId: string;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const hod = await resolveHodScope(input.tenantId, input.hodUserId);
    const campaign = await db.collection(CAMPAIGNS_COLLECTION).findOne(
      { tenant_id: input.tenantId, department: hod.department, id: input.campaignId },
      { projection: { _id: 0 } },
    );
    if (!campaign) {
      throw new AppError("FEEDBACK_CAMPAIGN_NOT_FOUND", "Feedback campaign not found", 404);
    }

    const recipientStudentIds = await resolveAnnouncementRecipients({
      tenantId: input.tenantId,
      campaign: campaign as Record<string, unknown>,
    });

    const now = nowIso();
    await db.collection(CAMPAIGNS_COLLECTION).updateOne(
      { tenant_id: input.tenantId, id: input.campaignId },
      {
        $set: {
          status: "published",
          published_at: now,
          updated_at: now,
          pending_count: recipientStudentIds.length,
        },
      },
    );

    if (recipientStudentIds.length > 0) {
      await CommunicationService.publishAnnouncement(input.tenantId, hod.userId, {
        title: `New feedback request: ${String(campaign.title)}`,
        message: "A feedback form has been published for you. Open SmartPath and submit it before the deadline.",
        priority: "normal",
        filters: {
          audienceMode: "custom",
          studentIds: recipientStudentIds.map((student) => student.studentId),
        },
      });

      await NotificationService.createRoleNotifications({
        tenantId: input.tenantId,
        recipientRole: "student",
        recipientUserIds: recipientStudentIds.map((student) => student.userId),
        type: "feedback_assigned",
        kind: "action",
        priority: "important",
        title: `Feedback assigned: ${String(campaign.title)}`,
        message: "A new department feedback form is waiting for your response in SmartPath.",
        targetPath: "/feedback",
        targetEntityId: input.campaignId,
        sourceType: "feedback_campaign",
        sourceId: input.campaignId,
        metadata: {
          campaignType: String(campaign.type ?? ""),
          department: String(campaign.department ?? ""),
        },
      });
    }

    return this.getCampaignDetail({
      tenantId: input.tenantId,
      hodUserId: input.hodUserId,
      campaignId: input.campaignId,
    });
  },

  async listStudentCampaigns(input: {
    tenantId: string;
    studentUserId: string;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const student = await resolveStudentContext(input.tenantId, input.studentUserId);
    const [campaigns, submissions] = await Promise.all([
      db.collection(CAMPAIGNS_COLLECTION).find(
        { tenant_id: input.tenantId, status: "published", department: student.branch },
        { projection: { _id: 0 } },
      ).sort({ published_at: -1 }).toArray(),
      db.collection(RESPONSES_COLLECTION).find(
        { tenant_id: input.tenantId, student_user_id: input.studentUserId },
        { projection: { _id: 0, campaign_id: 1, submitted_at: 1 } },
      ).toArray(),
    ]);

    const submissionMap = new Map(
      submissions.map((item) => [String(item.campaign_id), String(item.submitted_at)]),
    );

    return campaigns
      .filter((campaign) =>
        matchesAudience({
          branch: student.branch,
          batch: student.batch,
          academicYear: student.academicYear,
          campaign: campaign as Record<string, unknown>,
        }))
      .map((campaign) => ({
        ...toCampaignSummary(campaign as Record<string, unknown>),
        submittedAt: submissionMap.get(String(campaign.id)) ?? null,
      }));
  },

  async getStudentCampaign(input: {
    tenantId: string;
    studentUserId: string;
    campaignId: string;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const student = await resolveStudentContext(input.tenantId, input.studentUserId);
    const [campaign, existingResponse] = await Promise.all([
      db.collection(CAMPAIGNS_COLLECTION).findOne(
        { tenant_id: input.tenantId, id: input.campaignId, status: "published", department: student.branch },
        { projection: { _id: 0 } },
      ),
      db.collection(RESPONSES_COLLECTION).findOne(
        { tenant_id: input.tenantId, campaign_id: input.campaignId, student_user_id: input.studentUserId },
        { projection: { _id: 0, id: 1, submitted_at: 1 } },
      ),
    ]);

    if (!campaign || !matchesAudience({
      branch: student.branch,
      batch: student.batch,
      academicYear: student.academicYear,
      campaign: campaign as Record<string, unknown>,
    })) {
      throw new AppError("FEEDBACK_CAMPAIGN_NOT_FOUND", "Feedback campaign not found", 404);
    }

    return {
      ...toCampaignSummary(campaign as Record<string, unknown>),
      template: resolveTemplate(campaign as Record<string, unknown>),
      studentContext: {
        fullName: student.fullName,
        branch: student.branch,
        batch: student.batch,
        academicYear: student.academicYear,
      },
      submittedAt: existingResponse?.submitted_at ? String(existingResponse.submitted_at) : null,
    };
  },

  async submitStudentResponse(input: {
    tenantId: string;
    studentUserId: string;
    campaignId: string;
    responses: Array<{
      subjectId?: string;
      subjectLabel: string;
      ratings: Record<string, number>;
      comment?: string;
    }>;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const student = await resolveStudentContext(input.tenantId, input.studentUserId);
    const campaign = await db.collection(CAMPAIGNS_COLLECTION).findOne(
      { tenant_id: input.tenantId, id: input.campaignId, status: "published", department: student.branch },
      { projection: { _id: 0 } },
    );

    if (!campaign || !matchesAudience({
      branch: student.branch,
      batch: student.batch,
      academicYear: student.academicYear,
      campaign: campaign as Record<string, unknown>,
    })) {
      throw new AppError("FEEDBACK_CAMPAIGN_NOT_FOUND", "Feedback campaign not found", 404);
    }

    const alreadySubmitted = await db.collection(RESPONSES_COLLECTION).findOne(
      { tenant_id: input.tenantId, campaign_id: input.campaignId, student_user_id: input.studentUserId },
      { projection: { _id: 0, id: 1 } },
    );
    if (alreadySubmitted) {
      throw new AppError("FEEDBACK_ALREADY_SUBMITTED", "You have already submitted this feedback.", 409);
    }

    const now = nowIso();
    const responseId = randomUUID();
    await db.collection(RESPONSES_COLLECTION).insertOne({
      id: responseId,
      tenant_id: input.tenantId,
      campaign_id: input.campaignId,
      campaign_type: campaign.type,
      student_user_id: student.userId,
      student_profile_id: student.studentId,
      student_name: student.fullName,
      student_email: student.email,
      branch: student.branch,
      batch: student.batch,
      academic_year: student.academicYear,
      current_semester: student.currentSemester,
      roll_number: student.rollNumber,
      prn: student.prn,
      responses: input.responses.map((item) => ({
        subjectId: item.subjectId?.trim() || null,
        subjectLabel: item.subjectLabel.trim(),
        ratings: item.ratings,
        comment: item.comment?.trim() || "",
      })),
      submitted_at: now,
      created_at: now,
      updated_at: now,
    });

    const responseCount = await db.collection(RESPONSES_COLLECTION).countDocuments({
      tenant_id: input.tenantId,
      campaign_id: input.campaignId,
    });

    const pendingCount = Math.max(Number(campaign.pending_count ?? 0) - 1, 0);
    await db.collection(CAMPAIGNS_COLLECTION).updateOne(
      { tenant_id: input.tenantId, id: input.campaignId },
      {
        $set: {
          response_count: responseCount,
          pending_count: pendingCount,
          updated_at: now,
        },
      },
    );

    await NotificationService.createRoleNotifications({
      tenantId: input.tenantId,
      recipientRole: "hod",
      recipientUserIds: [String(campaign.created_by_user_id)],
      type: "feedback_response_received",
      kind: "action",
      priority: "normal",
      title: `New feedback response: ${String(campaign.title ?? "Feedback campaign")}`,
      message: `${student.fullName} submitted feedback for ${String(campaign.title ?? "your campaign")}.`,
      targetPath: "/hod",
      targetEntityId: input.campaignId,
      sourceType: "feedback_response",
      sourceId: responseId,
      metadata: {
        campaignId: input.campaignId,
        studentUserId: student.userId,
        studentName: student.fullName,
      },
    });

    return { submittedAt: now };
  },
};
