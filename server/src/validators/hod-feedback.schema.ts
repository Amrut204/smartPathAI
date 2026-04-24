import { z } from "zod";

export const feedbackCampaignTypeSchema = z.enum([
  "drive_feedback",
  "faculty_feedback_single",
  "faculty_feedback_all",
  "training_activity_feedback",
  "mock_test_feedback",
  "general_department_feedback",
  "custom_feedback",
]);

export const feedbackCampaignStatusSchema = z.enum(["draft", "published", "closed", "archived"]);
export const academicYearSchema = z.enum(["first_year", "second_year", "third_year", "final_year"]);

export const feedbackSubjectSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(2).max(160),
});

export const customFeedbackTemplateSchema = z.object({
  subjectLabel: z.string().trim().min(2).max(160),
  commentPrompt: z.string().trim().min(2).max(400).optional().default("Share your feedback."),
  questions: z.array(
    z.object({
      label: z.string().trim().min(2).max(160),
    }),
  ).min(1).max(20),
});

export const createFeedbackCampaignSchema = z.object({
  type: feedbackCampaignTypeSchema,
  title: z.string().trim().min(4).max(180),
  description: z.string().trim().min(4).max(2000).optional().default(""),
  targetBatches: z.array(z.string().trim().min(4).max(16)).max(12).default([]),
  targetAcademicYears: z.array(academicYearSchema).max(4).default([]),
  facultyTargets: z.array(feedbackSubjectSchema).max(40).default([]),
  driveId: z.string().trim().min(1).max(120).optional(),
  openAt: z.string().datetime().optional(),
  closeAt: z.string().datetime().optional(),
  customTemplate: customFeedbackTemplateSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.type === "custom_feedback" && !value.customTemplate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["customTemplate"],
      message: "Custom feedback requires at least one custom question.",
    });
  }
});

export const listFeedbackCampaignsQuerySchema = z.object({
  status: feedbackCampaignStatusSchema.optional(),
  type: feedbackCampaignTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const ratingRecordSchema = z.record(z.string().trim().min(1).max(80), z.coerce.number().int().min(1).max(5));

export const feedbackResponseItemSchema = z.object({
  subjectId: z.string().trim().min(1).max(120).optional(),
  subjectLabel: z.string().trim().min(2).max(160),
  ratings: ratingRecordSchema,
  comment: z.string().trim().max(2000).optional(),
});

export const submitFeedbackResponseSchema = z.object({
  responses: z.array(feedbackResponseItemSchema).min(1).max(60),
});
