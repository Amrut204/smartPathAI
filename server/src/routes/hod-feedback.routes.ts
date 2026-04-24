import { Router } from "express";

import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { HodFeedbackService } from "../services/hod-feedback.service.js";
import {
  createFeedbackCampaignSchema,
  listFeedbackCampaignsQuerySchema,
  submitFeedbackResponseSchema,
} from "../validators/hod-feedback.schema.js";
import { successResponse } from "../utils/response-envelope.js";

export const hodFeedbackRoutes = Router();
export const studentFeedbackRoutes = Router();

hodFeedbackRoutes.use(asyncHandler(requireAuth));
hodFeedbackRoutes.use(authorizeRole("hod"));

hodFeedbackRoutes.post(
  "/campaigns",
  asyncHandler(async (req, res) => {
    const body = createFeedbackCampaignSchema.parse(req.body);
    const data = await HodFeedbackService.createCampaign({
      tenantId: req.auth!.tenantId,
      hodUserId: req.auth!.userId,
      type: body.type,
      title: body.title,
      description: body.description,
      targetBatches: body.targetBatches,
      targetAcademicYears: body.targetAcademicYears,
      facultyTargets: body.facultyTargets,
      driveId: body.driveId,
      openAt: body.openAt,
      closeAt: body.closeAt,
      customTemplate: body.customTemplate,
    });
    res.status(201).json(successResponse(data));
  }),
);

hodFeedbackRoutes.get(
  "/campaigns",
  asyncHandler(async (req, res) => {
    const query = listFeedbackCampaignsQuerySchema.parse(req.query);
    const data = await HodFeedbackService.listCampaigns({
      tenantId: req.auth!.tenantId,
      hodUserId: req.auth!.userId,
      status: query.status,
      type: query.type,
      limit: query.limit,
    });
    res.json(successResponse(data));
  }),
);

hodFeedbackRoutes.get(
  "/campaigns/:campaignId/export.xlsx",
  asyncHandler(async (req, res) => {
    const data = await HodFeedbackService.exportCampaignWorkbook({
      tenantId: req.auth!.tenantId,
      hodUserId: req.auth!.userId,
      campaignId: String(req.params.campaignId),
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=\"${data.filename}\"`);
    res.send(data.buffer);
  }),
);

hodFeedbackRoutes.get(
  "/campaigns/:campaignId",
  asyncHandler(async (req, res) => {
    const data = await HodFeedbackService.getCampaignDetail({
      tenantId: req.auth!.tenantId,
      hodUserId: req.auth!.userId,
      campaignId: String(req.params.campaignId),
    });
    res.json(successResponse(data));
  }),
);

hodFeedbackRoutes.get(
  "/campaigns/:campaignId/responses",
  asyncHandler(async (req, res) => {
    const data = await HodFeedbackService.listCampaignResponses({
      tenantId: req.auth!.tenantId,
      hodUserId: req.auth!.userId,
      campaignId: String(req.params.campaignId),
    });
    res.json(successResponse(data));
  }),
);

hodFeedbackRoutes.get(
  "/campaigns/:campaignId/analytics",
  asyncHandler(async (req, res) => {
    const data = await HodFeedbackService.getCampaignDetail({
      tenantId: req.auth!.tenantId,
      hodUserId: req.auth!.userId,
      campaignId: String(req.params.campaignId),
    });
    res.json(successResponse(data.analytics));
  }),
);

hodFeedbackRoutes.post(
  "/campaigns/:campaignId/publish",
  asyncHandler(async (req, res) => {
    const data = await HodFeedbackService.publishCampaign({
      tenantId: req.auth!.tenantId,
      hodUserId: req.auth!.userId,
      campaignId: String(req.params.campaignId),
    });
    res.json(successResponse(data));
  }),
);

studentFeedbackRoutes.use(asyncHandler(requireAuth));
studentFeedbackRoutes.use(authorizeRole("student"));

studentFeedbackRoutes.get(
  "/me",
  asyncHandler(async (req, res) => {
    const data = await HodFeedbackService.listStudentCampaigns({
      tenantId: req.auth!.tenantId,
      studentUserId: req.auth!.userId,
    });
    res.json(successResponse(data));
  }),
);

studentFeedbackRoutes.get(
  "/me/:campaignId",
  asyncHandler(async (req, res) => {
    const data = await HodFeedbackService.getStudentCampaign({
      tenantId: req.auth!.tenantId,
      studentUserId: req.auth!.userId,
      campaignId: String(req.params.campaignId),
    });
    res.json(successResponse(data));
  }),
);

studentFeedbackRoutes.post(
  "/me/:campaignId/submit",
  asyncHandler(async (req, res) => {
    const body = submitFeedbackResponseSchema.parse(req.body);
    const data = await HodFeedbackService.submitStudentResponse({
      tenantId: req.auth!.tenantId,
      studentUserId: req.auth!.userId,
      campaignId: String(req.params.campaignId),
      responses: body.responses,
    });
    res.status(201).json(successResponse(data));
  }),
);
