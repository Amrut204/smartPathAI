import { Router } from "express";

import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { successResponse } from "../utils/response-envelope.js";
import { clampListLimit, clampWindowDays } from "../utils/pagination.js";

const router = Router();

router.use(asyncHandler(requireAuth));
router.use(authorizeRole("tpo", "admin"));

router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const data = await AnalyticsService.getDashboard(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/readiness",
  asyncHandler(async (req, res) => {
    const data = await AnalyticsService.getReadiness(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/topics",
  asyncHandler(async (req, res) => {
    const data = await AnalyticsService.getTopics(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/tests",
  asyncHandler(async (req, res) => {
    const data = await AnalyticsService.getTests(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/placement",
  asyncHandler(async (req, res) => {
    const data = await AnalyticsService.getPlacement(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/study-trends",
  asyncHandler(async (req, res) => {
    const data = await AnalyticsService.getStudyTrends(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/student-rankings",
  asyncHandler(async (req, res) => {
    const limit = clampListLimit(req.query.limit, { defaultLimit: 50, maxLimit: 200 });
    const windowDays = clampWindowDays(req.query.windowDays, { defaultDays: 30, maxDays: 365 });
    const data = await AnalyticsService.getStudentRankings(req.auth!.tenantId, limit, windowDays);
    res.json(successResponse(data));
  }),
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const data = await AnalyticsService.refresh(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/export",
  asyncHandler(async (req, res) => {
    const type = req.query.type as string;
    const format = (req.query.format as string) || "csv";

    if (!["readiness", "topics", "tests", "placement"].includes(type)) {
      res.status(400).json({ success: false, error: { code: "INVALID_EXPORT_TYPE", message: "Invalid export type" } });
      return;
    }

    const snapshot = await AnalyticsService.getSnapshot(req.auth!.tenantId);

    if (format === "csv") {
      let csv = "";
      if (type === "readiness") {
        csv = "batch,avgReadiness,studentCount\n";
        csv += snapshot.readiness.batchAverages
          .map((row) => `${row.batch},${row.avgReadiness},${row.studentCount}`)
          .join("\n");
      } else if (type === "topics") {
        csv = "topicId,topicName,avgMastery,studentsCovered\n";
        csv += snapshot.topics.summary
          .map((row) => `${row.topicId},${row.topicName},${row.avgMastery},${row.studentsCovered}`)
          .join("\n");
      } else if (type === "tests") {
        csv = "testId,title,difficulty,completedStudents,completionRate,averageScore\n";
        csv += snapshot.tests.tests
          .map((row) => `${row.testId},${row.title},${row.difficulty},${row.completedStudents},${row.completionRate},${row.averageScore}`)
          .join("\n");
      } else if (type === "placement") {
        csv = "stage,count\n";
        csv += snapshot.placement.funnel
          .map((row) => `${row.stage},${row.count}`)
          .join("\n");
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="analytics-${type}.csv"`);
      res.send(csv);
      return;
    }

    res.json(successResponse((snapshot as unknown as Record<string, unknown>)[type]));
  }),
);

export default router;
