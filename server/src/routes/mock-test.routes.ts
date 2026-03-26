import { Router } from "express";

import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { requireCompletedStudentProfile } from "../middleware/student-profile.middleware.js";
import { MockTestService } from "../services/mock-test.service.js";
import {
  listMockTestsQuerySchema,
  curatedMockTestsQuerySchema,
  submitMockTestSchema,
  createMockTestSchema,
  updateMockTestSchema,
  publishMockTestSchema,
  upsertMockQuestionsSchema,
} from "../validators/mock-test.schema.js";
import { successResponse } from "../utils/response-envelope.js";

const router = Router();

router.use(asyncHandler(requireAuth));

router.get(
  "/",
  asyncHandler(requireCompletedStudentProfile),
  asyncHandler(async (req, res) => {
    const query = listMockTestsQuerySchema.parse(req.query);
    const data = await MockTestService.listTests({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      role: req.auth!.role,
      ...query,
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/curated",
  authorizeRole("student"),
  asyncHandler(requireCompletedStudentProfile),
  asyncHandler(async (req, res) => {
    const query = curatedMockTestsQuerySchema.parse(req.query);
    const data = await MockTestService.getCuratedTests({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      role: req.auth!.role,
      ...query,
    });
    res.json(successResponse(data));
  }),
);

router.post(
  "/",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const body = createMockTestSchema.parse(req.body);
    const data = await MockTestService.createTest(
      req.auth!.tenantId,
      req.auth!.userId,
      body,
    );
    res.status(201).json(successResponse(data));
  }),
);

router.get(
  "/attempts/:attemptId",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await MockTestService.getAttemptResult(
      req.auth!.tenantId,
      req.auth!.userId,
      req.params.attemptId as string,
    );
    res.json(successResponse(data));
  }),
);

router.get(
  "/:testId",
  asyncHandler(requireCompletedStudentProfile),
  asyncHandler(async (req, res) => {
    const data = await MockTestService.getTestMetadata(
      req.auth!.tenantId,
      req.params.testId as string,
      req.auth!.role,
    );
    res.json(successResponse(data));
  }),
);

router.put(
  "/:testId",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const body = updateMockTestSchema.parse(req.body);
    const data = await MockTestService.updateTest(
      req.auth!.tenantId,
      req.params.testId as string,
      body,
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/:testId/publish",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const body = publishMockTestSchema.parse(req.body);
    const data = await MockTestService.publishTest(
      req.auth!.tenantId,
      req.params.testId as string,
      body.isActive,
    );
    res.json(successResponse(data));
  }),
);

router.get(
  "/:testId/questions",
  asyncHandler(requireCompletedStudentProfile),
  asyncHandler(async (req, res) => {
    const data = await MockTestService.getQuestions(
      req.auth!.tenantId,
      req.params.testId as string,
      req.auth!.role,
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/:testId/questions",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const body = upsertMockQuestionsSchema.parse(req.body);
    const data = await MockTestService.upsertQuestions(
      req.auth!.tenantId,
      req.params.testId as string,
      body,
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/:testId/start",
  authorizeRole("student"),
  asyncHandler(requireCompletedStudentProfile),
  asyncHandler(async (req, res) => {
    const data = await MockTestService.startAttempt(
      req.auth!.tenantId,
      req.auth!.userId,
      req.params.testId as string,
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/:testId/submit",
  authorizeRole("student"),
  asyncHandler(requireCompletedStudentProfile),
  asyncHandler(async (req, res) => {
    const body = submitMockTestSchema.parse(req.body);
    const data = await MockTestService.submitAttempt({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      attemptId: body.attemptId,
      answers: body.answers,
      idempotencyKey: body.idempotencyKey,
      integrity: body.integrity,
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/:testId/results",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const attemptId = req.query.attemptId as string;
    if (!attemptId) {
      res.status(400).json({ success: false, error: { code: "MISSING_ATTEMPT_ID", message: "attemptId query param required" } });
      return;
    }
    const data = await MockTestService.getAttemptResult(
      req.auth!.tenantId,
      req.auth!.userId,
      attemptId,
    );
    res.json(successResponse(data));
  }),
);

export default router;
