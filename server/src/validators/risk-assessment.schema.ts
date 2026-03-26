import { z } from "zod";

import { RISK_INTERVENTION_ACTIONS } from "../models/RiskAssessment.js";

export const riskAssessmentRefreshSchema = z.object({
  dryRun: z.boolean().optional(),
});

export const riskAssessmentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  category: z.enum(["HIGH_RISK", "MEDIUM_RISK", "LOW_RISK"]).optional(),
});

export const riskInterventionSchema = z.object({
  studentId: z.string().trim().min(1),
  action: z.enum(RISK_INTERVENTION_ACTIONS),
  notes: z.string().trim().max(2000).optional(),
});
