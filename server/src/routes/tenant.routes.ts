import { Router } from "express";

import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";
import { successResponse } from "../utils/response-envelope.js";
import { updateTenantEmailSettingsSchema, updateTenantPlacementPolicySchema } from "../validators/tenant.schema.js";

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

router.patch(
  "/me/email-settings",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const body = updateTenantEmailSettingsSchema.parse(req.body);
    const tenant = await MongoAuthRepository.updateTenantEmailSettings(req.auth!.tenantId, {
      fromName: body.fromName === "" ? "" : body.fromName,
      fromEmail: body.fromEmail === "" ? "" : body.fromEmail,
      replyToEmail: body.replyToEmail === "" ? "" : body.replyToEmail,
    });

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

router.patch(
  "/me/placement-policy",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const body = updateTenantPlacementPolicySchema.parse(req.body);
    const tenantRecord = await MongoAuthRepository.findTenantById(req.auth!.tenantId);
    if (!tenantRecord) {
      res.status(404).json({ success: false, error: { code: "TENANT_NOT_FOUND", message: "Tenant not found" } });
      return;
    }

    const currentConfig = tenantRecord.config && typeof tenantRecord.config === "object"
      ? tenantRecord.config as Record<string, unknown>
      : {};
    const currentPlacementPolicy = currentConfig.placementPolicy && typeof currentConfig.placementPolicy === "object"
      ? currentConfig.placementPolicy as Record<string, unknown>
      : {};

    const tenant = await MongoAuthRepository.updateTenantConfig(req.auth!.tenantId, {
      config: {
        ...currentConfig,
        placementPolicy: {
          ...currentPlacementPolicy,
          excludePlacedStudentsByDefault: body.excludePlacedStudentsByDefault,
        },
      },
    });

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
