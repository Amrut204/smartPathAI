import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import path from "node:path";

import { asyncHandler } from "../middleware/error-handler.js";
import { requireFeature } from "../middleware/feature-flag.middleware.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { requireCompletedStudentProfile } from "../middleware/student-profile.middleware.js";
import { StudentService } from "../services/student.service.js";
import { RiskAssessmentService } from "../services/risk-assessment.service.js";
import { StudentImportJobService } from "../services/student-import-job.service.js";
import { uploadRateLimiter } from "../middleware/rate-limit.middleware.js";
import {
  studyHoursSchema,
  updateTopicProgressSchema,
  bulkTopicProgressSchema,
  updateStudentProfileSchema,
  studentDriveApplySchema,
  studentDriveWithdrawSchema,
  studentOnboardingDeclarationSchema,
  studentProfileCertificationSchema,
  leaderboardQuerySchema,
  pointsHistoryQuerySchema,
  tpoStudentListQuerySchema,
  tpoStudentUpdateSchema,
  csvUploadPreviewSchema,
  csvUploadConfirmSchema,
} from "../validators/student.schema.js";
import { successResponse } from "../utils/response-envelope.js";
import { clampListLimit } from "../utils/pagination.js";
import { CommunicationService } from "../services/communication.service.js";
import { studentAnnouncementsQuerySchema } from "../validators/communication.schema.js";
import { AuditLogService } from "../services/audit-log.service.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// All student routes require authentication
router.use(asyncHandler(requireAuth));

// --- Student self-service routes ---

router.get(
  "/me/pilot-dashboard",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await StudentService.getPilotDashboard(req.auth!.tenantId, req.auth!.userId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/me/drives",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await StudentService.listStudentDrives(req.auth!.tenantId, req.auth!.userId);
    res.json(successResponse(data));
  }),
);

router.post(
  "/me/declaration/onboarding-accept",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const body = studentOnboardingDeclarationSchema.parse(req.body);
    const data = await StudentService.acceptOnboardingDeclaration({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      typedValue: body.typedValue,
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/me/declaration-status",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await StudentService.getMyDeclarationStatus(req.auth!.tenantId, req.auth!.userId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/me/profile-certification-preview",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await StudentService.getProfileCertificationPreview(req.auth!.tenantId, req.auth!.userId);
    res.json(successResponse(data));
  }),
);

router.post(
  "/me/profile-certification",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const body = studentProfileCertificationSchema.parse(req.body);
    const data = await StudentService.certifyProfile({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      typedValue: body.typedValue,
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/me/drives/:driveId/declaration-preview",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await StudentService.getDriveDeclarationPreview(
      req.auth!.tenantId,
      req.auth!.userId,
      String(req.params.driveId),
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/me/drives/:driveId/apply",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const body = studentDriveApplySchema.parse(req.body);
    const data = await StudentService.applyToDrive({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      driveId: String(req.params.driveId),
      confirmDeclaration: body.confirmDeclaration,
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/me",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const profile = await StudentService.getMyProfile(req.auth!.tenantId, req.auth!.userId);
    res.json(successResponse(profile));
  }),
);

router.patch(
  "/me",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const body = updateStudentProfileSchema.parse(req.body);
    const updated = await StudentService.updateMyProfile({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      ...body,
    });
    res.json(successResponse(updated));
  }),
);

router.post(
  "/me/resume",
  authorizeRole("student"),
  upload.single("resume"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: { code: "RESUME_FILE_MISSING", message: "Upload a PDF file in form field 'resume'." },
      });
      return;
    }

    const updated = await StudentService.uploadMyResume({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      file: {
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      },
    });
    res.json(successResponse(updated));
  }),
);

router.get(
  "/me/dashboard",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await StudentService.getDashboard(req.auth!.tenantId, req.auth!.userId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/me/announcements",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const query = studentAnnouncementsQuerySchema.parse(req.query);
    const data = await CommunicationService.listStudentAnnouncements(
      req.auth!.tenantId,
      req.auth!.userId,
      query,
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/me/announcements/:announcementId/read",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await CommunicationService.markAnnouncementRead(
      req.auth!.tenantId,
      req.auth!.userId,
      String(req.params.announcementId),
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/me/announcements/:announcementId/dismiss-popup",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await CommunicationService.dismissAnnouncementPopup(
      req.auth!.tenantId,
      req.auth!.userId,
      String(req.params.announcementId),
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/me/announcements/mark-seen",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await CommunicationService.markAnnouncementsSeen(
      req.auth!.tenantId,
      req.auth!.userId,
    );
    res.json(successResponse(data));
  }),
);

router.get(
  "/my-risk-score",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await RiskAssessmentService.getStudentRiskScore(req.auth!.tenantId, req.auth!.userId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/me/mastery",
  requireFeature("mastery"),
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await StudentService.getMastery(req.auth!.tenantId, req.auth!.userId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/me/topic-progress",
  requireFeature("mastery"),
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await StudentService.getTopicProgress(req.auth!.tenantId, req.auth!.userId);
    res.json(successResponse(data));
  }),
);

router.patch(
  "/me/topic-progress",
  requireFeature("mastery"),
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const body = updateTopicProgressSchema.parse(req.body);
    const data = await StudentService.updateTopicProgress({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      topicId: body.topicId,
      status: body.status,
    });
    res.json(successResponse(data));
  }),
);

