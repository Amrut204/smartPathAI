import { randomBytes, randomUUID } from "node:crypto";
import { hash as bcryptHash } from "bcryptjs";

import { AppError } from "../middleware/error-handler.js";
import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";
import { CommunicationService } from "./communication.service.js";
import { getMongoDb } from "../utils/mongodb.js";
import { logger } from "../utils/logger.js";

export type AdminOpsJobType = "credential_batch";
export type AdminOpsJobStatus = "ready" | "queued" | "running" | "completed" | "failed" | "partial";
export type CredentialTargetType = "student" | "tpo";

type CredentialBatchInput = {
  tenantId: string;
  targetType: CredentialTargetType;
  accountIds: string[];
  reason: "new_accounts" | "reset_password" | "manual_create";
  actorName?: string | null;
};

type AdminOpsJobDocument = {
  id: string;
  type: AdminOpsJobType;
  status: AdminOpsJobStatus;
  tenant_id: string;
  created_by: string;
  input: CredentialBatchInput;
  progress: {
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
  };
  result?: Record<string, unknown>;
  errors?: Array<{ itemId?: string; message: string }>;
  error_message?: string | null;
  retry_of?: string | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
};

const COLLECTION = "admin_ops_jobs";
let indexesEnsured = false;
let drainScheduled = false;

function nowIso() {
  return new Date().toISOString();
}

