import { z } from "zod";

import { DEMO_FEEDBACK_STATUSES } from "../models/DemoFeedback.js";

const optionalString = z.string().trim().max(500).optional().nullable();
const optionalDateString = z.string().datetime().optional().nullable();
const stringArrayField = z.array(z.string().trim().min(1).max(200)).max(50).default([]);
const tenPointScaleField = z.coerce.number().int().min(1).max(10).optional().nullable();

export const createDemoFeedbackSchema = z.object({
  collegeName: z.string().trim().min(2).max(200),
  tpoName: z.string().trim().min(2).max(200),
  contactEmail: z.string().trim().email().max(320).optional().nullable(),
  contactPhone: z.string().trim().max(40).optional().nullable(),
  demoDate: optionalDateString,
  demoRating: tenPointScaleField,
  productFit: tenPointScaleField,
  conversionLikelihood: tenPointScaleField,
  painPoints: stringArrayField,
  featureRequests: stringArrayField,
  concerns: stringArrayField,
  competitorMentions: stringArrayField,
  nextSteps: optionalString,
  followUpDate: optionalDateString,
  status: z.enum(DEMO_FEEDBACK_STATUSES).default("demo_completed"),
  notes: z.string().trim().max(10_000).optional().nullable(),
});

export const updateDemoFeedbackSchema = createDemoFeedbackSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });

export const listDemoFeedbackQuerySchema = z.object({
  status: z.enum(DEMO_FEEDBACK_STATUSES).optional(),
  search: z.string().trim().max(200).optional(),
  demoDateFrom: optionalDateString,
  demoDateTo: optionalDateString,
  followUpDateFrom: optionalDateString,
  followUpDateTo: optionalDateString,
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
