import path from "node:path";
import { Router, type Request } from "express";
import multer from "multer";
import * as XLSX from "xlsx";

import { asyncHandler } from "../middleware/error-handler.js";
import { adminBulkActionRateLimiter, adminImportRateLimiter, uploadRateLimiter } from "../middleware/rate-limit.middleware.js";
import { successResponse } from "../utils/response-envelope.js";
import { AdminOpsService } from "../services/admin-ops.service.js";
import { AuditLogService, type AuditEventType } from "../services/audit-log.service.js";
import { StudentImportJobService } from "../services/student-import-job.service.js";
import { AdminOpsJobService } from "../services/admin-ops-job.service.js";
import {
  adminCreateCollegeSchema,
  adminCreateExternalResourceSchema,
  adminCreateMockTestSchema,
  adminCreateStudentSchema,
  adminCreateTpoSchema,
  adminCsvUploadConfirmSchema,
  adminCsvUploadPreviewSchema,
  adminDeleteStudentSchema,
  adminMockTestQuerySchema,
  adminMockTestImportApplySchema,
  adminMockTestImportCreateSchema,
  adminPublishMockTestSchema,
  adminQueueImportCredentialsSchema,
  adminResetStudentCredentialsSchema,
  adminResetTpoCredentialsSchema,
  adminResourceQuerySchema,
  adminRetryJobSchema,
  adminStudentListQuerySchema,
  adminTenantQuerySchema,
  adminTpoListQuerySchema,
  adminUnlockStudentProfileSchema,
  adminUpdateIntegrationsSchema,
  adminUpdateMockTestSchema,
  adminUpdateResourceSchema,
  adminUpdateTenantEmailSettingsSchema,
  adminUpdateTenantPlacementPolicySchema,
  adminUpdateTpoSchema,
  adminUploadResourceFieldsSchema,
  adminUpsertMockQuestionsSchema,
} from "../validators/admin-ops.schema.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

async function logAdminAudit(req: Request, tenantId: string, eventType: AuditEventType, metadata?: Record<string, unknown>) {
  await AuditLogService.log({
    tenantId,
    actorUserId: req.auth!.userId,
    actorRole: req.auth!.role,
    actorTenantId: req.auth!.actorTenantId ?? req.auth!.tenantId,
    eventType,
    method: req.method,
    path: req.originalUrl ?? req.path,
    ip: (req.headers["x-forwarded-for"] as string | undefined) ?? req.ip,
    userAgent: req.headers["user-agent"] as string | undefined,
    metadata,
  });
}

router.get(
  "/tenants",
  asyncHandler(async (_req, res) => {
    const data = await AdminOpsService.listTenants();
    res.json(successResponse(data));
  }),
);

