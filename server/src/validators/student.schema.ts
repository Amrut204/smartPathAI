import { z } from "zod";

export const studyHoursSchema = z.object({
  topicId: z.string().uuid(),
  studyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
  hours: z.number().positive().max(12),
});

const optionalClearingPhoneSchema = z.union([z.string().trim().min(10).max(20), z.literal("")]).optional();
const optionalClearingEmailSchema = z.union([z.string().trim().email(), z.literal("")]).optional();
const optionalClearingUrlSchema = z.union([z.string().trim().url(), z.literal("")]).optional();
const optionalClearingStringSchema = (min = 1, max = 120) => z.union([z.string().trim().min(min).max(max), z.literal("")]).optional();
const optionalClearingBatchSchema = z.union([z.string().trim().regex(/^\d{4}$/), z.literal("")]).optional();
const semesterValues = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;
const optionalClearingSemesterSchema = z.union([z.enum(semesterValues), z.literal("")]).optional();
const optionalClearingNumberSchema = (schema: z.ZodNumber) => z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return value;
}, z.union([schema, z.null()]).optional());
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

export const updateStudentProfileSchema = z.object({
  skills: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  prn: optionalClearingStringSchema(1, 64),
  rollNumber: optionalClearingStringSchema(1, 64),
  branch: optionalClearingStringSchema(2, 64),
  batch: optionalClearingBatchSchema,
  degree: optionalClearingStringSchema(2, 120),
  currentSemester: optionalClearingSemesterSchema,
  cgpa: optionalClearingNumberSchema(z.number().min(0).max(10)),
  activeBacklogs: optionalClearingNumberSchema(z.number().int().min(0)),
  totalHistoricalBacklogs: optionalClearingNumberSchema(z.number().int().min(0)),
  attendancePct: optionalClearingNumberSchema(z.number().min(0).max(100)),
  phone: optionalClearingPhoneSchema,
  personalEmail: optionalClearingEmailSchema,
  resumeUrl: optionalClearingUrlSchema,
  targetRoles: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
  preferredLocations: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
  willingToRelocate: z.boolean().optional(),
  linkedIn: optionalClearingUrlSchema,
  githubUrl: optionalClearingUrlSchema,
  portfolioUrl: optionalClearingUrlSchema,
  internships: z.string().trim().max(2000).optional(),
  projects: z.string().trim().max(2000).optional(),
  certifications: z.string().trim().max(2000).optional(),
  achievements: z.string().trim().max(2000).optional(),
  languages: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  dataConsentAccepted: z.boolean().optional(),
  accuracyDeclarationAccepted: z.boolean().optional(),
});

export const studentOnboardingDeclarationSchema = z.object({
  accepted: z.literal(true),
  typedValue: z.string().trim().min(1).max(120),
});

export const studentProfileCertificationSchema = z.object({
  typedValue: z.string().trim().min(1).max(120),
});

export const studentDriveApplySchema = z.object({
  confirmDeclaration: z.literal(true),
});

export const studentDriveWithdrawSchema = z.object({
  confirmWithdrawal: z.literal(true),
});

export const leaderboardQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const pointsHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const updateTopicProgressSchema = z.object({
  topicId: z.string().uuid(),
  status: z.enum(["incomplete", "in_progress", "complete"]),
});

export const bulkTopicProgressSchema = z.object({
  topicIds: z.array(z.string().uuid()).min(1).max(100),
  status: z.enum(["incomplete", "in_progress", "complete"]),
});

