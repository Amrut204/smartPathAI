import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { StudentRepository } from "../repositories/student.repository.js";
import { ReadinessService } from "./readiness.service.js";
import { logger } from "../utils/logger.js";
import { getMongoDb } from "../utils/mongodb.js";

type StudentImportJobStatus = "queued" | "running" | "completed" | "failed";

type StudentImportPayload = {
  mapping: {
    fullName: string;
    email: string;
    rollNumber: string;
    branch: string;
    batch: string;
    cgpa?: string;
    backlogs?: string;
    attendancePct?: string;
  };
  rows: Array<Record<string, string>>;
};

type StudentImportJobDoc = {
  id: string;
  tenant_id: string;
  created_by: string;
  status: StudentImportJobStatus;
  created_at: string;
  updated_at: string;
  started_at?: string;
  finished_at?: string;

  total_rows: number;
  processed_rows: number;
  created: number;
  updated: number;
  skipped: number;
  error_count: number;

  // Only available when completed/failed.
  errors?: Array<{ row: number; message: string }>;
  error_csv?: string | null;
  error_message?: string | null;
  created_student_ids?: string[];
  updated_student_ids?: string[];

  // Stored only while queued/running, cleared on completion.
  payload?: StudentImportPayload;
};

function sanitizeJob(job: StudentImportJobDoc) {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    startedAt: job.started_at ?? null,
    finishedAt: job.finished_at ?? null,
    totals: {
      totalRows: job.total_rows,
      processedRows: job.processed_rows,
      created: job.created,
      updated: job.updated,
      skipped: job.skipped,
      errorCount: job.error_count,
    },
    createdStudentIds: job.created_student_ids ?? [],
    updatedStudentIds: job.updated_student_ids ?? [],
    errors: job.errors ?? [],
    errorCsvAvailable: Boolean(job.error_csv),
    errorMessage: job.error_message ?? null,
  };
}

export const StudentImportJobService = {
  async createJob(params: { tenantId: string; createdBy: string; payload: StudentImportPayload }) {
    const db = await getMongoDb();
    const now = new Date().toISOString();
    const jobId = randomUUID();

    const totalRows = params.payload.rows.length;
    if (totalRows < 1) {
      throw new AppError("IMPORT_ROWS_REQUIRED", "At least one row is required", 400);
    }
    if (totalRows > 5000) {
      throw new AppError("IMPORT_ROWS_TOO_LARGE", "Too many rows (max 5000 per import)", 400);
    }

    const doc: StudentImportJobDoc = {
      id: jobId,
      tenant_id: params.tenantId,
      created_by: params.createdBy,
      status: "queued",
      created_at: now,
      updated_at: now,
      total_rows: totalRows,
      processed_rows: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      error_count: 0,
      payload: params.payload,
    };

    await db.collection("student_import_jobs").insertOne(doc);

    // Inline background processing (BullMQ can be wired later without changing the API).
    setTimeout(() => {
      void StudentImportJobService.processJob({ tenantId: params.tenantId, jobId }).catch((error) => {
        logger.error("Student import job crashed", {
          context: {
            tenantId: params.tenantId,
            jobId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      });
    }, 0);

    return sanitizeJob(doc);
  },

  async getJob(params: { tenantId: string; jobId: string }) {
    const db = await getMongoDb();
    const job = await db.collection("student_import_jobs").findOne(
      { tenant_id: params.tenantId, id: params.jobId },
      {
        projection: {
          _id: 0,
          id: 1,
          status: 1,
          created_at: 1,
          updated_at: 1,
          started_at: 1,
          finished_at: 1,
          total_rows: 1,
          processed_rows: 1,
          created: 1,
          updated: 1,
          skipped: 1,
          error_count: 1,
          created_student_ids: 1,
          updated_student_ids: 1,
          errors: 1,
          error_csv: 1,
          error_message: 1,
        },
      },
    ) as StudentImportJobDoc | null;

    if (!job) {
      throw new AppError("IMPORT_JOB_NOT_FOUND", "Import job not found", 404);
    }

    return sanitizeJob(job);
  },

  async getErrorReportCsv(params: { tenantId: string; jobId: string }) {
    const db = await getMongoDb();
    const job = await db.collection("student_import_jobs").findOne(
      { tenant_id: params.tenantId, id: params.jobId },
      { projection: { _id: 0, status: 1, error_csv: 1 } },
    ) as { status?: StudentImportJobStatus; error_csv?: string | null } | null;

    if (!job) {
      throw new AppError("IMPORT_JOB_NOT_FOUND", "Import job not found", 404);
    }
    if (!job.error_csv) {
      throw new AppError("IMPORT_ERROR_REPORT_MISSING", "No error report available for this import job", 404);
    }

    return String(job.error_csv);
  },

  async processJob(params: { tenantId: string; jobId: string }) {
    const db = await getMongoDb();
    const now = new Date().toISOString();

    const claim = await db.collection("student_import_jobs").updateOne(
      { tenant_id: params.tenantId, id: params.jobId, status: "queued" },
      { $set: { status: "running", started_at: now, updated_at: now } },
    );
    if (claim.matchedCount === 0) {
      return;
    }

    const job = await db.collection("student_import_jobs").findOne(
      { tenant_id: params.tenantId, id: params.jobId },
      { projection: { _id: 0, id: 1, tenant_id: 1, payload: 1, total_rows: 1 } },
    ) as StudentImportJobDoc | null;

    if (!job) {
      return;
    }

    const payload = job.payload;
    if (!payload) {
      await db.collection("student_import_jobs").updateOne(
        { tenant_id: params.tenantId, id: params.jobId },
        {
          $set: {
            status: "failed",
            error_message: "Import payload is missing",
            finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
      );
      return;
    }

    try {
      const report = await StudentRepository.upsertStudentsFromCsv(
        params.tenantId,
        payload.rows,
        payload.mapping,
        {
          progressInterval: 25,
          onProgress: async (progress) => {
            await db.collection("student_import_jobs").updateOne(
              { tenant_id: params.tenantId, id: params.jobId },
              {
                $set: {
                  processed_rows: progress.processedRows,
                  created: progress.created,
                  updated: progress.updated,
                  skipped: progress.skipped,
                  error_count: progress.errorCount,
                  updated_at: new Date().toISOString(),
                },
              },
            );
          },
        },
      );

      const studentIds = [...new Set([...(report.createdStudentIds ?? []), ...(report.updatedStudentIds ?? [])])];
      await Promise.all(studentIds.map((studentId) => ReadinessService.calculate(params.tenantId, studentId)));

      const finishedAt = new Date().toISOString();
      await db.collection("student_import_jobs").updateOne(
        { tenant_id: params.tenantId, id: params.jobId },
        {
          $set: {
            status: "completed",
            processed_rows: payload.rows.length,
            created: report.created,
            updated: report.updated,
            skipped: report.skipped,
            error_count: report.errors.length,
            created_student_ids: report.createdStudentIds,
            updated_student_ids: report.updatedStudentIds,
            errors: report.errors.slice(0, 200),
            error_csv: report.errorCsv ?? null,
            updated_at: finishedAt,
            finished_at: finishedAt,
          },
          $unset: {
            payload: "",
          },
        },
      );
    } catch (error) {
      const finishedAt = new Date().toISOString();
      await db.collection("student_import_jobs").updateOne(
        { tenant_id: params.tenantId, id: params.jobId },
        {
          $set: {
            status: "failed",
            error_message: error instanceof Error ? error.message : String(error),
            updated_at: finishedAt,
            finished_at: finishedAt,
          },
          $unset: {
            payload: "",
          },
        },
      );
    }
  },
};
