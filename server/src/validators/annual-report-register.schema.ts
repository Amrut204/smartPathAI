import { z } from "zod";

export const annualRegisterTypeSchema = z.enum([
  "training_activities",
  "industrial_inplant_training",
  "higher_education_abroad",
  "industrial_visit",
]);

const optionalBranchSchema = z.string().trim().min(1).max(120).optional();
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const annualRegisterListQuerySchema = z.object({
  academicYear: z.string().trim().min(4).max(16).optional(),
  branch: optionalBranchSchema,
  registerType: annualRegisterTypeSchema.optional(),
});

export const annualRegisterEntryInputSchema = z.discriminatedUnion("registerType", [
  z.object({
    registerType: z.literal("training_activities"),
    academicYear: z.string().trim().min(4).max(16),
    branch: optionalBranchSchema,
    payload: z.object({
      programName: z.string().trim().min(2).max(200),
      date: isoDateSchema,
      conductedBy: z.string().trim().min(2).max(200),
    }),
  }),
  z.object({
    registerType: z.literal("industrial_inplant_training"),
    academicYear: z.string().trim().min(4).max(16),
    branch: optionalBranchSchema,
    payload: z.object({
      studentName: z.string().trim().min(2).max(160),
      companyName: z.string().trim().min(2).max(200),
      mode: z.enum(["online", "offline"]),
      fromDate: isoDateSchema,
      toDate: isoDateSchema,
      programme: z.string().trim().min(2).max(160),
    }),
  }),
  z.object({
    registerType: z.literal("higher_education_abroad"),
    academicYear: z.string().trim().min(4).max(16),
    branch: optionalBranchSchema,
    payload: z.object({
      studentName: z.string().trim().min(2).max(160),
      programme: z.string().trim().min(2).max(120),
      coursePursuing: z.string().trim().min(2).max(200),
      instituteName: z.string().trim().min(2).max(200),
      country: z.string().trim().min(2).max(120),
    }),
  }),
  z.object({
    registerType: z.literal("industrial_visit"),
    academicYear: z.string().trim().min(4).max(16),
    branch: optionalBranchSchema,
    payload: z.object({
      companyName: z.string().trim().min(2).max(200),
      studentCount: z.number().int().min(1).max(10000),
      visitDate: isoDateSchema,
    }),
  }),
]);

export type AnnualRegisterEntryInput = z.infer<typeof annualRegisterEntryInputSchema>;
