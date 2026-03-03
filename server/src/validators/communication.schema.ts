import { z } from "zod";

export const communicationHistoryQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
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
  filters: z.object({
    driveId: z.string().uuid().optional(),
    eligibleOnly: z.boolean().optional(),
    batch: z.string().trim().min(1).max(10).optional(),
    branch: z.string().trim().min(1).max(64).optional(),
    minCgpa: z.number().min(0).max(10).optional(),
  }).optional(),
}).superRefine((value, ctx) => {
  if (!value.templateId && (!value.subject || !value.body)) {
    ctx.addIssue({ code: "custom", message: "Either templateId or subject+body must be provided" });
  }
});
