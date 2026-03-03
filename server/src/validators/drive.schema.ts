import { z } from "zod";

export const driveStatusSchema = z.enum(["upcoming", "active", "completed", "cancelled"]);
export const driveOutcomeSchema = z.enum(["pending", "shortlisted", "selected", "rejected"]);

export const driveCriteriaSchema = z.object({
  minCgpa: z.number().min(0).max(10).optional(),
  maxBacklogs: z.number().int().min(0).optional(),
  branches: z.array(z.string().trim().min(1).max(64)).max(30).optional(),
  minAttendance: z.number().min(0).max(100).optional(),
});

export const driveListQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: driveStatusSchema.optional(),
});

export const createDriveSchema = z.object({
  company: z.string().trim().min(2).max(120),
  role: z.string().trim().min(1).max(120).optional(),
  driveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)"),
  criteria: driveCriteriaSchema.default({}),
  status: driveStatusSchema.default("upcoming"),
});

export const updateDriveSchema = z.object({
  company: z.string().trim().min(2).max(120).optional(),
  role: z.string().trim().min(1).max(120).optional(),
  driveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
  criteria: driveCriteriaSchema.optional(),
  status: driveStatusSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });

export const updateDriveResultsSchema = z.object({
  updates: z.array(z.object({
    studentId: z.string().uuid(),
    outcome: driveOutcomeSchema,
    remarks: z.string().trim().max(500).optional(),
  })).min(1).max(500),
  markCompleted: z.boolean().optional(),
});
