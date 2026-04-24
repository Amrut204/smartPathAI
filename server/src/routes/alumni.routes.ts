import { Router } from "express";

import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { AlumniService } from "../services/alumni.service.js";
import { successResponse } from "../utils/response-envelope.js";
import {
  alumniContactQuerySchema,
  alumniOpportunityQuerySchema,
  createAlumniContactSchema,
  createAlumniOpportunitySchema,
  updateAlumniContactSchema,
  updateAlumniOpportunitySchema,
} from "../validators/alumni.schema.js";

const router = Router();

router.use(asyncHandler(requireAuth));
router.use(authorizeRole("tpo", "admin"));

router.get(
  "/contacts",
  asyncHandler(async (req, res) => {
    const query = alumniContactQuerySchema.parse(req.query);
    const data = await AlumniService.listContacts({
      tenantId: req.auth!.tenantId,
      q: query.q,
      branch: query.branch,
      verificationStatus: query.verificationStatus,
      canRefer: query.canRefer,
      isHiring: query.isHiring,
    });
    res.json(successResponse(data));
  }),
);

router.post(
  "/contacts",
  asyncHandler(async (req, res) => {
    const body = createAlumniContactSchema.parse(req.body ?? {});
    const data = await AlumniService.createContact({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      fullName: body.fullName,
      branch: body.branch,
      graduationYear: body.graduationYear,
      company: body.company,
      role: body.role,
      location: body.location,
      linkedinUrl: body.linkedinUrl,
      email: body.email,
      phone: body.phone,
      canRefer: body.canRefer,
      canMentor: body.canMentor,
      isHiring: body.isHiring,
      notes: body.notes,
      verificationStatus: body.verificationStatus,
    });
    res.status(201).json(successResponse(data));
  }),
);

router.patch(
  "/contacts/:contactId",
  asyncHandler(async (req, res) => {
    const body = updateAlumniContactSchema.parse(req.body ?? {});
    const data = await AlumniService.updateContact({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      contactId: String(req.params.contactId),
      ...body,
    });
    res.json(successResponse(data));
  }),
);

router.get(
  "/opportunities",
  asyncHandler(async (req, res) => {
    const query = alumniOpportunityQuerySchema.parse(req.query);
    const data = await AlumniService.listOpportunities({
      tenantId: req.auth!.tenantId,
      q: query.q,
      type: query.type,
      status: query.status,
    });
    res.json(successResponse(data));
  }),
);

router.post(
  "/opportunities",
  asyncHandler(async (req, res) => {
    const body = createAlumniOpportunitySchema.parse(req.body ?? {});
    const data = await AlumniService.createOpportunity({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      type: body.type,
      title: body.title,
      description: body.description,
      alumniContactId: body.alumniContactId,
      branches: body.branches,
      batches: body.batches,
      academicYears: body.academicYears,
      driveId: body.driveId ? String(body.driveId) : null,
      status: body.status,
      studentIds: body.studentIds,
      notes: body.notes,
    });
    res.status(201).json(successResponse(data));
  }),
);

router.patch(
  "/opportunities/:opportunityId",
  asyncHandler(async (req, res) => {
    const body = updateAlumniOpportunitySchema.parse(req.body ?? {});
    const data = await AlumniService.updateOpportunity({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      opportunityId: String(req.params.opportunityId),
      type: body.type,
      title: body.title,
      description: body.description,
      alumniContactId: body.alumniContactId,
      branches: body.branches,
      batches: body.batches,
      academicYears: body.academicYears,
      driveId: body.driveId ? String(body.driveId) : body.driveId === "" ? null : undefined,
      status: body.status,
      studentIds: body.studentIds,
      notes: body.notes,
    });
    res.json(successResponse(data));
  }),
);

export default router;
