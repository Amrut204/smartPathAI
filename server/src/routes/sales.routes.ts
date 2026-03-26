import { Router } from "express";

import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { SalesPipelineService } from "../services/sales-pipeline.service.js";
import { successResponse } from "../utils/response-envelope.js";
import {
  createSalesPipelineSchema,
  listSalesPipelineQuerySchema,
  updateSalesPipelineSchema,
} from "../validators/sales-pipeline.schema.js";

const router = Router();

router.use(asyncHandler(requireAuth));
router.use(authorizeRole("admin"));

router.post(
  "/pipeline",
  asyncHandler(async (req, res) => {
    const body = createSalesPipelineSchema.parse(req.body);
    const data = await SalesPipelineService.create(req.auth!.tenantId, req.auth!.userId, body);
    res.status(201).json(successResponse(data));
  }),
);

router.get(
  "/pipeline",
  asyncHandler(async (req, res) => {
    const query = listSalesPipelineQuerySchema.parse(req.query);
    const data = await SalesPipelineService.list(req.auth!.tenantId, query);
    res.json(successResponse(data));
  }),
);

router.get(
  "/pipeline/analytics",
  asyncHandler(async (req, res) => {
    const data = await SalesPipelineService.getAnalytics(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/pipeline/:id",
  asyncHandler(async (req, res) => {
    const data = await SalesPipelineService.getById(req.auth!.tenantId, String(req.params.id));
    res.json(successResponse(data));
  }),
);

router.patch(
  "/pipeline/:id",
  asyncHandler(async (req, res) => {
    const body = updateSalesPipelineSchema.parse(req.body);
    const data = await SalesPipelineService.update(req.auth!.tenantId, String(req.params.id), body);
    res.json(successResponse(data));
  }),
);

export default router;
