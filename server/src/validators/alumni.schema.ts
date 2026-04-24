import { z } from "zod";

const academicYearSchema = z.enum(["first_year", "second_year", "third_year", "final_year"]);

export const alumniVerificationStatusSchema = z.enum(["pending", "verified", "unverified"]);
export const alumniOpportunityTypeSchema = z.enum(["referral", "hiring_lead", "mentorship_session", "alumni_talk"]);
export const alumniOpportunityStatusSchema = z.enum(["draft", "active", "closed", "archived"]);

export const alumniContactQuerySchema = z.object({
  q: z.string().trim().min(1).max(160).optional(),
  branch: z.string().trim().min(1).max(80).optional(),
  verificationStatus: alumniVerificationStatusSchema.optional(),
  canRefer: z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
    return value;
  }, z.boolean().optional()),
  isHiring: z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
    return value;
  }, z.boolean().optional()),
});

export const createAlumniContactSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  branch: z.string().trim().min(2).max(80),
  graduationYear: z.string().trim().regex(/^\d{4}$/),
  company: z.string().trim().min(2).max(160),
  role: z.string().trim().min(2).max(120),
  location: z.string().trim().max(160).optional(),
  linkedinUrl: z.string().trim().url().max(500).optional(),
  email: z.string().trim().email().max(320).optional(),
  phone: z.string().trim().max(40).optional(),
  canRefer: z.boolean().default(false),
  canMentor: z.boolean().default(false),
  isHiring: z.boolean().default(false),
  notes: z.string().trim().max(4000).optional(),
  verificationStatus: alumniVerificationStatusSchema.default("pending"),
});

export const updateAlumniContactSchema = createAlumniContactSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required",
});

export const alumniOpportunityQuerySchema = z.object({
  q: z.string().trim().min(1).max(160).optional(),
  type: alumniOpportunityTypeSchema.optional(),
  status: alumniOpportunityStatusSchema.optional(),
});

export const createAlumniOpportunitySchema = z.object({
  type: alumniOpportunityTypeSchema,
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(5000),
  alumniContactId: z.string().trim().min(1).max(120),
  branches: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  batches: z.array(z.string().trim().min(1).max(12)).max(20).default([]),
  academicYears: z.array(academicYearSchema).max(4).default([]),
  driveId: z.union([z.string().trim().min(1).max(120), z.literal(""), z.null()]).optional(),
  status: alumniOpportunityStatusSchema.default("draft"),
  studentIds: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  notes: z.string().trim().max(4000).optional(),
});

export const updateAlumniOpportunitySchema = createAlumniOpportunitySchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required",
});
