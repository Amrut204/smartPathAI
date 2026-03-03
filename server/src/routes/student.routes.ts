import { Router } from "express";

import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { StudentService } from "../services/student.service.js";
import {
  studyHoursSchema,
  updateTopicProgressSchema,
  bulkTopicProgressSchema,
  updateStudentProfileSchema,
  leaderboardQuerySchema,
  pointsHistoryQuerySchema,
  tpoStudentListQuerySchema,
  tpoStudentUpdateSchema,
  csvUploadPreviewSchema,
  csvUploadConfirmSchema,
} from "../validators/student.schema.js";
import { successResponse } from "../utils/response-envelope.js";

const router = Router();

// All student routes require authentication
router.use(asyncHandler(requireAuth));

// --- Student self-service routes ---

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

router.get(
  "/me/dashboard",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await StudentService.getDashboard(req.auth!.tenantId, req.auth!.userId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/me/mastery",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await StudentService.getMastery(req.auth!.tenantId, req.auth!.userId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/me/topic-progress",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await StudentService.getTopicProgress(req.auth!.tenantId, req.auth!.userId);
    res.json(successResponse(data));
  }),
);

router.patch(
  "/me/topic-progress",
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
    const limit = Number(req.query.limit) || 30;
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
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await StudentService.getVaultCompanies(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/vault/companies/:companyId",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const type = req.query.type as string | undefined;
    const data = await StudentService.getVaultByCompany(
      req.auth!.tenantId,
      req.params.companyId as string,
      type,
    );
    res.json(successResponse(data));
  }),
);

router.get(
  "/resources",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const topicId = req.query.topicId as string | undefined;
    const data = await StudentService.getResources(req.auth!.tenantId, topicId);
    res.json(successResponse(data));
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
  asyncHandler(async (req, res) => {
    const body = csvUploadPreviewSchema.parse(req.body);
    const preview = StudentService.parseCsvPreview(body.csv);
    res.json(successResponse(preview));
  }),
);

router.post(
  "/upload/confirm",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const body = csvUploadConfirmSchema.parse(req.body);
    const result = await StudentService.confirmCsvUpload(req.auth!.tenantId, body);
    res.json(successResponse(result));
  }),
);

export default router;
