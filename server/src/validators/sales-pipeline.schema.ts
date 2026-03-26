import { z } from "zod";

import {
  SALES_PIPELINE_PRIORITIES,
  SALES_PIPELINE_STAGES,
} from "../models/SalesPipeline.js";

const optionalString = z.string().trim().max(500).optional().nullable();
const optionalDateString = z.string().datetime().optional().nullable();
const notesField = z.array(z.string().trim().min(1).max(500)).max(200).default([]);

export const createSalesPipelineSchema = z.object({
  collegeName: z.string().trim().min(2).max(200),
  collegeLocation: optionalString,
  studentCount: z.coerce.number().int().min(0).max(100_000).optional().nullable(),
  tpoName: z.string().trim().min(2).max(200),
  tpoEmail: z.string().trim().email().max(320).optional().nullable(),
  tpoPhone: z.string().trim().max(40).optional().nullable(),
  tpoLinkedIn: z.string().trim().url().max(500).optional().nullable(),
  stage: z.enum(SALES_PIPELINE_STAGES).default("contacted"),
  priority: z.enum(SALES_PIPELINE_PRIORITIES).default("B"),
  contactDate: optionalDateString,
  demoDate: optionalDateString,
  pilotStartDate: optionalDateString,
  conversionDate: optionalDateString,
  expectedRevenue: z.coerce.number().min(0).max(10_000_000).optional().nullable(),
  lostReason: optionalString,
  nextAction: optionalString,
  nextActionDate: optionalDateString,
  notes: notesField,
  linkedDemoFeedback: z.string().trim().max(100).optional().nullable(),
});

export const updateSalesPipelineSchema = createSalesPipelineSchema.extend({
  addNote: z.string().trim().min(1).max(500).optional(),
}).partial().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required",
});

export const listSalesPipelineQuerySchema = z.object({
  stage: z.enum(SALES_PIPELINE_STAGES).optional(),
  priority: z.enum(SALES_PIPELINE_PRIORITIES).optional(),
  search: z.string().trim().max(200).optional(),
  nextActionDateFrom: optionalDateString,
  nextActionDateTo: optionalDateString,
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
