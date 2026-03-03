import { Router } from "express";

import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { CommunicationService } from "../services/communication.service.js";
import {
  communicationHistoryQuerySchema,
  createEmailTemplateSchema,
  sendCommunicationSchema,
} from "../validators/communication.schema.js";
import { successResponse } from "../utils/response-envelope.js";

const router = Router();

router.use(asyncHandler(requireAuth));
router.use(authorizeRole("tpo", "admin"));

router.get(
  "/templates",
  asyncHandler(async (req, res) => {
    const data = await CommunicationService.listTemplates(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.post(
  "/templates",
  asyncHandler(async (req, res) => {
    const body = createEmailTemplateSchema.parse(req.body);
    const data = await CommunicationService.createTemplate(
      req.auth!.tenantId,
      req.auth!.userId,
      body,
    );
    res.status(201).json(successResponse(data));
  }),
);

router.get(
  "/history",
  asyncHandler(async (req, res) => {
    const query = communicationHistoryQuerySchema.parse(req.query);
    const data = await CommunicationService.getHistory(req.auth!.tenantId, query);
    res.json(successResponse(data));
  }),
);

router.get(
  "/:communicationId/status",
  asyncHandler(async (req, res) => {
    const data = await CommunicationService.getStatus(
      req.auth!.tenantId,
      String(req.params.communicationId),
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/send",
  asyncHandler(async (req, res) => {
    const body = sendCommunicationSchema.parse(req.body);
    const data = await CommunicationService.sendBulk(
      req.auth!.tenantId,
      req.auth!.userId,
      body,
    );
    res.json(successResponse(data));
  }),
);

export default router;