export const tpoStudentListQuerySchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    q: z.string().trim().min(1).max(120).optional(),
    batch: z.string().trim().min(1).max(10).optional(),
    branch: z.string().trim().min(1).max(30).optional(),
    prn: z.string().trim().min(1).max(64).optional(),
    cgpaMin: z.coerce.number().min(0).max(10).optional(),
    cgpaMax: z.coerce.number().min(0).max(10).optional(),
    readinessMin: z.coerce.number().min(0).max(100).optional(),
    readinessMax: z.coerce.number().min(0).max(100).optional(),
    attendanceMin: z.coerce.number().min(0).max(100).optional(),
    attendanceMax: z.coerce.number().min(0).max(100).optional(),
    backlogsMin: z.coerce.number().int().min(0).optional(),
    backlogsMax: z.coerce.number().int().min(0).optional(),
    totalHistoricalBacklogsMin: z.coerce.number().int().min(0).optional(),
    totalHistoricalBacklogsMax: z.coerce.number().int().min(0).optional(),
    profileCompletenessMin: z.coerce.number().min(0).max(100).optional(),
    profileCompletenessMax: z.coerce.number().min(0).max(100).optional(),
    missingResume: optionalQueryBooleanSchema,
    waitingOnStudent: optionalQueryBooleanSchema,
    waitingOnCollege: optionalQueryBooleanSchema,
    canAccessResources: optionalQueryBooleanSchema,
    canAccessMockTests: optionalQueryBooleanSchema,
    targetRole: z.string().trim().min(1).max(120).optional(),
    preferredLocation: z.string().trim().min(1).max(120).optional(),
    willingToRelocate: optionalQueryBooleanSchema,
    sortBy: z.enum(["cgpa", "created_at", "readiness_score", "profile_completeness"]).default("created_at"),
    sortDir: z.enum(["asc", "desc"]).default("desc"),
  })
  .superRefine((value, ctx) => {
    if (value.cgpaMin != null && value.cgpaMax != null && value.cgpaMin > value.cgpaMax) {
      ctx.addIssue({ code: "custom", message: "cgpaMin cannot be greater than cgpaMax", path: ["cgpaMin"] });
    }
    if (value.backlogsMin != null && value.backlogsMax != null && value.backlogsMin > value.backlogsMax) {
      ctx.addIssue({ code: "custom", message: "backlogsMin cannot be greater than backlogsMax", path: ["backlogsMin"] });
    }
    if (value.attendanceMin != null && value.attendanceMax != null && value.attendanceMin > value.attendanceMax) {
      ctx.addIssue({ code: "custom", message: "attendanceMin cannot be greater than attendanceMax", path: ["attendanceMin"] });
    }
    if (value.readinessMin != null && value.readinessMax != null && value.readinessMin > value.readinessMax) {
      ctx.addIssue({ code: "custom", message: "readinessMin cannot be greater than readinessMax", path: ["readinessMin"] });
    }
    if (
      value.totalHistoricalBacklogsMin != null
      && value.totalHistoricalBacklogsMax != null
      && value.totalHistoricalBacklogsMin > value.totalHistoricalBacklogsMax
    ) {
      ctx.addIssue({
        code: "custom",
        message: "totalHistoricalBacklogsMin cannot be greater than totalHistoricalBacklogsMax",
        path: ["totalHistoricalBacklogsMin"],
      });
    }
    if (
      value.profileCompletenessMin != null
      && value.profileCompletenessMax != null
      && value.profileCompletenessMin > value.profileCompletenessMax
    ) {
      ctx.addIssue({
        code: "custom",
        message: "profileCompletenessMin cannot be greater than profileCompletenessMax",
        path: ["profileCompletenessMin"],
      });
    }
  });

export const tpoStudentUpdateSchema = z.object({
  cgpa: z.number().min(0).max(10).optional(),
  backlogs: z.number().int().min(0).optional(),
  totalHistoricalBacklogs: z.number().int().min(0).optional(),
  attendancePct: z.number().min(0).max(100).optional(),
  rollNumber: z.string().trim().min(1).max(64).optional(),
  prn: z.string().trim().min(1).max(64).optional(),
  degree: z.string().trim().min(2).max(120).optional(),
  currentSemester: z.string().trim().min(1).max(32).optional(),
  branch: z.string().trim().min(2).max(64).optional(),
  batch: z.string().trim().regex(/^\d{4}$/).optional(),
});

export const csvUploadPreviewSchema = z.object({
  csv: z.string().min(1),
});

export const csvUploadConfirmSchema = z.object({
  mapping: z.object({
    fullName: z.string().min(1),
    email: z.string().min(1),
    prn: z.string().optional(),
    rollNumber: z.string().min(1),
    degree: z.string().optional(),
    branch: z.string().min(1),
    batch: z.string().min(1),
    currentSemester: z.string().optional(),
    cgpa: z.string().optional(),
    backlogs: z.string().optional(),
    totalHistoricalBacklogs: z.string().optional(),
    attendancePct: z.string().optional(),
  }),
  rows: z.array(z.record(z.string(), z.string())).min(1),
});
