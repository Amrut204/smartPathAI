import { Router } from "express";

import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { requireFeature } from "../middleware/feature-flag.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { TpoControlCenterService } from "../services/tpo-control-center.service.js";
import { successResponse } from "../utils/response-envelope.js";

const router = Router();

function readPositiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function readOptionalString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

router.use(asyncHandler(requireAuth));
router.use(authorizeRole("tpo", "admin"));

router.get(
  "/dashboard/mvp",
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getPilotDashboard(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/dashboard/control-center",
  requireFeature("tpoAdvancedInsights"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getControlCenter(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/dashboard/summary",
  requireFeature("tpoAdvancedInsights"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getDashboardSummary(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/dashboard/trends",
  requireFeature("tpoAdvancedInsights"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getDashboardTrends(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/dashboard/alerts",
  requireFeature("tpoAdvancedInsights"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getDashboardAlerts(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/dashboard/activity-feed",
  requireFeature("tpoAdvancedInsights"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getActivityFeed(req.auth!.tenantId, undefined, {
      page: readPositiveInt(req.query.page, 1),
      limit: readPositiveInt(req.query.limit, 20),
      search: readOptionalString(req.query.search),
      eventType: readOptionalString(req.query.eventType),
      branch: readOptionalString(req.query.branch),
      batch: readOptionalString(req.query.batch),
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/students/operations-board",
  requireFeature("opsHub"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getOperationsBoard(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/activity-events",
  requireFeature("tpoAdvancedInsights"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getActivityFeed(req.auth!.tenantId, undefined, {
      page: readPositiveInt(req.query.page, 1),
      limit: readPositiveInt(req.query.limit, 20),
      search: readOptionalString(req.query.search),
      eventType: readOptionalString(req.query.eventType),
      branch: readOptionalString(req.query.branch),
      batch: readOptionalString(req.query.batch),
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/students/:studentId/activity-events",
  requireFeature("tpoAdvancedInsights"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getActivityFeed(req.auth!.tenantId, String(req.params.studentId), {
      page: readPositiveInt(req.query.page, 1),
      limit: readPositiveInt(req.query.limit, 20),
      search: readOptionalString(req.query.search),
      eventType: readOptionalString(req.query.eventType),
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/risk-summary",
  requireFeature("tpoAdvancedInsights"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getRiskSummary(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/risk-students",
  requireFeature("tpoAdvancedInsights"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getRiskStudents(req.auth!.tenantId, {
      page: readPositiveInt(req.query.page, 1),
      limit: readPositiveInt(req.query.limit, 20),
      search: readOptionalString(req.query.search),
      severity: readOptionalString(req.query.severity),
      branch: readOptionalString(req.query.branch),
      batch: readOptionalString(req.query.batch),
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/drives/preparedness",
  requireFeature("tpoAdvancedInsights"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getDrivePreparedness(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/drives/:driveId/preparedness",
  requireFeature("tpoAdvancedInsights"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getDrivePreparedness(req.auth!.tenantId, String(req.params.driveId));
    res.json(successResponse(data));
  }),
);

router.get(
  "/profile-completeness",
  requireFeature("tpoAdvancedInsights"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getProfileCompleteness(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/mock-insights",
  requireFeature("tpoAdvancedInsights"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getMockInsights(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/mock-insights/students",
  requireFeature("tpoAdvancedInsights"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getMockInsights(req.auth!.tenantId);
    res.json(successResponse(data.students));
  }),
);

router.get(
  "/interview-readiness",
  requireFeature("tpoAdvancedInsights"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getInterviewReadiness(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/students/:studentId/interview-readiness",
  requireFeature("tpoAdvancedInsights"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getInterviewReadiness(req.auth!.tenantId, String(req.params.studentId));
    res.json(successResponse(data));
  }),
);

router.get(
  "/coding-readiness",
  requireFeature("tpoAdvancedInsights"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getCodingReadiness(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/action-center",
  requireFeature("opsHub"),
  asyncHandler(async (req, res) => {
    const data = await TpoControlCenterService.getActionCenter(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

export default router;
