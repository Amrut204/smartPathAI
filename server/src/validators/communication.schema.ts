import { z } from "zod";

export const communicationHistoryQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const audienceFiltersSchema = z.object({
  driveId: z.string().uuid().optional(),
  eligibleOnly: z.boolean().optional(),
  batch: z.string().trim().min(1).max(10).optional(),
  branch: z.string().trim().min(1).max(64).optional(),
  minCgpa: z.number().min(0).max(10).optional(),
  maxRecipients: z.coerce.number().int().min(1).max(5000).optional(),
  emails: z.array(z.string().trim().email()).min(1).max(100).optional(),
  studentIds: z.array(z.string().uuid()).min(1).max(500).optional(),
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
