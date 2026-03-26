import { Router } from "express";

import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { CareerService } from "../services/career.service.js";
import { successResponse } from "../utils/response-envelope.js";
import {
  analyzeInterviewAnswerSchema,
  billingPlanSchema,
  calendarEventSchema,
  campaignSchema,
  completeInterviewSessionSchema,
  mentorshipRequestSchema,
  recruiterPartnerSchema,
  saveCodingProfileSchema,
  startInterviewSessionSchema,
  walletItemSchema,
} from "../validators/career.schema.js";

const router = Router();

router.use(asyncHandler(requireAuth));

router.get(
  "/student-hub",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await CareerService.getStudentHub(req.auth!.tenantId, req.auth!.userId);
    res.json(successResponse(data));
  }),
);

router.post(
  "/interview-sessions",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const body = startInterviewSessionSchema.parse(req.body);
    const data = await CareerService.startInterviewSession(req.auth!.tenantId, req.auth!.userId, body);
    res.status(201).json(successResponse(data));
  }),
);

router.post(
  "/interview-sessions/:sessionId/analyze-answer",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const body = analyzeInterviewAnswerSchema.parse(req.body);
    const data = await CareerService.analyzeInterviewAnswer(
      req.auth!.tenantId,
      req.auth!.userId,
      String(req.params.sessionId),
      body,
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/interview-sessions/:sessionId/complete",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const body = completeInterviewSessionSchema.parse(req.body);
    const data = await CareerService.completeInterviewSession(
      req.auth!.tenantId,
      req.auth!.userId,
      String(req.params.sessionId),
      body.answers,
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/action-plans/generate",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await CareerService.generateActionPlan(req.auth!.tenantId, req.auth!.userId);
    res.json(successResponse(data));
  }),
);

router.post(
  "/coding-profiles",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const body = saveCodingProfileSchema.parse(req.body);
    const data = await CareerService.saveCodingProfile(req.auth!.tenantId, req.auth!.userId, body);
    res.status(201).json(successResponse(data));
  }),
);

router.get(
  "/mentorship",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await CareerService.getMentorship(req.auth!.tenantId, req.auth!.userId);
    res.json(successResponse(data));
  }),
);

router.post(
  "/mentorship/request",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const body = mentorshipRequestSchema.parse(req.body);
    const data = await CareerService.requestMentorship(req.auth!.tenantId, req.auth!.userId, body);
    res.status(201).json(successResponse(data));
  }),
);

router.get(
  "/wallet",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await CareerService.getWallet(req.auth!.tenantId, req.auth!.userId);
    res.json(successResponse(data));
  }),
);

router.post(
  "/wallet",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const body = walletItemSchema.parse(req.body);
    const data = await CareerService.addWalletItem(req.auth!.tenantId, req.auth!.userId, body);
    res.status(201).json(successResponse(data));
  }),
);

router.get(
  "/ops-hub",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const data = await CareerService.getOpsHub(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.post(
  "/recruiters",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const body = recruiterPartnerSchema.parse(req.body);
    const data = await CareerService.addRecruiterPartner(req.auth!.tenantId, body);
    res.status(201).json(successResponse(data));
  }),
);

router.post(
  "/campaigns",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const body = campaignSchema.parse(req.body);
    const data = await CareerService.addCampaign(req.auth!.tenantId, body);
    res.status(201).json(successResponse(data));
  }),
);

router.post(
  "/calendar-events",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const body = calendarEventSchema.parse(req.body);
    const data = await CareerService.addCalendarEvent(req.auth!.tenantId, body);
    res.status(201).json(successResponse(data));
  }),
);

router.post(
  "/revenue/plan",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const body = billingPlanSchema.parse(req.body);
    const data = await CareerService.updateBillingPlan(req.auth!.tenantId, body);
    res.json(successResponse(data));
  }),
);

export default router;
