import { Router } from "express";

import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { successResponse } from "../utils/response-envelope.js";
import { NotificationService } from "../services/notification.service.js";

const router = Router();

router.use(asyncHandler(requireAuth));

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const data = await NotificationService.listForUser({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      role: req.auth!.role as "student" | "tpo" | "hod" | "admin",
      view: typeof req.query.view === "string" ? req.query.view : undefined,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
    });
    res.json(successResponse(data));
  }),
);

router.post(
  "/:notificationId/read",
  asyncHandler(async (req, res) => {
    const data = await NotificationService.markRead({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      role: req.auth!.role as "student" | "tpo" | "hod" | "admin",
      notificationId: String(req.params.notificationId),
    });
    res.json(successResponse(data));
  }),
);

router.post(
  "/mark-all-read",
  asyncHandler(async (req, res) => {
    const data = await NotificationService.markAllRead({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      role: req.auth!.role as "student" | "tpo" | "hod" | "admin",
    });
    res.json(successResponse(data));
  }),
);

export default router;
