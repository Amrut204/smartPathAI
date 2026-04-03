import { Router } from "express";

import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { communicationSendRateLimiter } from "../middleware/rate-limit.middleware.js";
import { AuditLogService } from "../services/audit-log.service.js";
import { CommunicationService } from "../services/communication.service.js";
import {
  announcementHistoryQuerySchema,
  announcementPreviewSchema,
  communicationHistoryQuerySchema,
  createAnnouncementSchema,
  createEmailTemplateSchema,
  previewCommunicationSchema,
  sendCommunicationSchema,
  unsubscribeQuerySchema,
} from "../validators/communication.schema.js";
import { successResponse } from "../utils/response-envelope.js";

const router = Router();

router.get(
  "/unsubscribe",
  asyncHandler(async (req, res) => {
    const query = unsubscribeQuerySchema.parse(req.query);
    const data = await CommunicationService.unsubscribeFromToken(String(query.token));
    res.json(successResponse({ message: `Unsubscribed ${data.email}`, ...data }));
  }),
);

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
  "/announcements/preview",
  asyncHandler(async (req, res) => {
    const body = announcementPreviewSchema.parse(req.body);
    const data = await CommunicationService.previewAnnouncement(
      req.auth!.tenantId,
      body,
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/announcements",
  asyncHandler(async (req, res) => {
    const body = createAnnouncementSchema.parse(req.body);
    const data = await CommunicationService.publishAnnouncement(
      req.auth!.tenantId,
      req.auth!.userId,
      body,
    );
    await AuditLogService.log({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      eventType: "announcement_published",
      metadata: {
        announcementId: data.announcementId,
        recipientCount: data.recipientCount,
        relatedDriveId: body.relatedDriveId ?? null,
        priority: body.priority,
      },
    });
    res.status(201).json(successResponse(data));
  }),
);

router.get(
  "/announcements",
  asyncHandler(async (req, res) => {
    const query = announcementHistoryQuerySchema.parse(req.query);
    const data = await CommunicationService.listAnnouncements(req.auth!.tenantId, query);
    res.json(successResponse(data));
  }),
);

router.post(
  "/preview",
  asyncHandler(async (req, res) => {
    const body = previewCommunicationSchema.parse(req.body);
    const data = await CommunicationService.previewRecipients(
      req.auth!.tenantId,
      body,
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/send",
  communicationSendRateLimiter,
  asyncHandler(async (req, res) => {
    const body = sendCommunicationSchema.parse(req.body);
    const data = await CommunicationService.sendBulk(
      req.auth!.tenantId,
      req.auth!.userId,
      body,
    );
    await AuditLogService.log({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      eventType: "communication_sent",
      metadata: {
        communicationId: data.communicationId,
        recipientCount: data.recipientCount,
        driveId: body.filters?.driveId ?? null,
        templateId: body.templateId ?? null,
        studentIds: body.filters?.studentIds ?? null,
      },
    });
    res.json(successResponse(data));
  }),
);

export default router;
