import { Router } from "express";

import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { DriveService } from "../services/drive.service.js";
import { DriveExportService } from "../services/drive-export.service.js";
import { AuditLogService } from "../services/audit-log.service.js";
import { exportRateLimiter, resultReleaseRateLimiter } from "../middleware/rate-limit.middleware.js";
import {
  driveListQuerySchema,
  createDriveSchema,
  previewDriveEligibilitySchema,
  updateDriveSchema,
  updateDriveResultsSchema,
  driveEligibilityOverrideSchema,
  driveResultReleasePreviewSchema,
  driveResultReleaseSchema,
} from "../validators/drive.schema.js";
import { successResponse } from "../utils/response-envelope.js";

const router = Router();

router.use(asyncHandler(requireAuth));
router.use(authorizeRole("tpo", "admin"));

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = driveListQuerySchema.parse(req.query);
    const data = await DriveService.listDrives(req.auth!.tenantId, query);
    res.json(successResponse(data));
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createDriveSchema.parse(req.body);
    const data = await DriveService.createDrive(
      req.auth!.tenantId,
      req.auth!.userId,
      body,
    );
    await AuditLogService.log({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      eventType: "drive_created",
      metadata: { driveId: data.id, company: data.company, status: data.status },
    });
    res.status(201).json(successResponse(data));
  }),
);

router.post(
  "/eligibility/preview",
  asyncHandler(async (req, res) => {
    const body = previewDriveEligibilitySchema.parse(req.body);
    const data = await DriveService.previewEligibility(req.auth!.tenantId, body.criteria);
    res.json(successResponse(data));
  }),
);

router.get(
  "/:driveId",
  asyncHandler(async (req, res) => {
    const data = await DriveService.getDriveById(
      req.auth!.tenantId,
      req.params.driveId as string,
    );
    res.json(successResponse(data));
  }),
);

router.get(
  "/:driveId/export/resumes",
  exportRateLimiter,
  asyncHandler(async (req, res) => {
    const { filename, csv } = await DriveExportService.buildResumeCsv(
      req.auth!.tenantId,
      req.params.driveId as string,
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  }),
);

router.get(
  "/:driveId/export",
  exportRateLimiter,
  asyncHandler(async (req, res) => {
    const format = String(req.query.format ?? "csv").trim().toLowerCase();

    if (format === "csv") {
      const { filename, csv } = await DriveExportService.buildEligibleCsv(
        req.auth!.tenantId,
        req.params.driveId as string,
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
      return;
    }

    if (format === "pdf") {
      const { filename, bytes } = await DriveExportService.buildSummaryPdf(
        req.auth!.tenantId,
        req.params.driveId as string,
      );
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(Buffer.from(bytes));
      return;
    }

    res.status(400).json({
      success: false,
      error: { code: "EXPORT_FORMAT_UNSUPPORTED", message: "Supported formats: csv, pdf" },
    });
  }),
);

router.patch(
  "/:driveId",
  asyncHandler(async (req, res) => {
    const body = updateDriveSchema.parse(req.body);
    const previous = await DriveService.getDriveById(req.auth!.tenantId, req.params.driveId as string);
    const data = await DriveService.updateDrive(
      req.auth!.tenantId,
      req.params.driveId as string,
      body,
    );
    await AuditLogService.log({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      eventType: body.status && previous.status !== data.status ? "drive_status_changed" : "drive_updated",
      metadata: { driveId: data.id, previousStatus: previous.status, status: data.status, criteriaChanged: body.criteria !== undefined },
    });
    res.json(successResponse(data));
  }),
);

router.delete(
  "/:driveId",
  asyncHandler(async (req, res) => {
    await DriveService.deleteDrive(req.auth!.tenantId, req.params.driveId as string);
    res.json(successResponse({ message: "Drive deleted" }));
  }),
);

router.post(
  "/:driveId/eligibility",
  asyncHandler(async (req, res) => {
    const data = await DriveService.computeEligibility(
      req.auth!.tenantId,
      req.params.driveId as string,
      req.auth!.userId,
    );
    await AuditLogService.log({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      eventType: "drive_eligibility_recomputed",
      metadata: { driveId: req.params.driveId as string, eligibleCount: data.eligibleCount, totalStudents: data.totalStudents, previewDigest: data.previewDigest },
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/:driveId/results",
  asyncHandler(async (req, res) => {
    const data = await DriveService.listDriveResults(
      req.auth!.tenantId,
      req.params.driveId as string,
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/:driveId/results",
  asyncHandler(async (req, res) => {
    const body = updateDriveResultsSchema.parse(req.body);
    const data = await DriveService.updateDriveResults(
      req.auth!.tenantId,
      req.params.driveId as string,
      {
        ...body,
        actorUserId: req.auth!.userId,
        allowOutcomeOverride: body.allowOutcomeOverride && req.auth!.role === "admin",
      },
    );
    await AuditLogService.log({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      eventType: "drive_results_updated",
      metadata: { driveId: req.params.driveId as string, updated: data.updated },
    });
    res.json(successResponse(data));
  }),
);

router.post(
  "/:driveId/results/release-preview",
  asyncHandler(async (req, res) => {
    const body = driveResultReleasePreviewSchema.parse(req.body);
    const data = await DriveService.previewResultRelease(
      req.auth!.tenantId,
      req.params.driveId as string,
      body,
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/:driveId/results/release",
  resultReleaseRateLimiter,
  asyncHandler(async (req, res) => {
    const body = driveResultReleaseSchema.parse(req.body);
    const data = await DriveService.releaseDriveResults({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      driveId: req.params.driveId as string,
      audience: body.audience,
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/:driveId/results/release-status",
  asyncHandler(async (req, res) => {
    const data = await DriveService.getDriveReleaseStatus(
      req.auth!.tenantId,
      req.params.driveId as string,
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/:driveId/results/:studentId/resend-result-email",
  asyncHandler(async (req, res) => {
    const data = await DriveService.resendResultEmail({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      driveId: req.params.driveId as string,
      studentId: req.params.studentId as string,
    });
    res.json(successResponse(data));
  }),
);

router.put(
  "/:driveId/eligibility-overrides/:studentId",
  asyncHandler(async (req, res) => {
    const body = driveEligibilityOverrideSchema.parse(req.body);
    const data = await DriveService.setEligibilityOverride({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      actorEmail: req.auth!.email,
      actorRole: req.auth!.role,
      driveId: req.params.driveId as string,
      studentId: req.params.studentId as string,
      ...body,
    });
    res.json(successResponse(data));
  }),
);

router.delete(
  "/:driveId/eligibility-overrides/:studentId",
  asyncHandler(async (req, res) => {
    const data = await DriveService.clearEligibilityOverride({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      actorEmail: req.auth!.email,
      actorRole: req.auth!.role,
      driveId: req.params.driveId as string,
      studentId: req.params.studentId as string,
    });
    res.json(successResponse(data));
  }),
);

export default router;
