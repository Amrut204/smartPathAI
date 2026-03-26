import { Router } from "express";

import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { RiskAssessmentService } from "../services/risk-assessment.service.js";
import { successResponse } from "../utils/response-envelope.js";
import { riskAssessmentRefreshSchema, riskAssessmentQuerySchema, riskInterventionSchema } from "../validators/risk-assessment.schema.js";

const router = Router();

router.use(asyncHandler(requireAuth));
router.use(authorizeRole("tpo", "admin"));

router.get(
  "/risk-assessment",
  asyncHandler(async (req, res) => {
    const query = riskAssessmentQuerySchema.parse(req.query);
    let rows = await RiskAssessmentService.listRiskAssessment(req.auth!.tenantId, query.limit);
    if (rows.length === 0) {
      await RiskAssessmentService.refreshRiskScores(req.auth!.tenantId);
      rows = await RiskAssessmentService.listRiskAssessment(req.auth!.tenantId, query.limit);
    }
    const snapshot = await RiskAssessmentService.getRiskAssessmentSnapshot(req.auth!.tenantId, query.limit);
    res.json(successResponse(snapshot));
  }),
);

router.get(
  "/risk-assessment/:studentId",
  asyncHandler(async (req, res) => {
    const data = await RiskAssessmentService.getRiskAssessmentForStudent(
      req.auth!.tenantId,
      String(req.params.studentId),
    );
    res.json(successResponse(data));
  }),
);

router.post(
  "/risk-assessment/refresh",
  asyncHandler(async (req, res) => {
    riskAssessmentRefreshSchema.parse(req.body ?? {});
    const data = await RiskAssessmentService.refreshRiskScores(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.post(
  "/interventions",
  asyncHandler(async (req, res) => {
    const body = riskInterventionSchema.parse(req.body);
    const data = await RiskAssessmentService.logIntervention(req.auth!.tenantId, req.auth!.userId, {
      studentId: body.studentId,
      action: body.action,
      notes: body.notes,
    });
    res.status(201).json(successResponse(data));
  }),
);

export default router;
