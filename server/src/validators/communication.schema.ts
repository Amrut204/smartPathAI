import { z } from "zod";

export const communicationHistoryQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const audienceModeSchema = z.enum(["all_students", "drive_specific", "custom"]);
const driveAudienceScopeSchema = z.enum(["eligible", "appearing_applied", "both"]);

const audienceFiltersSchema = z.object({
  audienceMode: audienceModeSchema.optional(),
  driveAudienceScope: driveAudienceScopeSchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
  prn: z.string().trim().min(1).max(64).optional(),
  driveId: z.string().uuid().optional(),
  eligibleOnly: z.boolean().optional(),
  batch: z.string().trim().min(1).max(10).optional(),
  branch: z.string().trim().min(1).max(64).optional(),
  minCgpa: z.number().min(0).max(10).optional(),
  cgpaMax: z.number().min(0).max(10).optional(),
  backlogsMin: z.number().min(0).max(100).optional(),
  backlogsMax: z.number().min(0).max(100).optional(),
  maxActiveBacklogs: z.number().min(0).max(100).optional(),
  totalHistoricalBacklogsMin: z.number().min(0).max(100).optional(),
  totalHistoricalBacklogsMax: z.number().min(0).max(100).optional(),
  maxTotalBacklogs: z.number().min(0).max(100).optional(),
  minAttendance: z.number().min(0).max(100).optional(),
  attendanceMax: z.number().min(0).max(100).optional(),
  readinessMin: z.number().min(0).max(100).optional(),
  readinessMax: z.number().min(0).max(100).optional(),
  profileCompletenessMin: z.number().min(0).max(100).optional(),
  profileCompletenessMax: z.number().min(0).max(100).optional(),
  tenthMarksMin: z.number().min(0).max(100).optional(),
  tenthMarksMax: z.number().min(0).max(100).optional(),
  twelfthMarksMin: z.number().min(0).max(100).optional(),
  twelfthMarksMax: z.number().min(0).max(100).optional(),
  diplomaMarksMin: z.number().min(0).max(100).optional(),
  diplomaMarksMax: z.number().min(0).max(100).optional(),
  waitingOnStudent: z.boolean().optional(),
  waitingOnCollege: z.boolean().optional(),
  hasResume: z.boolean().optional(),
  isCertified: z.boolean().optional(),
  canAccessResources: z.boolean().optional(),
  canAccessMockTests: z.boolean().optional(),
  targetRole: z.string().trim().min(1).max(120).optional(),
  preferredLocation: z.string().trim().min(1).max(120).optional(),
  willingToRelocate: z.boolean().optional(),
  eligibleForUpcomingDrive: z.boolean().optional(),
  isPlaced: z.boolean().optional(),
  isActive7d: z.boolean().optional(),
  appliedRecently: z.boolean().optional(),
  needsIntervention: z.boolean().optional(),
  maxRecipients: z.coerce.number().int().min(1).max(5000).optional(),
  emails: z.array(z.string().trim().email()).min(1).max(100).optional(),
  studentIds: z.array(z.string().uuid()).min(1).max(500).optional(),
}).superRefine((value, ctx) => {
  const rangeChecks: Array<{ min: number | undefined; max: number | undefined; maxField: string; label: string }> = [
    { min: value.minCgpa, max: value.cgpaMax, maxField: "cgpaMax", label: "CGPA" },
    { min: value.backlogsMin, max: value.backlogsMax, maxField: "backlogsMax", label: "active backlogs" },
    { min: value.totalHistoricalBacklogsMin, max: value.totalHistoricalBacklogsMax, maxField: "totalHistoricalBacklogsMax", label: "total historical backlogs" },
    { min: value.minAttendance, max: value.attendanceMax, maxField: "attendanceMax", label: "attendance" },
    { min: value.readinessMin, max: value.readinessMax, maxField: "readinessMax", label: "readiness" },
    { min: value.profileCompletenessMin, max: value.profileCompletenessMax, maxField: "profileCompletenessMax", label: "profile completeness" },
    { min: value.tenthMarksMin, max: value.tenthMarksMax, maxField: "tenthMarksMax", label: "10th marks" },
    { min: value.twelfthMarksMin, max: value.twelfthMarksMax, maxField: "twelfthMarksMax", label: "12th marks" },
    { min: value.diplomaMarksMin, max: value.diplomaMarksMax, maxField: "diplomaMarksMax", label: "Diploma marks" },
  ];

  rangeChecks.forEach((range) => {
    if (range.min !== undefined && range.max !== undefined && range.min > range.max) {
      ctx.addIssue({
        code: "custom",
        path: [range.maxField],
        message: `${range.label} max should be greater than or equal to min`,
      });
    }
  });

  if (value.driveAudienceScope && value.audienceMode !== "drive_specific") {
    ctx.addIssue({
      code: "custom",
      path: ["driveAudienceScope"],
      message: "Drive audience scope is only valid for drive-specific audience mode",
    });
  }

  if (value.audienceMode === "drive_specific" && !value.driveId) {
    ctx.addIssue({
      code: "custom",
      path: ["driveId"],
      message: "Drive-specific audience requires a selected drive",
    });
  }

  if (value.audienceMode === "custom") {
    const hasCustomCriterion = Boolean(
      value.driveId
      || value.q
      || value.prn
      || value.batch
      || value.branch
      || value.minCgpa !== undefined
      || value.cgpaMax !== undefined
      || value.backlogsMin !== undefined
      || value.backlogsMax !== undefined
      || value.maxActiveBacklogs !== undefined
      || value.totalHistoricalBacklogsMin !== undefined
      || value.totalHistoricalBacklogsMax !== undefined
      || value.maxTotalBacklogs !== undefined
      || value.minAttendance !== undefined
      || value.attendanceMax !== undefined
      || value.readinessMin !== undefined
      || value.readinessMax !== undefined
      || value.profileCompletenessMin !== undefined
      || value.profileCompletenessMax !== undefined
      || value.tenthMarksMin !== undefined
      || value.tenthMarksMax !== undefined
      || value.twelfthMarksMin !== undefined
      || value.twelfthMarksMax !== undefined
      || value.diplomaMarksMin !== undefined
      || value.diplomaMarksMax !== undefined
      || value.waitingOnStudent !== undefined
      || value.waitingOnCollege !== undefined
      || value.hasResume !== undefined
      || value.isCertified !== undefined
      || value.canAccessResources !== undefined
      || value.canAccessMockTests !== undefined
      || value.targetRole
      || value.preferredLocation
      || value.willingToRelocate !== undefined
      || value.eligibleForUpcomingDrive !== undefined
      || value.isPlaced !== undefined
      || value.isActive7d !== undefined
      || value.appliedRecently !== undefined
      || value.needsIntervention !== undefined
      || (value.emails?.length ?? 0) > 0
      || (value.studentIds?.length ?? 0) > 0
    );

    if (!hasCustomCriterion) {
      ctx.addIssue({
        code: "custom",
        path: ["audienceMode"],
        message: "Custom audience requires at least one filter criterion",
      });
    }
  }
});

