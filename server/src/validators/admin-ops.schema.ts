import { z } from "zod";

import { createMockTestSchema, publishMockTestSchema, upsertMockQuestionsSchema } from "./mock-test.schema.js";
import { csvUploadConfirmSchema, csvUploadPreviewSchema } from "./student.schema.js";
import { updateTenantEmailSettingsSchema } from "./tenant.schema.js";

const optionalQueryBooleanSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return value;
}, z.boolean().optional());

const optionalUrlSchema = z.union([z.string().trim().url().max(500), z.literal(""), z.null()]).optional();
const optionalStringSchema = z.union([z.string().trim().max(500), z.literal(""), z.null()]).optional();
const optionalStringArraySchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value;
}, z.array(z.string().trim().min(1).max(120)).max(20).optional());

export const adminTenantQuerySchema = z.object({
  tenantId: z.string().trim().min(1).max(120),
});

export const adminStudentListQuerySchema = adminTenantQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  q: z.string().trim().min(1).max(120).optional(),
  batch: z.string().trim().min(1).max(10).optional(),
  branch: z.string().trim().min(1).max(30).optional(),
});

export const adminCreateStudentSchema = z.object({
  tenantId: z.string().trim().min(1).max(120),
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(320),
  rollNumber: z.string().trim().min(1).max(64),
  branch: z.string().trim().min(2).max(80),
  batch: z.string().trim().regex(/^\d{4}$/),
  prn: z.string().trim().max(64).optional(),
  degree: z.string().trim().max(120).optional(),
  currentSemester: z.string().trim().max(32).optional(),
  cgpa: z.coerce.number().min(0).max(10).optional(),
  backlogs: z.coerce.number().int().min(0).optional(),
  totalHistoricalBacklogs: z.coerce.number().int().min(0).optional(),
  attendancePct: z.coerce.number().min(0).max(100).optional(),
});

export const adminTpoListQuerySchema = adminTenantQuerySchema;

export const adminCreateTpoSchema = z.object({
  tenantId: z.string().trim().min(1).max(120),
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(320),
});

export const adminCreateCollegeSchema = z.object({
  collegeName: z.string().trim().min(2).max(200),
  tpoFullName: z.string().trim().min(2).max(160),
  tpoEmail: z.string().trim().email().max(320),
  tpoPassword: z.string().min(8).max(120),
  branches: z.array(z.string().trim().min(2).max(80)).min(1).max(50),
});

export const adminUpdateTpoSchema = z.object({
  tenantId: z.string().trim().min(1).max(120),
  fullName: z.string().trim().min(2).max(160).optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).some((key) => key !== "tenantId"), {
  message: "At least one TPO field is required",
});

export const adminResetTpoCredentialsSchema = z.object({
  tenantId: z.string().trim().min(1).max(120),
});

export const adminQueueImportCredentialsSchema = z.object({
  tenantId: z.string().trim().min(1).max(120),
  importJobId: z.string().trim().min(1).max(120),
});

export const adminResetStudentCredentialsSchema = z.object({
  tenantId: z.string().trim().min(1).max(120),
});

export const adminDeleteStudentSchema = z.object({
  tenantId: z.string().trim().min(1).max(120),
});

export const adminUnlockStudentProfileSchema = z.object({
  tenantId: z.string().trim().min(1).max(120),
});

export const adminCsvUploadPreviewSchema = csvUploadPreviewSchema.extend({
  tenantId: z.string().trim().min(1).max(120),
});

export const adminCsvUploadConfirmSchema = csvUploadConfirmSchema.extend({
  tenantId: z.string().trim().min(1).max(120),
});

export const adminMockTestQuerySchema = adminTenantQuerySchema;

export const adminCreateMockTestSchema = createMockTestSchema.extend({
  tenantId: z.string().trim().min(1).max(120),
});

export const adminUpdateMockTestSchema = z.object({
  tenantId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(3).max(200).optional(),
  topicId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  durationSec: z.coerce.number().int().min(60).max(14_400).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).some((key) => key !== "tenantId"), {
  message: "At least one field is required",
});

export const adminPublishMockTestSchema = publishMockTestSchema.extend({
  tenantId: z.string().trim().min(1).max(120),
});

export const adminUpsertMockQuestionsSchema = upsertMockQuestionsSchema.extend({
  tenantId: z.string().trim().min(1).max(120),
});

export const adminResourceQuerySchema = adminTenantQuerySchema;

export const adminCreateExternalResourceSchema = z.object({
  tenantId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  url: z.string().trim().url().max(500),
  resourceType: z.string().trim().min(2).max(60),
  topicId: z.union([z.string().trim().min(1).max(120), z.literal(""), z.null()]).optional(),
  durationSec: z.coerce.number().int().min(0).max(14_400).optional(),
  thumbnailUrl: optionalUrlSchema,
  isActive: optionalQueryBooleanSchema.default(true),
  branchRelevance: optionalStringArraySchema,
  careerTracks: optionalStringArraySchema,
  recommendedFor: optionalStringArraySchema,
  contentPackLabels: optionalStringArraySchema,
});

export const adminUploadResourceFieldsSchema = z.object({
  tenantId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  topicId: z.union([z.string().trim().min(1).max(120), z.literal(""), z.null()]).optional(),
  resourceType: z.string().trim().min(2).max(60),
  durationSec: z.coerce.number().int().min(0).max(14_400).optional(),
  thumbnailUrl: optionalUrlSchema,
  isActive: optionalQueryBooleanSchema.default(true),
  branchRelevance: optionalStringArraySchema,
  careerTracks: optionalStringArraySchema,
  recommendedFor: optionalStringArraySchema,
  contentPackLabels: optionalStringArraySchema,
});

export const adminUpdateResourceSchema = z.object({
  tenantId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  topicId: z.union([z.string().trim().min(1).max(120), z.literal(""), z.null()]).optional(),
  resourceType: z.string().trim().min(2).max(60).optional(),
  durationSec: z.coerce.number().int().min(0).max(14_400).optional(),
  thumbnailUrl: optionalUrlSchema,
  isActive: optionalQueryBooleanSchema,
  url: optionalUrlSchema,
  branchRelevance: optionalStringArraySchema,
  careerTracks: optionalStringArraySchema,
  recommendedFor: optionalStringArraySchema,
  contentPackLabels: optionalStringArraySchema,
}).refine((value) => Object.keys(value).some((key) => key !== "tenantId"), {
  message: "At least one resource field is required",
});

export const adminUpdateIntegrationsSchema = z.object({
  tenantId: z.string().trim().min(1).max(120),
  googleForm: optionalUrlSchema,
  googleSheet: optionalUrlSchema,
  googleDriveSharedDriveId: optionalStringSchema,
  googleDriveRootFolderId: optionalStringSchema,
  label: optionalStringSchema,
  notes: optionalStringSchema,
});

export const adminRetryJobSchema = z.object({
  tenantId: z.string().trim().min(1).max(120),
});

export const adminUpdateTenantEmailSettingsSchema = updateTenantEmailSettingsSchema.extend({
  tenantId: z.string().trim().min(1).max(120),
});
