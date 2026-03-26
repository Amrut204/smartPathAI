import { z } from "zod";

export const createSupportRequestSchema = z.object({
  tenantSlug: z.string().trim().min(2).max(64),
  reason: z.string().trim().min(10).max(2000),
});

export const approveSupportRequestSchema = z.object({
  ttlMinutes: z.number().int().min(15).max(24 * 60).default(60),
  note: z.string().trim().max(500).optional(),
});

export const denySupportRequestSchema = z.object({
  note: z.string().trim().min(1).max(500),
});

export const revokeSupportRequestSchema = z.object({
  note: z.string().trim().min(1).max(500),
});

export const listAuditLogsQuerySchema = z.object({
  sessionId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