export const createEmailTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(120),
  subject: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(10_000),
});

export const sendCommunicationSchema = z.object({
  templateId: z.string().uuid().optional(),
  subject: z.string().trim().min(1).max(180).optional(),
  body: z.string().trim().min(1).max(10_000).optional(),
  variables: z.record(z.string(), z.string()).optional(),
  filters: audienceFiltersSchema.optional(),
}).superRefine((value, ctx) => {
  if (!value.templateId && (!value.subject || !value.body)) {
    ctx.addIssue({ code: "custom", message: "Either templateId or subject+body must be provided" });
  }
});

export const previewCommunicationSchema = z.object({
  templateId: z.string().uuid().optional(),
  subject: z.string().trim().min(1).max(180).optional(),
  body: z.string().trim().min(1).max(10_000).optional(),
  filters: audienceFiltersSchema.optional(),
});

export const announcementPreviewSchema = z.object({
  title: z.string().trim().min(2).max(180),
  message: z.string().trim().min(1).max(10_000),
  priority: z.enum(["normal", "important", "urgent"]).default("normal"),
  relatedDriveId: z.string().uuid().optional(),
  expiresAt: z.string().datetime().optional(),
  filters: audienceFiltersSchema.optional(),
});

export const createAnnouncementSchema = announcementPreviewSchema;

export const announcementHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const studentAnnouncementsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const sendGridWebhookSchema = z.array(z.record(z.string(), z.unknown())).max(5_000);

export const unsubscribeQuerySchema = z.object({
  token: z.string().trim().min(16),
});