router.get(
  "/workspace",
  asyncHandler(async (req, res) => {
    const query = adminTenantQuerySchema.parse(req.query);
    const data = await AdminOpsService.getTenantWorkspace(query.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/students",
  asyncHandler(async (req, res) => {
    const query = adminStudentListQuerySchema.parse(req.query);
    const data = await AdminOpsService.listStudents(query.tenantId, query);
    res.json(successResponse(data));
  }),
);

router.get(
  "/tpo-accounts",
  asyncHandler(async (req, res) => {
    const query = adminTpoListQuerySchema.parse(req.query);
    const data = await AdminOpsService.listTpoAccounts(query.tenantId);
    res.json(successResponse(data));
  }),
);

router.post(
  "/tpo-accounts",
  asyncHandler(async (req, res) => {
    const body = adminCreateTpoSchema.parse(req.body);
    const data = await AdminOpsService.createTpoAccount({
      ...body,
      actorUserId: req.auth!.userId,
      actorName: req.auth!.email,
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_tpo_created", {
      userId: data.tpo.id,
      email: data.tpo.email,
      credentialJobId: data.credentialJob.id,
    });
    res.status(201).json(successResponse(data));
  }),
);

router.patch(
  "/tpo-accounts/:userId",
  asyncHandler(async (req, res) => {
    const body = adminUpdateTpoSchema.parse(req.body);
    const data = await AdminOpsService.updateTpoAccount({
      ...body,
      userId: String(req.params.userId),
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_tpo_updated", {
      userId: data.id,
      isActive: data.isActive,
      updatedFields: Object.keys(body).filter((key) => key !== "tenantId"),
    });
    res.json(successResponse(data));
  }),
);

router.post(
  "/tpo-accounts/:userId/reset-credentials",
  asyncHandler(async (req, res) => {
    const body = adminResetTpoCredentialsSchema.parse(req.body);
    const data = await AdminOpsService.queueTpoCredentialReset({
      tenantId: body.tenantId,
      userId: String(req.params.userId),
      actorUserId: req.auth!.userId,
      actorName: req.auth!.email,
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_tpo_credentials_reset", {
      userId: req.params.userId,
      jobId: data.id,
    });
    res.status(202).json(successResponse(data));
  }),
);

router.post(
  "/students",
  asyncHandler(async (req, res) => {
    const body = adminCreateStudentSchema.parse(req.body);
    const data = await AdminOpsService.createStudent({
      ...body,
      actorUserId: req.auth!.userId,
      actorName: req.auth!.email,
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_student_created", {
      studentId: data.student.id,
      email: data.student.email,
      prn: data.student.prn,
      rollNumber: data.student.rollNumber ?? null,
      credentialJobId: data.credentialJob.id,
    });
    res.status(201).json(successResponse(data));
  }),
);

router.post(
  "/students/import/preview",
  adminImportRateLimiter,
  asyncHandler(async (req, res) => {
    const body = adminCsvUploadPreviewSchema.parse(req.body);
    const data = await AdminOpsService.previewStudentCsv(body.csv);
    res.json(successResponse(data));
  }),
);

router.post(
  "/students/import/file-preview",
  uploadRateLimiter,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const body = adminTenantQuerySchema.parse(req.body);
    const file = req.file;
    if (!file) {
      res.status(400).json({
        success: false,
        error: { code: "UPLOAD_FILE_MISSING", message: "Upload a .csv or .xlsx file in form field 'file'." },
      });
      return;
    }

    const ext = path.extname(file.originalname ?? "").toLowerCase();
    let csv = "";

    if (ext === ".csv" || file.mimetype.includes("csv")) {
      csv = file.buffer.toString("utf8");
    } else if (ext === ".xlsx" || ext === ".xls") {
      const workbook = XLSX.read(file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
      if (!sheet) {
        res.status(400).json({
          success: false,
          error: { code: "UPLOAD_SHEET_MISSING", message: "Unable to read the first sheet from this Excel file." },
        });
        return;
      }
      csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    } else {
      res.status(400).json({
        success: false,
        error: { code: "UPLOAD_FILE_UNSUPPORTED", message: "Only .csv, .xlsx, and .xls files are supported." },
      });
      return;
    }

    const data = await AdminOpsService.previewStudentCsv(csv);
    res.json(successResponse({ ...data, tenantId: body.tenantId }));
  }),
);

router.post(
  "/students/import/jobs",
  adminImportRateLimiter,
  asyncHandler(async (req, res) => {
    const body = adminCsvUploadConfirmSchema.parse(req.body);
    const data = await AdminOpsService.createStudentImportJob({
      tenantId: body.tenantId,
      actorUserId: req.auth!.userId,
      payload: {
        mapping: body.mapping,
        rows: body.rows,
      },
    });
    res.status(202).json(successResponse(data));
  }),
);

router.get(
  "/students/import/jobs/:jobId",
  asyncHandler(async (req, res) => {
    const query = adminTenantQuerySchema.parse(req.query);
    const data = await AdminOpsService.getStudentImportJob(query.tenantId, String(req.params.jobId));
    res.json(successResponse(data));
  }),
);

router.get(
  "/students/import/jobs/:jobId/error-report.csv",
  asyncHandler(async (req, res) => {
    const query = adminTenantQuerySchema.parse(req.query);
    const csv = await StudentImportJobService.getErrorReportCsv({
      tenantId: query.tenantId,
      jobId: String(req.params.jobId),
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="student-import-${String(req.params.jobId)}-errors.csv"`);
    res.send(csv);
  }),
);

router.post(
  "/students/import/jobs/:jobId/credentials",
  adminBulkActionRateLimiter,
  asyncHandler(async (req, res) => {
    const body = adminQueueImportCredentialsSchema.parse({
      ...req.body,
      importJobId: req.params.jobId,
    });
    const data = await AdminOpsService.queueCredentialsForImport({
      tenantId: body.tenantId,
      importJobId: body.importJobId,
      actorUserId: req.auth!.userId,
      actorName: req.auth!.email,
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_credentials_queued", {
      importJobId: body.importJobId,
      jobId: data.id,
      studentCount: data.progress.total,
    });
    res.status(202).json(successResponse(data));
  }),
);

router.post(
  "/students/:studentId/reset-credentials",
  asyncHandler(async (req, res) => {
    const body = adminResetStudentCredentialsSchema.parse(req.body);
    const data = await AdminOpsService.queueStudentCredentialReset({
      tenantId: body.tenantId,
      studentId: String(req.params.studentId),
      actorUserId: req.auth!.userId,
      actorName: req.auth!.email,
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_credentials_reset", {
      studentId: req.params.studentId,
      jobId: data.id,
    });
    res.status(202).json(successResponse(data));
  }),
);

router.post(
  "/students/:studentId/send-credentials",
  asyncHandler(async (req, res) => {
    const body = adminResetStudentCredentialsSchema.parse(req.body);
    const data = await AdminOpsService.sendStudentCredentials({
      tenantId: body.tenantId,
      studentId: String(req.params.studentId),
      actorUserId: req.auth!.userId,
      actorName: req.auth!.email,
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_credentials_queued", {
      studentId: req.params.studentId,
      jobId: data.id,
      mode: "explicit_send",
    });
    res.status(202).json(successResponse(data));
  }),
);

router.post(
  "/colleges",
  asyncHandler(async (req, res) => {
    const body = adminCreateCollegeSchema.parse(req.body);
    const data = await AdminOpsService.createCollege({
      ...body,
      actorUserId: req.auth!.userId,
      actorName: req.auth!.email,
    });
    await logAdminAudit(req, data.tenant.id, "admin_ops_tpo_created", {
      tenantId: data.tenant.id,
      tenantName: data.tenant.name,
      tpoId: data.tpo.id,
      tpoEmail: data.tpo.email,
      branches: data.tenant.branches,
    });
    res.status(201).json(successResponse(data));
  }),
);

router.delete(
  "/students/:studentId",
  asyncHandler(async (req, res) => {
    const body = adminDeleteStudentSchema.parse(req.body);
    const data = await AdminOpsService.deleteStudent({
      tenantId: body.tenantId,
      studentId: String(req.params.studentId),
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_student_deleted", {
      studentId: data.studentId,
      userId: data.userId,
      email: data.email,
      fullName: data.fullName,
      removedCollections: data.removedCollections,
    });
    res.json(successResponse(data));
  }),
);

router.post(
  "/students/:studentId/unlock-profile",
  asyncHandler(async (req, res) => {
    const body = adminUnlockStudentProfileSchema.parse(req.body);
    const data = await AdminOpsService.unlockStudentProfile({
      tenantId: body.tenantId,
      studentId: String(req.params.studentId),
      actorUserId: req.auth!.userId,
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_student_updated", {
      studentId: data.studentId,
      userId: data.userId,
      unlockedAt: data.unlockedAt,
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/mock-tests",
  asyncHandler(async (req, res) => {
    const query = adminMockTestQuerySchema.parse(req.query);
    const data = await AdminOpsService.listMockTests(query.tenantId);
    res.json(successResponse(data));
  }),
);

router.post(
  "/mock-tests/import/preview",
  uploadRateLimiter,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const body = adminTenantQuerySchema.parse(req.body);
    const file = req.file;
    if (!file) {
      res.status(400).json({
        success: false,
        error: { code: "UPLOAD_FILE_MISSING", message: "Upload a .csv, .xlsx, or .xls file in form field 'file'." },
      });
      return;
    }

    const ext = path.extname(file.originalname ?? "").toLowerCase();
    if (![".csv", ".xlsx", ".xls"].includes(ext)) {
      res.status(400).json({
        success: false,
        error: { code: "UPLOAD_FILE_UNSUPPORTED", message: "Only .csv, .xlsx, and .xls files are supported." },
      });
      return;
    }

    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!sheet) {
      res.status(400).json({
        success: false,
        error: { code: "UPLOAD_SHEET_MISSING", message: "Unable to read the first sheet from this file." },
      });
      return;
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
      blankrows: false,
    }).map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [String(key), String(value ?? "").trim()]),
      ),
    );

    const data = await AdminOpsService.previewMockQuestionImport(rows);
    res.json(successResponse({ ...data, tenantId: body.tenantId }));
  }),
);

router.post(
  "/mock-tests/import/create",
  asyncHandler(async (req, res) => {
    const body = adminMockTestImportCreateSchema.parse(req.body);
    const data = await AdminOpsService.createMockTestFromImportedRows({
      ...body,
      tenantId: body.tenantId,
      actorUserId: req.auth!.userId,
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_mock_test_created", {
      testId: data.id,
      title: data.title,
      isActive: data.isActive,
      questionCount: data.questionCount,
      audienceSummary: data.audienceSummary,
      importMode: "excel_csv",
    });
    res.status(201).json(successResponse(data));
  }),
);

router.post(
  "/mock-tests/:testId/import",
  asyncHandler(async (req, res) => {
    const body = adminMockTestImportApplySchema.parse(req.body);
    const data = await AdminOpsService.updateMockTestQuestionsFromImportedRows({
      tenantId: body.tenantId,
      testId: String(req.params.testId),
      append: body.append,
      rows: body.rows,
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_mock_test_updated", {
      testId: req.params.testId,
      append: body.append,
      questionCount: data.questionCount,
      importMode: "excel_csv",
    });
    res.json(successResponse(data));
  }),
);

router.post(
  "/mock-tests",
  asyncHandler(async (req, res) => {
    const body = adminCreateMockTestSchema.parse(req.body);
    const data = await AdminOpsService.createMockTest({
      ...body,
      tenantId: body.tenantId,
      actorUserId: req.auth!.userId,
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_mock_test_created", {
      testId: data.id,
      title: data.title,
      isActive: data.isActive,
      questionCount: data.questionCount,
    });
    res.status(201).json(successResponse(data));
  }),
);

router.patch(
  "/mock-tests/:testId",
  asyncHandler(async (req, res) => {
    const body = adminUpdateMockTestSchema.parse(req.body);
    const data = await AdminOpsService.updateMockTest({
      ...body,
      testId: String(req.params.testId),
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_mock_test_updated", {
      testId: data.id,
      title: data.title,
      isActive: data.isActive,
    });
    res.json(successResponse(data));
  }),
);

router.post(
  "/mock-tests/:testId/publish",
  asyncHandler(async (req, res) => {
    const body = adminPublishMockTestSchema.parse(req.body);
    const data = await AdminOpsService.publishMockTest({
      tenantId: body.tenantId,
      testId: String(req.params.testId),
      isActive: body.isActive,
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_mock_test_published", {
      testId: data.id,
      isActive: data.isActive,
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/mock-tests/:testId/questions",
  asyncHandler(async (req, res) => {
    const query = adminTenantQuerySchema.parse(req.query);
    const data = await AdminOpsService.getMockTestQuestions(query.tenantId, String(req.params.testId));
    res.json(successResponse(data));
  }),
);

router.put(
  "/mock-tests/:testId/questions",
  asyncHandler(async (req, res) => {
    const body = adminUpsertMockQuestionsSchema.parse(req.body);
    const data = await AdminOpsService.updateMockTestQuestions({
      tenantId: body.tenantId,
      testId: String(req.params.testId),
      append: body.append,
      questions: body.questions,
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_mock_test_updated", {
      testId: req.params.testId,
      append: body.append,
      questionCount: body.questions.length,
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/resources",
  asyncHandler(async (req, res) => {
    const query = adminResourceQuerySchema.parse(req.query);
    const data = await AdminOpsService.listTenantResources(query.tenantId);
    res.json(successResponse(data));
  }),
);

router.post(
  "/resources/external",
  asyncHandler(async (req, res) => {
    const body = adminCreateExternalResourceSchema.parse(req.body);
    const data = await AdminOpsService.createExternalResource({
      ...body,
      tenantId: body.tenantId,
      actorUserId: req.auth!.userId,
      topicId: body.topicId ?? null,
      thumbnailUrl: body.thumbnailUrl ?? null,
      isActive: body.isActive ?? true,
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_resource_created", {
      resourceId: data.id,
      title: body.title,
      resourceType: body.resourceType,
      uploadMode: "external",
    });
    res.status(201).json(successResponse(data));
  }),
);

router.post(
  "/resources/upload",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const body = adminUploadResourceFieldsSchema.parse(req.body);
    const file = req.file;
    if (!file) {
      res.status(400).json({
        success: false,
        error: { code: "UPLOAD_FILE_MISSING", message: "Upload a file in form field 'file'." },
      });
      return;
    }

    const data = await AdminOpsService.uploadTenantResource({
      ...body,
      tenantId: body.tenantId,
      actorUserId: req.auth!.userId,
      topicId: body.topicId ?? null,
      fileName: file.originalname,
      fileBuffer: file.buffer,
      thumbnailUrl: body.thumbnailUrl ?? null,
      isActive: body.isActive ?? true,
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_resource_created", {
      resourceId: data.id,
      assetId: data.assetId,
      storageKey: data.storageKey,
      uploadMode: "s3",
      fileName: file.originalname,
    });
    res.status(201).json(successResponse(data));
  }),
);

router.patch(
  "/resources/:resourceId",
  asyncHandler(async (req, res) => {
    const body = adminUpdateResourceSchema.parse(req.body);
    const data = await AdminOpsService.updateTenantResource({
      ...body,
      tenantId: body.tenantId,
      resourceId: String(req.params.resourceId),
      topicId: body.topicId === undefined ? undefined : (body.topicId ?? null),
      thumbnailUrl: body.thumbnailUrl === undefined ? undefined : (body.thumbnailUrl ?? null),
      url: body.url === undefined ? undefined : (body.url ?? undefined),
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_resource_updated", {
      resourceId: data.id,
      updatedFields: Object.keys(body).filter((key) => key !== "tenantId"),
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/integrations",
  asyncHandler(async (req, res) => {
    const query = adminTenantQuerySchema.parse(req.query);
    const data = await AdminOpsService.getTenantIntegrations(query.tenantId);
    res.json(successResponse(data));
  }),
);

router.put(
  "/integrations",
  asyncHandler(async (req, res) => {
    const body = adminUpdateIntegrationsSchema.parse(req.body);
    const data = await AdminOpsService.saveTenantIntegrations({
      ...body,
      tenantId: body.tenantId,
      googleForm: body.googleForm ?? null,
      googleSheet: body.googleSheet ?? null,
      googleDriveSharedDriveId: body.googleDriveSharedDriveId ?? null,
      googleDriveRootFolderId: body.googleDriveRootFolderId ?? null,
      label: body.label ?? null,
      notes: body.notes ?? null,
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_integrations_updated", {
      hasGoogleForm: Boolean(data.googleForm),
      hasGoogleSheet: Boolean(data.googleSheet),
      hasGoogleDriveSharedDriveId: Boolean(data.googleDriveSharedDriveId),
      hasGoogleDriveRootFolderId: Boolean(data.googleDriveRootFolderId),
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/email-settings",
  asyncHandler(async (req, res) => {
    const query = adminTenantQuerySchema.parse(req.query);
    const data = await AdminOpsService.getTenantEmailSettings(query.tenantId);
    res.json(successResponse(data));
  }),
);

router.put(
  "/email-settings",
  asyncHandler(async (req, res) => {
    const body = adminUpdateTenantEmailSettingsSchema.parse(req.body);
    const data = await AdminOpsService.saveTenantEmailSettings({
      ...body,
      tenantId: body.tenantId,
      fromName: body.fromName ?? null,
      fromEmail: body.fromEmail ?? null,
      replyToEmail: body.replyToEmail ?? null,
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_email_settings_updated", {
      fromName: data.fromName,
      fromEmail: data.fromEmail,
      replyToEmail: data.replyToEmail,
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/placement-policy",
  asyncHandler(async (req, res) => {
    const query = adminTenantQuerySchema.parse(req.query);
    const data = await AdminOpsService.getTenantPlacementPolicy(query.tenantId);
    res.json(successResponse(data));
  }),
);

router.put(
  "/placement-policy",
  asyncHandler(async (req, res) => {
    const body = adminUpdateTenantPlacementPolicySchema.parse(req.body);
    const data = await AdminOpsService.saveTenantPlacementPolicy({
      tenantId: body.tenantId,
      excludePlacedStudentsByDefault: body.excludePlacedStudentsByDefault,
    });
    await logAdminAudit(req, body.tenantId, "admin_ops_placement_policy_updated", {
      excludePlacedStudentsByDefault: data.excludePlacedStudentsByDefault,
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/jobs",
  asyncHandler(async (req, res) => {
    const query = adminTenantQuerySchema.parse(req.query);
    const data = await AdminOpsService.listJobs(query.tenantId);
    res.json(successResponse(data));
  }),
);

router.post(
  "/jobs/:jobId/retry",
  adminBulkActionRateLimiter,
  asyncHandler(async (req, res) => {
    const query = adminRetryJobSchema.parse(req.body);
    await AdminOpsService.getTenantWorkspace(query.tenantId);
    const data = await AdminOpsJobService.retryJob(String(req.params.jobId), req.auth!.userId, query.tenantId);
    res.status(202).json(successResponse(data));
  }),
);

router.post(
  "/jobs/:jobId/release",
  adminBulkActionRateLimiter,
  asyncHandler(async (req, res) => {
    const query = adminRetryJobSchema.parse(req.body);
    await AdminOpsService.getTenantWorkspace(query.tenantId);
    const data = await AdminOpsJobService.releaseJob(String(req.params.jobId), query.tenantId);
    await logAdminAudit(req, query.tenantId, "admin_ops_credentials_queued", {
      jobId: data.id,
      mode: "job_release",
    });
    res.status(202).json(successResponse(data));
  }),
);

export default router;
