import { z } from "zod";

export const studyHoursSchema = z.object({
  topicId: z.string().uuid(),
  studyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
  hours: z.number().positive().max(12),
});

export const updateStudentProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  skills: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  profileData: z.record(z.string(), z.unknown()).optional(),
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
    limit: z.coerce.number().int().min(1).max(100).default(20),
    batch: z.string().trim().min(1).max(10).optional(),
    branch: z.string().trim().min(1).max(30).optional(),
    cgpaMin: z.coerce.number().min(0).max(10).optional(),
    cgpaMax: z.coerce.number().min(0).max(10).optional(),
    backlogsMin: z.coerce.number().int().min(0).optional(),
    backlogsMax: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(["cgpa", "created_at"]).default("created_at"),
    sortDir: z.enum(["asc", "desc"]).default("desc"),
  })
  .superRefine((value, ctx) => {
    if (value.cgpaMin != null && value.cgpaMax != null && value.cgpaMin > value.cgpaMax) {
      ctx.addIssue({ code: "custom", message: "cgpaMin cannot be greater than cgpaMax", path: ["cgpaMin"] });
    }
    if (value.backlogsMin != null && value.backlogsMax != null && value.backlogsMin > value.backlogsMax) {
      ctx.addIssue({ code: "custom", message: "backlogsMin cannot be greater than backlogsMax", path: ["backlogsMin"] });
    }
  });

export const tpoStudentUpdateSchema = z.object({
  cgpa: z.number().min(0).max(10).optional(),
  backlogs: z.number().int().min(0).optional(),
  attendancePct: z.number().min(0).max(100).optional(),
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
    rollNumber: z.string().min(1),
    branch: z.string().min(1),
    batch: z.string().min(1),
    cgpa: z.string().optional(),
    backlogs: z.string().optional(),
    attendancePct: z.string().optional(),
  }),
  rows: z.array(z.record(z.string(), z.string())).min(1),
});
