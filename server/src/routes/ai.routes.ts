import { Router } from "express";

import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { AIService } from "../services/ai.service.js";
import { aiChatSchema } from "../validators/ai.schema.js";
import { successResponse } from "../utils/response-envelope.js";

const router = Router();

router.use(asyncHandler(requireAuth));

router.post(
  "/chat",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const body = aiChatSchema.parse(req.body);
    const data = await AIService.chat({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      message: body.message,
      conversationId: body.conversationId,
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/conversations",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await AIService.listConversations(
      req.auth!.tenantId,
      req.auth!.userId,
    );
    res.json(successResponse(data));
  }),
);

router.get(
  "/conversations/:conversationId",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const data = await AIService.getConversation(
      req.auth!.tenantId,
      req.auth!.userId,
      String(req.params.conversationId),
    );
    res.json(successResponse(data));
  }),
);

router.get(
  "/usage",
  asyncHandler(async (req, res) => {
    const data = await AIService.getUsage(
      req.auth!.tenantId,
      req.auth!.userId,
      req.auth!.role,
    );
    res.json(successResponse(data));
  }),
);

export default router;