router.patch(
  "/me/topic-progress/bulk",
  requireFeature("mastery"),
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const body = bulkTopicProgressSchema.parse(req.body);
    const data = await StudentService.updateTopicProgressBulk({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      topicIds: body.topicIds,
      status: body.status,
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/me/points",
  requireFeature("points"),
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const query = pointsHistoryQuerySchema.parse(req.query);
    const data = await StudentService.getPointsHistory(
      req.auth!.tenantId,
      req.auth!.userId,
      query.limit,
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/me/study-hours",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const body = studyHoursSchema.parse(req.body);
    const result = await StudentService.logStudyHours({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      ...body,
    });
    res.status(201).json(successResponse(result));
  }),
);

router.get(
  "/me/study-hours",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const limit = clampListLimit(req.query.limit, { defaultLimit: 30, maxLimit: 200 });
    const data = await StudentService.getStudyHoursHistory(
      req.auth!.tenantId,
      req.auth!.userId,
      limit,
    );
    res.json(successResponse(data));
  }),
);

// --- Shared routes ---

router.get(
  "/leaderboard",
  requireFeature("points"),
  asyncHandler(async (req, res) => {
    const query = leaderboardQuerySchema.parse(req.query);
    const data = await StudentService.getLeaderboard(
      req.auth!.tenantId,
      query.limit,
      query.cursor,
    );
    res.json(successResponse(data));
  }),
);

// --- Vault & Resources routes ---

router.get(
  "/vault/companies",
  requireFeature("vault"),
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await StudentService.getVaultCompanies(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/vault/companies/:companyId",
  requireFeature("vault"),
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await StudentService.getVaultByCompany(
      req.auth!.tenantId,
      req.auth!.userId,
      req.params.companyId as string,
    );
    res.json(successResponse(data));
  }),
);

router.get(
  "/resources",
  authorizeRole("student"),
  asyncHandler(requireCompletedStudentProfile),
  asyncHandler(async (req, res) => {
    const topicId = req.query.topicId as string | undefined;
    const limit = clampListLimit(req.query.limit, { defaultLimit: 24, maxLimit: 100 });
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const data = await StudentService.getResourcesPage(req.auth!.tenantId, req.auth!.userId, {
      topicId,
      limit,
      cursor,
    });
    res.json(successResponse(data.items, {
      pagination: {
        cursor: data.nextCursor,
        has_more: data.hasMore,
        limit,
      },
    }));
  }),
);

router.post(
  "/me/drives/:driveId/withdraw",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const body = studentDriveWithdrawSchema.parse(req.body);
    const data = await StudentService.withdrawFromDrive({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      driveId: String(req.params.driveId),
    });
    await AuditLogService.log({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      eventType: "drive_application_withdrawn",
      metadata: { driveId: String(req.params.driveId) },
    });
    res.json(successResponse({ ...data, confirmed: body.confirmWithdrawal }));
  }),
);

// --- TPO routes ---

router.get(
  "/",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const query = tpoStudentListQuerySchema.parse(req.query);
    const data = await StudentService.listStudentsForTpo(req.auth!.tenantId, query);
    res.json(successResponse(data));
  }),
);

router.get(
  "/:studentId",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const data = await StudentService.getStudentByIdForTpo(
      req.auth!.tenantId,
      req.params.studentId as string,
    );
    res.json(successResponse(data));
  }),
);

router.patch(
  "/:studentId",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const body = tpoStudentUpdateSchema.parse(req.body);
    const data = await StudentService.updateStudentAcademicForTpo(
      req.auth!.tenantId,
      req.params.studentId as string,
      body,
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/upload",
  authorizeRole("tpo", "admin"),
  uploadRateLimiter,
  asyncHandler(async (req, res) => {
    const body = csvUploadPreviewSchema.parse(req.body);
    const preview = StudentService.parseCsvPreview(body.csv);
    res.json(successResponse(preview));
  }),
);

router.post(
  "/upload/file-preview",
  authorizeRole("tpo", "admin"),
  uploadRateLimiter,
  upload.single("file"),
  asyncHandler(async (req, res) => {
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

    const preview = StudentService.parseCsvPreview(csv);
    res.json(successResponse(preview));
  }),
);

router.post(
  "/upload/confirm",
  authorizeRole("tpo", "admin"),
  uploadRateLimiter,
  asyncHandler(async (req, res) => {
    const body = csvUploadConfirmSchema.parse(req.body);
    const result = await StudentService.confirmCsvUpload(req.auth!.tenantId, body);
    res.json(successResponse(result));
  }),
);

router.post(
  "/upload/confirm-async",
  authorizeRole("tpo", "admin"),
  uploadRateLimiter,
  asyncHandler(async (req, res) => {
    const body = csvUploadConfirmSchema.parse(req.body);
    const job = await StudentImportJobService.createJob({
      tenantId: req.auth!.tenantId,
      createdBy: req.auth!.userId,
      payload: body,
    });
    res.status(202).json(successResponse(job));
  }),
);

router.get(
  "/upload/jobs/:jobId",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const jobId = String(req.params.jobId ?? "").trim();
    const job = await StudentImportJobService.getJob({ tenantId: req.auth!.tenantId, jobId });
    res.json(successResponse(job));
  }),
);

router.get(
  "/upload/jobs/:jobId/error-report.csv",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const jobId = String(req.params.jobId ?? "").trim();
    const csv = await StudentImportJobService.getErrorReportCsv({ tenantId: req.auth!.tenantId, jobId });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="student-import-${jobId}-errors.csv"`);
    res.send(csv);
  }),
);

export default router;