function buildTemporaryPassword() {
  return `PIQ-${randomBytes(5).toString("hex").toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function buildLoginUrl() {
  const appUrl = String(process.env.APP_URL ?? "http://localhost:5173").trim().replace(/\/+$/, "");
  return `${appUrl}/login`;
}

async function ensureIndexes() {
  if (indexesEnsured) return;
  const db = await getMongoDb();
  await Promise.all([
    db.collection(COLLECTION).createIndex({ tenant_id: 1, created_at: -1 }),
    db.collection(COLLECTION).createIndex({ status: 1, updated_at: 1 }),
    db.collection(COLLECTION).createIndex({ created_by: 1, created_at: -1 }),
  ]);
  indexesEnsured = true;
}

async function loadRecipientsForStudents(tenantId: string, studentIds: string[]) {
  const db = await getMongoDb();
  const students = await db.collection("students").find(
    { tenant_id: tenantId, id: { $in: studentIds } },
    { projection: { _id: 0, id: 1, user_id: 1, roll_number: 1, profile_data: 1, branch: 1, batch: 1 } },
  ).toArray();

  const userIds = students.map((student) => String(student.user_id));
  const users = userIds.length > 0
    ? await db.collection("users").find(
        { tenant_id: tenantId, id: { $in: userIds } },
        { projection: { _id: 0, id: 1, email: 1, full_name: 1, password_version: 1 } },
      ).toArray()
    : [];

  const userMap = new Map(users.map((user) => [String(user.id), user]));
  return students.map((student) => {
    const user = userMap.get(String(student.user_id));
    return {
      studentId: String(student.id),
      userId: String(student.user_id),
      fullName: String(user?.full_name ?? "Student"),
      email: String(user?.email ?? "").trim().toLowerCase(),
      prn: String((student as { profile_data?: { prn?: unknown } }).profile_data?.prn ?? "").trim(),
      rollNumber: String(student.roll_number ?? ""),
      branch: String(student.branch ?? ""),
      batch: String(student.batch ?? ""),
      passwordVersion: Number(user?.password_version ?? 0),
    };
  });
}

async function loadRecipientsForTpos(tenantId: string, userIds: string[]) {
  const db = await getMongoDb();
  const users = await db.collection("users").find(
    { tenant_id: tenantId, role: "tpo", id: { $in: userIds } },
    { projection: { _id: 0, id: 1, email: 1, full_name: 1, password_version: 1 } },
  ).toArray();

  return users.map((user) => ({
    userId: String(user.id),
    fullName: String(user.full_name ?? "TPO"),
    email: String(user.email ?? "").trim().toLowerCase(),
    passwordVersion: Number(user.password_version ?? 0),
  }));
}

async function processCredentialBatch(job: AdminOpsJobDocument) {
  const db = await getMongoDb();
  const tenant = await MongoAuthRepository.findTenantById(job.tenant_id);
  const recipients = job.input.targetType === "tpo"
    ? await loadRecipientsForTpos(job.tenant_id, job.input.accountIds)
    : await loadRecipientsForStudents(job.tenant_id, job.input.accountIds);
  const validRecipients = recipients.filter((recipient) => recipient.email);

  if (validRecipients.length === 0) {
    throw new AppError("ADMIN_OPS_NO_RECIPIENTS", `No valid ${job.input.targetType} email addresses were available for credential delivery.`, 400);
  }

  const deliveryRows: Array<{
    userId: string;
    fullName: string;
    email: string;
    accountId: string;
    prn?: string;
    rollNumber?: string;
    tempPassword: string;
  }> = [];
  const errors: Array<{ itemId?: string; message: string }> = [];
  let processed = 0;

  for (const recipient of validRecipients) {
    try {
      const tempPassword = buildTemporaryPassword();
      const passwordHash = await bcryptHash(tempPassword, 12);
      const passwordIssuedAt = nowIso();
      const updated = await MongoAuthRepository.setPasswordForAdmin(recipient.userId, {
        passwordHash,
        mustChangePassword: true,
        passwordIssuedAt,
        onboardingBatchId: job.id,
        passwordVersion: recipient.passwordVersion + 1,
      });

      if (!updated) {
        throw new Error("Student login record not found or inactive");
      }

      const accountId = "studentId" in recipient ? String(recipient.studentId) : String(recipient.userId);
      const prn = "prn" in recipient ? String(recipient.prn ?? "") : undefined;
      const rollNumber = "rollNumber" in recipient ? String(recipient.rollNumber ?? "") : undefined;

      deliveryRows.push({
        userId: recipient.userId,
        fullName: recipient.fullName,
        email: recipient.email,
        accountId,
        prn,
        rollNumber,
        tempPassword,
      });
    } catch (error) {
      const itemId = "studentId" in recipient ? String(recipient.studentId) : String(recipient.userId);
      errors.push({
        itemId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    processed += 1;
    await db.collection(COLLECTION).updateOne(
      { id: job.id },
      {
        $set: {
          updated_at: nowIso(),
          progress: {
            total: validRecipients.length,
            processed,
            succeeded: deliveryRows.length,
            failed: errors.length,
          },
          errors: errors.slice(-50),
        },
      },
    );
  }

  if (deliveryRows.length === 0) {
    return {
      status: "failed" as const,
      result: {
        communicationId: null,
        recipientCount: 0,
        deliveredCount: 0,
      },
      errors,
      errorMessage: "No credentials could be prepared for delivery.",
    };
  }

  const communication = await CommunicationService.sendTemplatedToRecipients({
    tenantId: job.tenant_id,
    senderId: job.created_by,
    templateSlug: job.input.targetType === "tpo" ? "tpo-onboarding-credentials" : "student-onboarding-credentials",
    recipients: deliveryRows.map((row) => ({
      studentId: row.accountId,
      fullName: row.fullName,
      email: row.email,
      driveName: undefined,
      variables: {
        student_name: row.fullName,
        tpo_name: row.fullName,
        student_email: row.email,
        tpo_email: row.email,
        temporary_password: row.tempPassword,
        login_url: buildLoginUrl(),
        prn: row.prn ?? "",
        roll_number: row.rollNumber ?? "",
        roll_number_line: row.rollNumber ? `Roll number: ${row.rollNumber}\n` : "",
        issued_by: String(job.input.actorName ?? "Smart Path Admin"),
        college_name: String(tenant?.name ?? "College"),
        account_role_label: job.input.targetType === "tpo" ? "TPO" : "Student",
      },
    })),
    metadata: {
      admin_ops_job_id: job.id,
      reason: job.input.reason,
    },
    allowUnsubscribe: false,
  });

  return {
    status: errors.length > 0 ? "partial" as const : "completed" as const,
    result: {
      communicationId: communication.communicationId,
      recipientCount: validRecipients.length,
      deliveredCount: deliveryRows.length,
      failedCount: errors.length,
      mode: communication.mode,
      queueBackend: communication.queueBackend,
    },
    errors,
    errorMessage: errors.length > 0 ? `${errors.length} credential deliveries failed during preparation.` : null,
  };
}

async function processJob(jobId: string) {
  const db = await getMongoDb();
  const claimed = await db.collection<AdminOpsJobDocument>(COLLECTION).findOneAndUpdate(
    { id: jobId, status: { $in: ["queued", "failed"] } },
    {
      $set: {
        status: "running",
        started_at: nowIso(),
        updated_at: nowIso(),
        error_message: null,
      },
    },
    { returnDocument: "after" },
  );

  if (!claimed) {
    return;
  }

  try {
    const outcome = await processCredentialBatch(claimed);
    await db.collection(COLLECTION).updateOne(
      { id: jobId },
      {
        $set: {
          status: outcome.status,
          result: outcome.result,
          errors: outcome.errors,
          error_message: outcome.errorMessage,
          updated_at: nowIso(),
          finished_at: nowIso(),
          progress: {
            total: claimed.input.accountIds.length,
            processed: claimed.input.accountIds.length,
            succeeded: Number(outcome.result.deliveredCount ?? 0),
            failed: outcome.errors.length,
          },
        },
      },
    );
  } catch (error) {
    await db.collection(COLLECTION).updateOne(
      { id: jobId },
      {
        $set: {
          status: "failed",
          error_message: error instanceof Error ? error.message : String(error),
          updated_at: nowIso(),
          finished_at: nowIso(),
        },
      },
    );
    logger.error("Admin ops job failed", {
      context: {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function drainQueue() {
  drainScheduled = false;
  const db = await getMongoDb();
  const jobs = await db.collection<AdminOpsJobDocument>(COLLECTION).find(
    { status: "queued" },
    { projection: { _id: 0, id: 1 } },
  ).sort({ created_at: 1 }).limit(5).toArray();

  for (const job of jobs) {
    await processJob(String(job.id));
  }

  const remaining = await db.collection(COLLECTION).countDocuments({ status: "queued" });
  if (remaining > 0) {
    scheduleDrain();
  }
}

function scheduleDrain() {
  if (drainScheduled) return;
  drainScheduled = true;
  const timer = setTimeout(() => {
    void drainQueue();
  }, 0);
  timer.unref?.();
}

export const AdminOpsJobService = {
  async initialize() {
    await ensureIndexes();
    const db = await getMongoDb();
    await db.collection(COLLECTION).updateMany(
      { status: "running" },
      {
        $set: {
          status: "queued",
          updated_at: nowIso(),
          error_message: "Recovered after server restart; job re-queued.",
        },
      },
    );
    scheduleDrain();
  },

  async createCredentialBatchJob(params: {
    tenantId: string;
    createdBy: string;
    targetType: CredentialTargetType;
    accountIds: string[];
    reason: CredentialBatchInput["reason"];
    actorName?: string | null;
    retryOf?: string | null;
    autoStart?: boolean;
  }) {
    await ensureIndexes();
    const accountIds = [...new Set(params.accountIds.map((value) => String(value).trim()).filter(Boolean))];
    if (accountIds.length === 0) {
      throw new AppError("ADMIN_OPS_ACCOUNTS_REQUIRED", `At least one ${params.targetType} account is required for credential delivery.`, 400);
    }

    const doc: AdminOpsJobDocument = {
      id: randomUUID(),
      type: "credential_batch",
      status: params.autoStart === false ? "ready" : "queued",
      tenant_id: params.tenantId,
      created_by: params.createdBy,
      input: {
        tenantId: params.tenantId,
        targetType: params.targetType,
        accountIds,
        reason: params.reason,
        actorName: params.actorName ?? null,
      },
      progress: {
        total: accountIds.length,
        processed: 0,
        succeeded: 0,
        failed: 0,
      },
      errors: [],
      error_message: null,
      retry_of: params.retryOf ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
      started_at: null,
      finished_at: null,
    };

    const db = await getMongoDb();
    await db.collection(COLLECTION).insertOne(doc);
    if (doc.status === "queued") {
      scheduleDrain();
    }
    return this.sanitize(doc);
  },

  async createStudentCredentialBatchJob(params: {
    tenantId: string;
    createdBy: string;
    studentIds: string[];
    reason: CredentialBatchInput["reason"];
    actorName?: string | null;
    retryOf?: string | null;
    autoStart?: boolean;
  }) {
    return this.createCredentialBatchJob({
      ...params,
      targetType: "student",
      accountIds: params.studentIds,
    });
  },

  async createTpoCredentialBatchJob(params: {
    tenantId: string;
    createdBy: string;
    userIds: string[];
    reason: CredentialBatchInput["reason"];
    actorName?: string | null;
    retryOf?: string | null;
    autoStart?: boolean;
  }) {
    return this.createCredentialBatchJob({
      ...params,
      targetType: "tpo",
      accountIds: params.userIds,
    });
  },

  sanitize(job: AdminOpsJobDocument) {
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      tenantId: job.tenant_id,
      createdBy: job.created_by,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      startedAt: job.started_at ?? null,
      finishedAt: job.finished_at ?? null,
      progress: job.progress,
      result: job.result ?? null,
      errors: job.errors ?? [],
      errorMessage: job.error_message ?? null,
      retryOf: job.retry_of ?? null,
    };
  },

  async getJob(jobId: string) {
    await ensureIndexes();
    const db = await getMongoDb();
    const job = await db.collection<AdminOpsJobDocument>(COLLECTION).findOne({ id: jobId });
    if (!job) {
      throw new AppError("ADMIN_OPS_JOB_NOT_FOUND", "Admin operations job not found.", 404);
    }
    return this.sanitize(job);
  },

  async listJobs(tenantId?: string, limit = 50) {
    await ensureIndexes();
    const db = await getMongoDb();
    const filter: Record<string, unknown> = {};
    if (tenantId) {
      filter.tenant_id = tenantId;
    }
    const jobs = await db.collection<AdminOpsJobDocument>(COLLECTION).find(filter).sort({ created_at: -1 }).limit(limit).toArray();
    return jobs.map((job) => this.sanitize(job));
  },

  async retryJob(jobId: string, createdBy: string, tenantId?: string) {
    await ensureIndexes();
    const db = await getMongoDb();
    const existing = await db.collection<AdminOpsJobDocument>(COLLECTION).findOne({ id: jobId });
    if (!existing) {
      throw new AppError("ADMIN_OPS_JOB_NOT_FOUND", "Admin operations job not found.", 404);
    }
    if (tenantId && existing.tenant_id !== tenantId) {
      throw new AppError("ADMIN_OPS_JOB_TENANT_MISMATCH", "This job does not belong to the selected college.", 403);
    }
    return this.createCredentialBatchJob({
      tenantId: existing.tenant_id,
      createdBy,
      targetType: existing.input.targetType,
      accountIds: existing.input.accountIds,
      reason: existing.input.reason,
      actorName: existing.input.actorName ?? null,
      retryOf: existing.id,
    });
  },

  async releaseJob(jobId: string, tenantId?: string) {
    await ensureIndexes();
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { id: jobId, status: "ready" };
    if (tenantId) {
      filter.tenant_id = tenantId;
    }

    const job = await db.collection<AdminOpsJobDocument>(COLLECTION).findOneAndUpdate(
      filter,
      {
        $set: {
          status: "queued",
          updated_at: nowIso(),
          error_message: null,
        },
      },
      { returnDocument: "after" },
    );
    if (!job) {
      throw new AppError("ADMIN_OPS_JOB_NOT_READY", "This credential job is not available for sending.", 400);
    }
    scheduleDrain();
    return this.sanitize(job);
  },
};
