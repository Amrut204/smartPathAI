import path from "node:path";
import { randomUUID } from "node:crypto";
import { hash as bcryptHash } from "bcryptjs";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { AppError } from "../middleware/error-handler.js";
import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";
import { MockTestService } from "./mock-test.service.js";
import { StudentService } from "./student.service.js";
import { StudentRepository } from "../repositories/student.repository.js";
import { StudentImportJobService } from "./student-import-job.service.js";
import { AdminOpsJobService } from "./admin-ops-job.service.js";
import { CommunicationService } from "./communication.service.js";
import { ReadinessService } from "./readiness.service.js";
import { getMongoDb } from "../utils/mongodb.js";
import { resolveManagedCloudBaseUrl } from "../utils/storage.js";
import { buildDeclarationProfileDataPatch, buildStudentDeclarationStatus } from "../utils/student-declaration.js";
import { GoogleDriveResumeService } from "./google-drive-resume.service.js";

function nowIso() {
  return new Date().toISOString();
}

function slugify(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildLoginUrl() {
  const appUrl = String(process.env.APP_URL ?? "http://localhost:5173").trim().replace(/\/+$/, "");
  return `${appUrl}/login`;
}

function buildPublicUrl(bucket: string, key: string) {
  const base = resolveManagedCloudBaseUrl();
  const encodedKey = key.split("/").map((part) => encodeURIComponent(part)).join("/");
  if (base) {
    return `${base}/${encodedKey}`;
  }
  const region = String(process.env.AWS_REGION ?? "us-east-1").trim() || "us-east-1";
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
}

function detectContentType(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".md" || ext === ".markdown" || ext === ".txt") return "text/plain; charset=utf-8";
  if (ext === ".json" || ext === ".ipynb") return "application/json; charset=utf-8";
  if (ext === ".csv") return "text/csv; charset=utf-8";
  return "application/octet-stream";
}

function normalizeOptionalString(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function normalizeBranchList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .map((value) => String(value ?? "").trim())
      .filter((value) => value.length >= 2),
  )];
}

function assertSelectedTenantId(tenantId: string | null | undefined) {
  const normalized = String(tenantId ?? "").trim();
  if (!normalized) {
    throw new AppError("ADMIN_TENANT_REQUIRED", "Select a college before using admin operations.", 400);
  }
  return normalized;
}

async function assertTenantExists(tenantId: string) {
  const tenant = await MongoAuthRepository.findTenantById(tenantId);
  if (!tenant) {
    throw new AppError("TENANT_NOT_FOUND", "Selected college was not found.", 404);
  }
  return tenant;
}

function getTenantBranchesFromConfig(config: unknown): string[] {
  const raw = config && typeof config === "object"
    ? config as Record<string, unknown>
    : {};
  return normalizeBranchList(raw.branches);
}

async function listTopics(tenantId: string) {
  const db = await getMongoDb();
  const rows = await db.collection("topics").find(
    { $or: [{ tenant_id: tenantId }, { tenant_id: null }, { tenant_id: { $exists: false } }] },
    { projection: { _id: 0, id: 1, name: 1 } },
  ).sort({ name: 1 }).toArray();

  return rows.map((row) => ({ id: String(row.id), name: String(row.name ?? "") }));
}

async function listCompanies(tenantId: string) {
  const db = await getMongoDb();
  const rows = await db.collection("companies").find(
    { $or: [{ tenant_id: tenantId }, { tenant_id: null }, { tenant_id: { $exists: false } }] },
    { projection: { _id: 0, id: 1, name: 1 } },
  ).sort({ name: 1 }).toArray();

  return rows.map((row) => ({ id: String(row.id), name: String(row.name ?? "") }));
}

const PLATFORM_SETTINGS_COLLECTION = "platform_settings";
const GLOBAL_FEEDBACK_KEY = "shared_student_feedback_form";
const TENANT_LIST_CACHE_TTL_MS = 15_000;
const TENANT_WORKSPACE_CACHE_TTL_MS = 15_000;
let tenantListCache: {
  expiresAt: number;
  value: Array<{
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    subscriptionTier: string | null;
  }>;
} | null = null;
const tenantWorkspaceCache = new Map<string, {
  expiresAt: number;
  value: {
    tenant: {
      id: string;
      name: string;
      slug: string;
      isActive: boolean;
      config: Record<string, unknown>;
    };
    stats: {
      students: number;
      tpos: number;
      tests: number;
      resources: number;
      communications: number;
    };
    referenceData: {
      topics: Array<{ id: string; name: string }>;
      companies: Array<{ id: string; name: string }>;
      branches: string[];
      loginUrl: string;
    };
  };
}>();

async function getGlobalFeedbackFormSettings() {
  const db = await getMongoDb();
  const row = await db.collection(PLATFORM_SETTINGS_COLLECTION).findOne(
    { key: GLOBAL_FEEDBACK_KEY },
    { projection: { _id: 0, value: 1 } },
  );

  const value = row?.value && typeof row.value === "object"
    ? row.value as Record<string, unknown>
    : {};

  return {
    googleForm: normalizeOptionalString(value.googleForm),
    label: normalizeOptionalString(value.label),
    notes: normalizeOptionalString(value.notes),
  };
}

async function saveGlobalFeedbackFormSettings(input: {
  googleForm?: string | null;
  label?: string | null;
  notes?: string | null;
}) {
  const db = await getMongoDb();
  await db.collection(PLATFORM_SETTINGS_COLLECTION).updateOne(
    { key: GLOBAL_FEEDBACK_KEY },
    {
      $set: {
        key: GLOBAL_FEEDBACK_KEY,
        value: {
          googleForm: normalizeOptionalString(input.googleForm),
          label: normalizeOptionalString(input.label),
          notes: normalizeOptionalString(input.notes),
        },
        updated_at: nowIso(),
      },
      $setOnInsert: {
        created_at: nowIso(),
      },
    },
    { upsert: true },
  );

  return getGlobalFeedbackFormSettings();
}

