import { z } from "zod";

export const automationTypeSchema = z.enum([
  "eligible_not_applied",
  "blocked_profile_followup",
  "weekly_tpo_digest",
  "scheduled_report_pack",
  "unplaced_intervention_refresh",
  "result_notification_review",
]);

export const automationRunStatusSchema = z.enum([
  "draft",
  "ready",
  "sent",
  "completed",
  "failed",
  "dismissed",
]);

export const automationTriggerSourceSchema = z.enum([
  "scheduled",
  "manual",
  "result_release",
  "drive_update",
]);

export const automationRunListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: automationRunStatusSchema.optional(),
  automationType: automationTypeSchema.optional(),
  triggerSource: automationTriggerSourceSchema.optional(),
});

export const automationRunNowSchema = z.object({
  automationType: automationTypeSchema,
  frequency: z.enum(["weekly", "monthly"]).optional(),
});
