import { Router } from "express";

import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";
import { successResponse } from "../utils/response-envelope.js";

const router = Router();

router.use(asyncHandler(requireAuth));

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const tenant = await MongoAuthRepository.findTenantById(req.auth!.tenantId);
    if (!tenant) {
      res.status(404).json({ success: false, error: { code: "TENANT_NOT_FOUND", message: "Tenant not found" } });
      return;
    }

    res.json(
      successResponse({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        config: tenant.config ?? {},
      }),
    );
  }),
);

export default router;