async function uploadToS3(params: {
  tenantId: string;
  title: string;
  fileName: string;
  buffer: Buffer;
  resourceType: string;
}) {
  const bucket = String(process.env.AWS_S3_BUCKET ?? "").trim();
  if (!bucket) {
    throw new AppError("RESOURCE_BUCKET_MISSING", "AWS_S3_BUCKET is required for resource uploads.", 500);
  }

  const region = String(process.env.AWS_REGION ?? "us-east-1").trim() || "us-east-1";
  const s3 = new S3Client({ region });
  const extension = path.extname(params.fileName).toLowerCase();
  const safeName = slugify(path.basename(params.fileName, extension) || params.title || "resource") || "resource";
  const safeType = slugify(params.resourceType || "file") || "file";
  const key = `smartpathai/resources/admin/${params.tenantId}/${safeType}/${safeName}__${randomUUID().slice(0, 8)}${extension}`;

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: params.buffer,
    ContentType: detectContentType(params.fileName),
  }));

  return {
    bucket,
    key,
    publicUrl: buildPublicUrl(bucket, key),
    contentType: detectContentType(params.fileName),
    sizeBytes: params.buffer.byteLength,
  };
}

export const AdminOpsService = {
  clearListCache() {
    tenantListCache = null;
  },

  clearTenantWorkspaceCache(tenantId?: string | null) {
    if (tenantId) {
      tenantWorkspaceCache.delete(String(tenantId));
      return;
    }
    tenantWorkspaceCache.clear();
  },

  async listTenants() {
    if (tenantListCache && tenantListCache.expiresAt > Date.now()) {
      return tenantListCache.value;
    }

    const tenants = await MongoAuthRepository.listTenants();
    const value = tenants.map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      isActive: tenant.is_active,
      subscriptionTier: tenant.subscription_tier ?? null,
    }));
    tenantListCache = {
      expiresAt: Date.now() + TENANT_LIST_CACHE_TTL_MS,
      value,
    };
    return value;
  },

  async getTenantWorkspace(tenantId: string) {
    const selectedTenantId = assertSelectedTenantId(tenantId);
    const cached = tenantWorkspaceCache.get(selectedTenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const tenant = await assertTenantExists(selectedTenantId);
    const db = await getMongoDb();

    const [students, tpos, tests, resources, communications, topics, companies] = await Promise.all([
      db.collection("students").countDocuments({ tenant_id: selectedTenantId }),
      db.collection("users").countDocuments({ tenant_id: selectedTenantId, role: "tpo" }),
      db.collection("mock_tests").countDocuments({ $or: [{ tenant_id: selectedTenantId }, { tenant_id: null }] }),
      db.collection("resources").countDocuments({ tenant_id: selectedTenantId, is_active: true }),
      db.collection("communications").countDocuments({ tenant_id: selectedTenantId }),
      listTopics(selectedTenantId),
      listCompanies(selectedTenantId),
    ]);

    const value = {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        isActive: tenant.is_active,
        config: tenant.config ?? {},
      },
      stats: {
        students,
        tpos,
        tests,
        resources,
        communications,
      },
      referenceData: {
        topics,
        companies,
        branches: getTenantBranchesFromConfig(tenant.config),
        loginUrl: buildLoginUrl(),
      },
    };
    tenantWorkspaceCache.set(selectedTenantId, {
      expiresAt: Date.now() + TENANT_WORKSPACE_CACHE_TTL_MS,
      value,
    });
    return value;
  },

  async createCollege(input: {
    actorUserId: string;
    actorName?: string | null;
    collegeName: string;
    tpoFullName: string;
    tpoEmail: string;
    tpoPassword: string;
    branches: string[];
  }) {
    const db = await getMongoDb();
    const normalizedName = String(input.collegeName).trim();
    const slug = slugify(normalizedName);
    if (!slug) {
      throw new AppError("TENANT_SLUG_INVALID", "College name could not be converted into a valid slug.", 400);
    }

    const tpoEmail = String(input.tpoEmail).trim().toLowerCase();
    const existingUser = await db.collection("users").findOne(
      { email: tpoEmail },
      { projection: { _id: 0, id: 1, tenant_id: 1, role: 1 } },
    );
    if (existingUser) {
      throw new AppError("TPO_EMAIL_EXISTS", "A user with this email already exists.", 409);
    }

    const branches = normalizeBranchList(input.branches);
    if (branches.length === 0) {
      throw new AppError("TENANT_BRANCHES_REQUIRED", "Add at least one branch for the college.", 400);
    }

    const tenant = await MongoAuthRepository.createTenant({
      name: normalizedName,
      slug,
      config: {
        branches,
      },
    });

    const passwordHash = await bcryptHash(input.tpoPassword, 12);
    const timestamp = nowIso();
    const user = await MongoAuthRepository.createUser({
      tenantId: tenant.id,
      email: tpoEmail,
      role: "tpo",
      fullName: String(input.tpoFullName).trim(),
      passwordHash,
      mustChangePassword: true,
      passwordIssuedAt: timestamp,
      passwordVersion: 1,
    });

    const emailJob = await CommunicationService.sendTemplatedToRecipients({
      tenantId: tenant.id,
      senderId: input.actorUserId,
      templateSlug: "tpo-onboarding-credentials",
      recipients: [
        {
          studentId: user.id,
          fullName: String(user.full_name ?? ""),
          email: String(user.email ?? ""),
          driveName: undefined,
          variables: {
            tpo_name: String(user.full_name ?? ""),
            tpo_email: String(user.email ?? ""),
            temporary_password: input.tpoPassword,
            login_url: buildLoginUrl(),
            issued_by: input.actorName ?? "Admin",
            college_name: tenant.name,
          },
        },
      ],
      variables: {
        tpo_name: String(user.full_name ?? ""),
        tpo_email: String(user.email ?? ""),
        temporary_password: input.tpoPassword,
        login_url: buildLoginUrl(),
        issued_by: input.actorName ?? "Admin",
        college_name: tenant.name,
      },
      metadata: {
        flow: "college_setup",
      },
      allowUnsubscribe: false,
    });

    this.clearListCache();
    this.clearTenantWorkspaceCache();

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        isActive: tenant.is_active,
        branches,
      },
      tpo: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        isActive: user.is_active,
        tenantId: tenant.id,
        createdAt: timestamp,
        lastPasswordIssuedAt: timestamp,
      },
      credentialEmail: emailJob,
    };
  },

  async unlockStudentProfile(input: {
    tenantId: string;
    studentId: string;
    actorUserId: string;
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    await assertTenantExists(tenantId);
    const db = await getMongoDb();
    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, id: input.studentId },
      { projection: { _id: 0, id: 1, user_id: 1, profile_data: 1, roll_number: 1, branch: 1, batch: 1, cgpa: 1, backlogs: 1, backlogs_total: 1, attendance_pct: 1, skills: 1 } },
    );
    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student not found for the selected college.", 404);
    }

    const user = await db.collection("users").findOne(
      { tenant_id: tenantId, id: String(student.user_id) },
      { projection: { _id: 0, full_name: 1, email: 1 } },
    );

    const declarationStatus = buildStudentDeclarationStatus({
      student: student as Record<string, unknown>,
      user: {
        full_name: user?.full_name,
        email: user?.email,
      },
    });

    if (!declarationStatus.profileCertification.isCertified || !declarationStatus.profileCertification.isLocked) {
      throw new AppError("PROFILE_NOT_LOCKED", "This student profile is not currently locked.", 409);
    }

    const now = nowIso();
    const updated = await db.collection("students").findOneAndUpdate(
      { tenant_id: tenantId, id: input.studentId },
      {
        $set: {
          profile_data: buildDeclarationProfileDataPatch({
            profileData: (student.profile_data ?? {}) as Record<string, unknown>,
            declaration: {
              profileEditUnlockedAt: now,
              profileEditUnlockedBy: input.actorUserId,
              profileCertificationInvalidatedAt: now,
              profileCertificationInvalidationReason: "Profile unlocked by admin for student corrections.",
            },
          }),
        },
      },
      { returnDocument: "after", projection: { _id: 0, id: 1, user_id: 1, profile_data: 1 } },
    );

    await ReadinessService.calculate(tenantId, input.studentId);
    this.clearTenantWorkspaceCache(tenantId);

    return {
      studentId: String(updated?.id ?? input.studentId),
      userId: String(updated?.user_id ?? student.user_id),
      unlockedAt: now,
      unlockedBy: input.actorUserId,
    };
  },

  async listStudents(tenantId: string, query: {
    q?: string;
    branch?: string;
    batch?: string;
    limit?: number;
  }) {
    const selectedTenantId = assertSelectedTenantId(tenantId);
    await assertTenantExists(selectedTenantId);
    const result = await StudentRepository.listStudentsForTpo(selectedTenantId, {
      q: query.q,
      branch: query.branch,
      batch: query.batch,
      limit: Math.min(Math.max(Number(query.limit ?? 100), 1), 200),
      sortBy: "created_at",
      sortDir: "desc",
    });
    const db = await getMongoDb();
    const readyJobs = await db.collection("admin_ops_jobs").find(
      {
        tenant_id: selectedTenantId,
        type: "credential_batch",
        status: "ready",
        "input.targetType": "student",
      },
      { projection: { _id: 0, id: 1, input: 1 } },
    ).toArray();
    const readyJobByStudentId = new Map<string, string>();
    for (const job of readyJobs) {
      const accountIds = Array.isArray((job as { input?: { accountIds?: unknown[] } }).input?.accountIds)
        ? ((job as { input?: { accountIds?: unknown[] } }).input?.accountIds ?? [])
        : [];
      for (const accountId of accountIds) {
        readyJobByStudentId.set(String(accountId), String((job as { id?: unknown }).id ?? ""));
      }
    }

    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        pendingCredentialJobId: readyJobByStudentId.get(item.id) ?? null,
      })),
    };
  },

  async createStudent(input: {
    tenantId: string;
    actorUserId: string;
    actorName?: string | null;
    fullName: string;
    email: string;
    rollNumber: string;
    branch: string;
    batch: string;
    prn?: string;
    degree?: string;
    currentSemester?: string;
    cgpa?: number;
    backlogs?: number;
    totalHistoricalBacklogs?: number;
    attendancePct?: number;
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    const tenant = await assertTenantExists(tenantId);
    const db = await getMongoDb();

    const email = String(input.email).trim().toLowerCase();
    const existingUser = await db.collection("users").findOne({ email }, { projection: { _id: 0, id: 1, tenant_id: 1 } });
    if (existingUser) {
      throw new AppError("STUDENT_EMAIL_EXISTS", "A student with this email already exists for the selected college.", 409);
    }

    const existingRoll = await db.collection("students").findOne({ tenant_id: tenantId, roll_number: input.rollNumber }, { projection: { _id: 0, id: 1 } });
    if (existingRoll) {
      throw new AppError("STUDENT_ROLL_EXISTS", "A student with this roll number already exists for the selected college.", 409);
    }

    const tempPassword = `PIQ-${randomUUID()}`;
    const passwordHash = await bcryptHash(tempPassword, 12);
    const timestamp = nowIso();
    const studentId = randomUUID();

    const user = await MongoAuthRepository.createUser({
      tenantId,
      email,
      role: "student",
      fullName: input.fullName,
      passwordHash,
      mustChangePassword: true,
      passwordIssuedAt: timestamp,
      passwordVersion: 1,
    });

    await db.collection("students").insertOne({
      id: studentId,
      tenant_id: tenantId,
      user_id: user.id,
      roll_number: input.rollNumber,
      branch: input.branch,
      batch: input.batch,
      cgpa: Number(input.cgpa ?? 0),
      backlogs: Number(input.backlogs ?? 0),
      backlogs_total: Number(input.totalHistoricalBacklogs ?? 0),
      attendance_pct: Number(input.attendancePct ?? 0),
      skills: [],
      points: 0,
      streak_current: 0,
      streak_longest: 0,
      readiness_score: 0,
      profile_data: {
        ...(input.prn ? { prn: input.prn } : {}),
        ...(input.degree ? { degree: input.degree } : {}),
        ...(input.currentSemester ? { currentSemester: input.currentSemester } : {}),
        totalHistoricalBacklogs: Number(input.totalHistoricalBacklogs ?? 0),
      },
      created_at: timestamp,
      updated_at: timestamp,
    });

    await ReadinessService.calculate(tenantId, studentId);

    const credentialJob = await AdminOpsJobService.createStudentCredentialBatchJob({
      tenantId,
      createdBy: input.actorUserId,
      studentIds: [studentId],
      reason: "manual_create",
      actorName: input.actorName ?? tenant.name,
      autoStart: false,
    });
    this.clearTenantWorkspaceCache(tenantId);

    return {
      student: {
        id: studentId,
        userId: user.id,
        fullName: input.fullName,
        email,
        rollNumber: input.rollNumber,
        branch: input.branch,
        batch: input.batch,
      },
      credentialJob,
    };
  },

  async sendStudentCredentials(input: {
    tenantId: string;
    studentId: string;
    actorUserId: string;
    actorName?: string | null;
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    await assertTenantExists(tenantId);
    const db = await getMongoDb();
    const existingReadyJob = await db.collection("admin_ops_jobs").findOne(
      {
        tenant_id: tenantId,
        type: "credential_batch",
        status: "ready",
        "input.targetType": "student",
        "input.accountIds": String(input.studentId),
      },
      { projection: { _id: 0, id: 1 } },
    );

    if (existingReadyJob?.id) {
      return AdminOpsJobService.releaseJob(String(existingReadyJob.id), tenantId);
    }

    return AdminOpsJobService.createStudentCredentialBatchJob({
      tenantId,
      createdBy: input.actorUserId,
      studentIds: [String(input.studentId)],
      reason: "reset_password",
      actorName: input.actorName ?? null,
      autoStart: true,
    });
  },

  async queueCredentialsForImport(input: {
    tenantId: string;
    importJobId: string;
    actorUserId: string;
    actorName?: string | null;
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    await assertTenantExists(tenantId);
    const job = await StudentImportJobService.getJob({ tenantId, jobId: input.importJobId });
    const studentIds = Array.isArray(job.createdStudentIds) ? job.createdStudentIds : [];
    if (studentIds.length === 0) {
      throw new AppError("ADMIN_OPS_NO_NEW_STUDENTS", "This import job did not create any new students who need credentials.", 400);
    }

    return AdminOpsJobService.createStudentCredentialBatchJob({
      tenantId,
      createdBy: input.actorUserId,
      studentIds,
      reason: "new_accounts",
      actorName: input.actorName ?? null,
    });
  },

  async queueStudentCredentialReset(input: {
    tenantId: string;
    studentId: string;
    actorUserId: string;
    actorName?: string | null;
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    await assertTenantExists(tenantId);
    return AdminOpsJobService.createStudentCredentialBatchJob({
      tenantId,
      createdBy: input.actorUserId,
      studentIds: [String(input.studentId)],
      reason: "reset_password",
      actorName: input.actorName ?? null,
    });
  },

  async deleteStudent(input: {
    tenantId: string;
    studentId: string;
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    await assertTenantExists(tenantId);
    const db = await getMongoDb();

    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, id: String(input.studentId) },
      { projection: { _id: 0, id: 1, user_id: 1 } },
    );
    if (!student) {
      throw new AppError("ADMIN_OPS_STUDENT_NOT_FOUND", "Student not found for the selected college.", 404);
    }

    const user = await db.collection("users").findOne(
      { tenant_id: tenantId, id: String(student.user_id), role: "student" },
      { projection: { _id: 0, id: 1, email: 1, full_name: 1 } },
    );

    const studentId = String(student.id);
    const userId = String(student.user_id);
    const deleteByStudentId = async (collection: string) =>
      (await db.collection(collection).deleteMany({ tenant_id: tenantId, student_id: studentId })).deletedCount;

    const removedCollections = {
      studentAttempts: await deleteByStudentId("student_attempts"),
      studyHours: await deleteByStudentId("study_hours"),
      studentTopicProgress: await deleteByStudentId("student_topic_progress"),
      studentProgress: await deleteByStudentId("student_progress"),
      pointsLedger: await deleteByStudentId("points_ledger"),
      studentRiskAssessments: await deleteByStudentId("student_risk_assessments"),
      resourceViewEvents: await deleteByStudentId("resource_view_events"),
      driveResults: await deleteByStudentId("drive_results"),
      studentActivityEvents: await deleteByStudentId("student_activity_events"),
      studentDriveDeclarations: await deleteByStudentId("student_drive_declarations"),
      studentAnnouncementStates: await deleteByStudentId("student_announcement_states"),
      studentAiUsage: await deleteByStudentId("student_ai_usage"),
      studentAiConversations: await deleteByStudentId("student_ai_conversations"),
      studentAchievements: await deleteByStudentId("student_achievements"),
      studentCodingProfiles: await deleteByStudentId("student_coding_profiles"),
      studentInterviewSessions: await deleteByStudentId("student_interview_sessions"),
      studentWeeklyGoals: await deleteByStudentId("student_weekly_goals"),
    };

    await db.collection("announcements").updateMany(
      { tenant_id: tenantId, recipient_student_ids: studentId },
      { $pull: { recipient_student_ids: { $in: [studentId] } }, $set: { updated_at: nowIso() } } as any,
    );

    await db.collection("admin_ops_jobs").updateMany(
      {
        tenant_id: tenantId,
        type: "credential_batch",
        "input.targetType": "student",
        "input.accountIds": studentId,
      },
      { $pull: { "input.accountIds": { $in: [studentId] } }, $set: { updated_at: nowIso() } } as any,
    );

    const removedStudent = await db.collection("students").deleteOne({ tenant_id: tenantId, id: studentId });
    const removedUser = await db.collection("users").deleteOne({ tenant_id: tenantId, id: userId, role: "student" });

    this.clearTenantWorkspaceCache(tenantId);

    return {
      studentId,
      userId,
      email: String(user?.email ?? ""),
      fullName: String(user?.full_name ?? ""),
      removedStudent: removedStudent.deletedCount,
      removedUser: removedUser.deletedCount,
      removedCollections,
    };
  },

  async listTpoAccounts(tenantId: string) {
    const selectedTenantId = assertSelectedTenantId(tenantId);
    await assertTenantExists(selectedTenantId);
    const db = await getMongoDb();
    const rows = await db.collection("users").find(
      { tenant_id: selectedTenantId, role: "tpo" },
      { projection: { _id: 0, id: 1, email: 1, full_name: 1, is_active: 1, tenant_id: 1, created_at: 1, password_issued_at: 1 } },
    ).sort({ created_at: -1 }).limit(100).toArray();

    return rows.map((row) => ({
      id: String(row.id),
      email: String(row.email ?? ""),
      fullName: String(row.full_name ?? ""),
      isActive: Boolean(row.is_active),
      tenantId: String(row.tenant_id ?? selectedTenantId),
      createdAt: String(row.created_at ?? ""),
      lastPasswordIssuedAt: row.password_issued_at ? String(row.password_issued_at) : null,
    }));
  },

  async createTpoAccount(input: {
    tenantId: string;
    actorUserId: string;
    actorName?: string | null;
    fullName: string;
    email: string;
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    await assertTenantExists(tenantId);
    const db = await getMongoDb();
    const email = String(input.email).trim().toLowerCase();
    const existingUser = await db.collection("users").findOne({ email }, { projection: { _id: 0, id: 1, tenant_id: 1, role: 1 } });
    if (existingUser) {
      throw new AppError("TPO_EMAIL_EXISTS", "A user with this email already exists.", 409);
    }

    const tempPassword = `PIQ-${randomUUID()}`;
    const passwordHash = await bcryptHash(tempPassword, 12);
    const timestamp = nowIso();
    const user = await MongoAuthRepository.createUser({
      tenantId,
      email,
      role: "tpo",
      fullName: input.fullName,
      passwordHash,
      mustChangePassword: true,
      passwordIssuedAt: timestamp,
      passwordVersion: 1,
    });

    const credentialJob = await AdminOpsJobService.createTpoCredentialBatchJob({
      tenantId,
      createdBy: input.actorUserId,
      userIds: [user.id],
      reason: "manual_create",
      actorName: input.actorName ?? null,
    });
    this.clearTenantWorkspaceCache(tenantId);

    return {
      tpo: {
        id: user.id,
        email,
        fullName: input.fullName,
        isActive: true,
        tenantId,
        createdAt: timestamp,
        lastPasswordIssuedAt: timestamp,
      },
      credentialJob,
    };
  },

  async updateTpoAccount(input: {
    tenantId: string;
    userId: string;
    fullName?: string;
    isActive?: boolean;
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    await assertTenantExists(tenantId);
    const db = await getMongoDb();
    const update: Record<string, unknown> = {
      updated_at: nowIso(),
    };
    if (input.fullName !== undefined) update.full_name = input.fullName;
    if (input.isActive !== undefined) update.is_active = input.isActive;

    const result = await db.collection("users").findOneAndUpdate(
      { tenant_id: tenantId, id: input.userId, role: "tpo" },
      { $set: update },
      { returnDocument: "after", projection: { _id: 0, id: 1, email: 1, full_name: 1, is_active: 1, tenant_id: 1, created_at: 1, password_issued_at: 1 } },
    );
    if (!result) {
      throw new AppError("TPO_NOT_FOUND", "TPO account not found for the selected college.", 404);
    }
    this.clearTenantWorkspaceCache(tenantId);

    return {
      id: String(result.id),
      email: String(result.email ?? ""),
      fullName: String(result.full_name ?? ""),
      isActive: Boolean(result.is_active),
      tenantId: String(result.tenant_id ?? tenantId),
      createdAt: String(result.created_at ?? ""),
      lastPasswordIssuedAt: result.password_issued_at ? String(result.password_issued_at) : null,
    };
  },

  async queueTpoCredentialReset(input: {
    tenantId: string;
    userId: string;
    actorUserId: string;
    actorName?: string | null;
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    await assertTenantExists(tenantId);
    const db = await getMongoDb();
    const tpo = await db.collection("users").findOne(
      { tenant_id: tenantId, id: input.userId, role: "tpo" },
      { projection: { _id: 0, id: 1 } },
    );
    if (!tpo) {
      throw new AppError("TPO_NOT_FOUND", "TPO account not found for the selected college.", 404);
    }

    return AdminOpsJobService.createTpoCredentialBatchJob({
      tenantId,
      createdBy: input.actorUserId,
      userIds: [String(input.userId)],
      reason: "reset_password",
      actorName: input.actorName ?? null,
    });
  },

  async previewStudentCsv(csv: string) {
    return StudentService.parseCsvPreview(csv);
  },

  async createStudentImportJob(input: {
    tenantId: string;
    actorUserId: string;
    payload: {
      mapping: {
        fullName: string;
        email: string;
        prn?: string;
        rollNumber: string;
        degree?: string;
        branch: string;
        batch: string;
        currentSemester?: string;
        cgpa?: string;
        backlogs?: string;
        totalHistoricalBacklogs?: string;
        attendancePct?: string;
      };
      rows: Array<Record<string, string>>;
    };
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    await assertTenantExists(tenantId);
    return StudentImportJobService.createJob({
      tenantId,
      createdBy: input.actorUserId,
      payload: input.payload,
    });
  },

  async getStudentImportJob(tenantId: string, jobId: string) {
    const selectedTenantId = assertSelectedTenantId(tenantId);
    await assertTenantExists(selectedTenantId);
    return StudentImportJobService.getJob({ tenantId: selectedTenantId, jobId });
  },

  async listMockTests(tenantId: string) {
    const selectedTenantId = assertSelectedTenantId(tenantId);
    await assertTenantExists(selectedTenantId);
    const db = await getMongoDb();
    const rows = await db.collection("mock_tests").find(
      { $or: [{ tenant_id: selectedTenantId }, { tenant_id: null }] },
      { projection: { _id: 0, id: 1, title: 1, topic_id: 1, company_id: 1, duration_sec: 1, difficulty: 1, is_active: 1, tenant_id: 1, created_at: 1 } },
    ).sort({ created_at: -1 }).limit(200).toArray();
    const topics = await listTopics(selectedTenantId);
    const companies = await listCompanies(selectedTenantId);
    const topicMap = new Map(topics.map((item) => [item.id, item.name]));
    const companyMap = new Map(companies.map((item) => [item.id, item.name]));
    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      topicId: row.topic_id ? String(row.topic_id) : null,
      topicName: row.topic_id ? topicMap.get(String(row.topic_id)) ?? null : null,
      companyId: row.company_id ? String(row.company_id) : null,
      companyName: row.company_id ? companyMap.get(String(row.company_id)) ?? null : null,
      durationSec: Number(row.duration_sec ?? 0),
      difficulty: String(row.difficulty ?? "medium"),
      isActive: Boolean(row.is_active),
      source: row.tenant_id ? "tenant" : "global",
      tenantId: row.tenant_id ? String(row.tenant_id) : null,
    }));
  },

  async createMockTest(input: {
    tenantId: string;
    actorUserId: string;
    title: string;
    topicId?: string;
    companyId?: string;
    durationSec: number;
    difficulty: "easy" | "medium" | "hard";
    questions: Array<{ text: string; options: string[]; correctIndex: number; explanation?: string; skillTag?: string }>;
    isActive: boolean;
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    await assertTenantExists(tenantId);
    const result = await MockTestService.createTest(tenantId, input.actorUserId, input);
    this.clearTenantWorkspaceCache(tenantId);
    return result;
  },

  async updateMockTest(input: {
    tenantId: string;
    testId: string;
    title?: string;
    topicId?: string;
    companyId?: string;
    durationSec?: number;
    difficulty?: "easy" | "medium" | "hard";
    isActive?: boolean;
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    await assertTenantExists(tenantId);
    return MockTestService.updateTest(tenantId, input.testId, input);
  },

  async publishMockTest(input: { tenantId: string; testId: string; isActive: boolean }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    await assertTenantExists(tenantId);
    const result = await MockTestService.publishTest(tenantId, input.testId, input.isActive);
    this.clearTenantWorkspaceCache(tenantId);
    return result;
  },

  async getMockTestQuestions(tenantId: string, testId: string) {
    const selectedTenantId = assertSelectedTenantId(tenantId);
    await assertTenantExists(selectedTenantId);
    return MockTestService.getQuestions(selectedTenantId, testId, "admin");
  },

  async updateMockTestQuestions(input: {
    tenantId: string;
    testId: string;
    append: boolean;
    questions: Array<{ text: string; options: string[]; correctIndex: number; explanation?: string; skillTag?: string }>;
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    await assertTenantExists(tenantId);
    return MockTestService.upsertQuestions(tenantId, input.testId, input);
  },

  async listTenantResources(tenantId: string) {
    const selectedTenantId = assertSelectedTenantId(tenantId);
    await assertTenantExists(selectedTenantId);
    const db = await getMongoDb();
    const topics = await listTopics(selectedTenantId);
    const topicMap = new Map(topics.map((item) => [item.id, item.name]));
    const rows = await db.collection("resources").find(
      { tenant_id: selectedTenantId },
      { projection: { _id: 0, id: 1, title: 1, description: 1, url: 1, resource_type: 1, thumbnail_url: 1, duration_sec: 1, topic_id: 1, is_active: 1, created_at: 1, source_pdf: 1, branch_relevance: 1, career_tracks: 1, recommended_for: 1, content_pack_labels: 1 } },
    ).sort({ created_at: -1 }).limit(200).toArray();

    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      description: String(row.description ?? ""),
      url: String(row.url ?? ""),
      resourceType: String(row.resource_type ?? "pdf"),
      thumbnailUrl: row.thumbnail_url ? String(row.thumbnail_url) : null,
      durationSec: Number(row.duration_sec ?? 0),
      topicId: row.topic_id ? String(row.topic_id) : null,
      topicName: row.topic_id ? topicMap.get(String(row.topic_id)) ?? null : null,
      isActive: Boolean(row.is_active),
      sourcePdf: row.source_pdf ? String(row.source_pdf) : null,
      branchRelevance: Array.isArray(row.branch_relevance) ? row.branch_relevance.map((value) => String(value)) : [],
      careerTracks: Array.isArray(row.career_tracks) ? row.career_tracks.map((value) => String(value)) : [],
      recommendedFor: Array.isArray(row.recommended_for) ? row.recommended_for.map((value) => String(value)) : [],
      contentPackLabels: Array.isArray(row.content_pack_labels) ? row.content_pack_labels.map((value) => String(value)) : [],
    }));
  },

  async createExternalResource(input: {
    tenantId: string;
    actorUserId: string;
    title: string;
    description?: string;
    url: string;
    resourceType: string;
    topicId?: string | null;
    durationSec?: number;
    thumbnailUrl?: string | null;
    isActive?: boolean;
    branchRelevance?: string[];
    careerTracks?: string[];
    recommendedFor?: string[];
    contentPackLabels?: string[];
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    await assertTenantExists(tenantId);
    const db = await getMongoDb();
    const now = nowIso();
    const id = randomUUID();

    await db.collection("resources").insertOne({
      id,
      tenant_id: tenantId,
      created_by: input.actorUserId,
      title: input.title,
      description: input.description ?? "",
      url: input.url,
      resource_type: input.resourceType,
      thumbnail_url: input.thumbnailUrl ?? null,
      duration_sec: Number(input.durationSec ?? 0),
      topic_id: input.topicId ?? null,
      branch_relevance: input.branchRelevance ?? [],
      career_tracks: input.careerTracks ?? [],
      recommended_for: input.recommendedFor ?? [],
      content_pack_labels: input.contentPackLabels ?? [],
      source_pdf: null,
      is_active: input.isActive ?? true,
      created_at: now,
      updated_at: now,
    });
    this.clearTenantWorkspaceCache(tenantId);

    return { id };
  },

  async uploadTenantResource(input: {
    tenantId: string;
    actorUserId: string;
    title: string;
    description?: string;
    topicId?: string | null;
    resourceType: string;
    durationSec?: number;
    isActive?: boolean;
    fileName: string;
    fileBuffer: Buffer;
    thumbnailUrl?: string | null;
    branchRelevance?: string[];
    careerTracks?: string[];
    recommendedFor?: string[];
    contentPackLabels?: string[];
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    await assertTenantExists(tenantId);
    const uploaded = await uploadToS3({
      tenantId,
      title: input.title,
      fileName: input.fileName,
      buffer: input.fileBuffer,
      resourceType: input.resourceType,
    });
    const db = await getMongoDb();
    const now = nowIso();
    const assetId = randomUUID();
    const resourceId = randomUUID();

    await db.collection("assets").insertOne({
      id: assetId,
      storage_provider: "s3",
      storage_key: uploaded.key,
      public_url: uploaded.publicUrl,
      bucket: uploaded.bucket,
      mime_type: uploaded.contentType,
      size_bytes: uploaded.sizeBytes,
      source_path: null,
      cloud_source_path: uploaded.key,
      import_source: "admin_ops_upload",
      created_at: now,
      updated_at: now,
    });

    await db.collection("resources").insertOne({
      id: resourceId,
      tenant_id: tenantId,
      created_by: input.actorUserId,
      title: input.title,
      description: input.description ?? "",
      url: uploaded.publicUrl,
      resource_type: input.resourceType,
      thumbnail_url: input.thumbnailUrl ?? null,
      duration_sec: Number(input.durationSec ?? 0),
      topic_id: input.topicId ?? null,
      branch_relevance: input.branchRelevance ?? [],
      career_tracks: input.careerTracks ?? [],
      recommended_for: input.recommendedFor ?? [],
      content_pack_labels: input.contentPackLabels ?? [],
      source_pdf: uploaded.key,
      asset_id: assetId,
      is_active: input.isActive ?? true,
      created_at: now,
      updated_at: now,
    });
    this.clearTenantWorkspaceCache(tenantId);

    return {
      id: resourceId,
      assetId,
      url: uploaded.publicUrl,
      storageKey: uploaded.key,
    };
  },

  async updateTenantResource(input: {
    tenantId: string;
    resourceId: string;
    title?: string;
    description?: string;
    topicId?: string | null;
    resourceType?: string;
    durationSec?: number;
    thumbnailUrl?: string | null;
    isActive?: boolean;
    url?: string;
    branchRelevance?: string[];
    careerTracks?: string[];
    recommendedFor?: string[];
    contentPackLabels?: string[];
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    await assertTenantExists(tenantId);
    const db = await getMongoDb();
    const update: Record<string, unknown> = { updated_at: nowIso() };
    if (input.title !== undefined) update.title = input.title;
    if (input.description !== undefined) update.description = input.description;
    if (input.topicId !== undefined) update.topic_id = input.topicId;
    if (input.resourceType !== undefined) update.resource_type = input.resourceType;
    if (input.durationSec !== undefined) update.duration_sec = input.durationSec;
    if (input.thumbnailUrl !== undefined) update.thumbnail_url = input.thumbnailUrl;
    if (input.isActive !== undefined) update.is_active = input.isActive;
    if (input.url !== undefined) update.url = input.url;
    if (input.branchRelevance !== undefined) update.branch_relevance = input.branchRelevance;
    if (input.careerTracks !== undefined) update.career_tracks = input.careerTracks;
    if (input.recommendedFor !== undefined) update.recommended_for = input.recommendedFor;
    if (input.contentPackLabels !== undefined) update.content_pack_labels = input.contentPackLabels;

    const result = await db.collection("resources").updateOne(
      { tenant_id: tenantId, id: input.resourceId },
      { $set: update },
    );
    if (result.matchedCount === 0) {
      throw new AppError("RESOURCE_NOT_FOUND", "Tenant resource not found.", 404);
    }
    this.clearTenantWorkspaceCache(tenantId);
    return { id: input.resourceId };
  },

  async getTenantIntegrations(tenantId: string) {
    const selectedTenantId = assertSelectedTenantId(tenantId);
    const tenant = await assertTenantExists(selectedTenantId);
    const config = tenant.config && typeof tenant.config === "object" ? tenant.config as Record<string, unknown> : {};
    const adminOps = config.adminOps && typeof config.adminOps === "object" ? config.adminOps as Record<string, unknown> : {};
    const integrations = adminOps.integrations && typeof adminOps.integrations === "object" ? adminOps.integrations as Record<string, unknown> : {};
    const globalFeedback = await getGlobalFeedbackFormSettings();

    return {
      googleForm: normalizeOptionalString(integrations.googleForm) ?? globalFeedback.googleForm,
      googleSheet: normalizeOptionalString(integrations.googleSheet),
      googleDriveSharedDriveId: normalizeOptionalString(integrations.googleDriveSharedDriveId),
      googleDriveRootFolderId: normalizeOptionalString(integrations.googleDriveRootFolderId),
      googleDriveServiceAccountEmail: GoogleDriveResumeService.getStorageAuthLabel(),
      label: normalizeOptionalString(integrations.label) ?? globalFeedback.label,
      notes: normalizeOptionalString(integrations.notes) ?? globalFeedback.notes,
    };
  },

  async saveTenantIntegrations(input: {
    tenantId: string;
    googleForm?: string | null;
    googleSheet?: string | null;
    googleDriveSharedDriveId?: string | null;
    googleDriveRootFolderId?: string | null;
    label?: string | null;
    notes?: string | null;
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    const tenant = await assertTenantExists(tenantId);
    const config = tenant.config && typeof tenant.config === "object" ? tenant.config as Record<string, unknown> : {};
    const adminOps = config.adminOps && typeof config.adminOps === "object" ? config.adminOps as Record<string, unknown> : {};
    const currentIntegrations = adminOps.integrations && typeof adminOps.integrations === "object"
      ? adminOps.integrations as Record<string, unknown>
      : {};

    await saveGlobalFeedbackFormSettings({
      googleForm: input.googleForm,
      label: input.label,
      notes: input.notes,
    });

    const nextAdminOps = {
      ...adminOps,
      integrations: {
        ...currentIntegrations,
        googleForm: null,
        googleSheet: normalizeOptionalString(input.googleSheet),
        googleDriveSharedDriveId: normalizeOptionalString(input.googleDriveSharedDriveId),
        googleDriveRootFolderId: normalizeOptionalString(input.googleDriveRootFolderId),
        label: null,
        notes: null,
      },
    };

    await MongoAuthRepository.updateTenantConfig(tenantId, {
      config: {
        ...config,
        adminOps: nextAdminOps,
      },
    });

    return this.getTenantIntegrations(tenantId);
  },

  async getTenantEmailSettings(tenantId: string) {
    const selectedTenantId = assertSelectedTenantId(tenantId);
    const tenant = await assertTenantExists(selectedTenantId);
    const config = tenant.config && typeof tenant.config === "object" ? tenant.config as Record<string, unknown> : {};
    const emailSettings = config.emailSettings && typeof config.emailSettings === "object"
      ? config.emailSettings as Record<string, unknown>
      : {};

    return {
      fromName: normalizeOptionalString(emailSettings.fromName),
      fromEmail: normalizeOptionalString(emailSettings.fromEmail),
      replyToEmail: normalizeOptionalString(emailSettings.replyToEmail),
    };
  },

  async saveTenantEmailSettings(input: {
    tenantId: string;
    fromName?: string | null;
    fromEmail?: string | null;
    replyToEmail?: string | null;
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    const tenant = await MongoAuthRepository.updateTenantEmailSettings(tenantId, {
      fromName: input.fromName === null ? "" : input.fromName,
      fromEmail: input.fromEmail === null ? "" : input.fromEmail,
      replyToEmail: input.replyToEmail === null ? "" : input.replyToEmail,
    });

    if (!tenant) {
      throw new AppError("TENANT_NOT_FOUND", "Selected college was not found.", 404);
    }

    return this.getTenantEmailSettings(tenantId);
  },

  async getTenantPlacementPolicy(tenantId: string) {
    const selectedTenantId = assertSelectedTenantId(tenantId);
    const tenant = await assertTenantExists(selectedTenantId);
    const config = tenant.config && typeof tenant.config === "object" ? tenant.config as Record<string, unknown> : {};
    const placementPolicy = config.placementPolicy && typeof config.placementPolicy === "object"
      ? config.placementPolicy as Record<string, unknown>
      : {};

    return {
      excludePlacedStudentsByDefault: placementPolicy.excludePlacedStudentsByDefault === true,
    };
  },

  async saveTenantPlacementPolicy(input: {
    tenantId: string;
    excludePlacedStudentsByDefault: boolean;
  }) {
    const tenantId = assertSelectedTenantId(input.tenantId);
    const tenant = await assertTenantExists(tenantId);
    const config = tenant.config && typeof tenant.config === "object" ? tenant.config as Record<string, unknown> : {};
    const currentPlacementPolicy = config.placementPolicy && typeof config.placementPolicy === "object"
      ? config.placementPolicy as Record<string, unknown>
      : {};

    await MongoAuthRepository.updateTenantConfig(tenantId, {
      config: {
        ...config,
        placementPolicy: {
          ...currentPlacementPolicy,
          excludePlacedStudentsByDefault: input.excludePlacedStudentsByDefault,
        },
      },
    });

    return this.getTenantPlacementPolicy(tenantId);
  },

  async listJobs(tenantId: string) {
    const selectedTenantId = assertSelectedTenantId(tenantId);
    await assertTenantExists(selectedTenantId);
    const [importJobs, opsJobs] = await Promise.all([
      getMongoDb().then((db) => db.collection("student_import_jobs").find(
        { tenant_id: selectedTenantId },
        { projection: { _id: 0, id: 1 } },
      ).sort({ created_at: -1 }).limit(20).toArray()),
      AdminOpsJobService.listJobs(selectedTenantId, 20),
    ]);

    const hydratedImportJobs = await Promise.all(importJobs.map((job) => StudentImportJobService.getJob({ tenantId: selectedTenantId, jobId: String(job.id) })));
    const normalizedImports = hydratedImportJobs.map((job) => ({
      id: job.id,
      type: "student_import",
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      progress: job.totals,
      result: {
        createdStudentIds: job.createdStudentIds,
        updatedStudentIds: job.updatedStudentIds,
      },
      errorMessage: job.errorMessage,
      errors: job.errors,
    }));

    return [...normalizedImports, ...opsJobs].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  },
};
