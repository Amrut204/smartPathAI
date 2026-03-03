import { Router } from "express";

import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { DriveService } from "../services/drive.service.js";
import {
  driveListQuerySchema,
  createDriveSchema,
  updateDriveSchema,
  updateDriveResultsSchema,
} from "../validators/drive.schema.js";
import { successResponse } from "../utils/response-envelope.js";

const router = Router();

router.use(asyncHandler(requireAuth));
router.use(authorizeRole("tpo", "admin"));

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = driveListQuerySchema.parse(req.query);
    const data = await DriveService.listDrives(req.auth!.tenantId, query);
    res.json(successResponse(data));
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createDriveSchema.parse(req.body);
    const data = await DriveService.createDrive(
      req.auth!.tenantId,
      req.auth!.userId,
      body,
    );
    res.status(201).json(successResponse(data));
  }),
);

router.get(
  "/:driveId",
  asyncHandler(async (req, res) => {
    const data = await DriveService.getDriveById(
      req.auth!.tenantId,
      req.params.driveId as string,
    );
    res.json(successResponse(data));
  }),
);

router.patch(
  "/:driveId",
  asyncHandler(async (req, res) => {
    const body = updateDriveSchema.parse(req.body);
    const data = await DriveService.updateDrive(
      req.auth!.tenantId,
      req.params.driveId as string,
      body,
    );
    res.json(successResponse(data));
  }),
);

router.delete(
  "/:driveId",
  asyncHandler(async (req, res) => {
    await DriveService.deleteDrive(req.auth!.tenantId, req.params.driveId as string);
    res.json(successResponse({ message: "Drive deleted" }));
  }),
);

router.post(
  "/:driveId/eligibility",
  asyncHandler(async (req, res) => {
    const data = await DriveService.computeEligibility(
      req.auth!.tenantId,
      req.params.driveId as string,
    );
    res.json(successResponse(data));
  }),
);

router.get(
  "/:driveId/results",
  asyncHandler(async (req, res) => {
    const data = await DriveService.listDriveResults(
      req.auth!.tenantId,
      req.params.driveId as string,
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/:driveId/results",
  asyncHandler(async (req, res) => {
    const body = updateDriveResultsSchema.parse(req.body);
    const data = await DriveService.updateDriveResults(
      req.auth!.tenantId,
      req.params.driveId as string,
      body,
    );
    res.json(successResponse(data));
  }),
);

export default router;
