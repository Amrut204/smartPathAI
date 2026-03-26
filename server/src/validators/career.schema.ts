import { z } from "zod";

export const startInterviewSessionSchema = z.object({
  company: z.string().trim().min(2).max(80),
  role: z.string().trim().min(2).max(80),
  focusArea: z.string().trim().min(2).max(80),
  difficulty: z.enum(["foundation", "core", "advanced"]).default("core"),
});

export const completeInterviewSessionSchema = z.object({
  answers: z.array(z.string().trim().min(20).max(1500)).min(3).max(10),
});

export const analyzeInterviewAnswerSchema = z.object({
  questionIndex: z.number().int().min(0).max(9),
  transcript: z.string().trim().min(20).max(3000),
  durationSec: z.number().min(1).max(600),
});

export const saveCodingProfileSchema = z.object({
  platform: z.string().trim().min(2).max(40),
  handle: z.string().trim().min(2).max(80),
  solvedCount: z.number().int().min(0).max(5000),
  weeklyGoal: z.number().int().min(1).max(200),
  streakDays: z.number().int().min(0).max(3650),
});

export const mentorshipRequestSchema = z.object({
  domain: z.string().trim().min(2).max(80),
  targetCompany: z.string().trim().min(2).max(80),
  note: z.string().trim().min(10).max(500),
});

export const walletItemSchema = z.object({
  title: z.string().trim().min(2).max(120),
  issuer: z.string().trim().min(2).max(120),
  type: z.string().trim().min(2).max(40),
  achievedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  evidenceUrl: z.string().url().max(500).optional(),
});

export const recruiterPartnerSchema = z.object({
  company: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(120),
  contactEmail: z.string().email(),
  openRoles: z.array(z.string().trim().min(2).max(80)).min(1).max(10),
  notes: z.string().trim().max(500).optional(),
});

export const campaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  audience: z.string().trim().min(2).max(80),
  channel: z.string().trim().min(2).max(40),
  scheduledFor: z.string().datetime(),
  goal: z.string().trim().min(4).max(240),
});

export const calendarEventSchema = z.object({
  title: z.string().trim().min(2).max(120),
  type: z.string().trim().min(2).max(40),
  startsAt: z.string().datetime(),
  audience: z.string().trim().min(2).max(80),
  reminderOffsetHours: z.number().int().min(1).max(168),
});

export const billingPlanSchema = z.object({
  planName: z.string().trim().min(2).max(80),
  billingCycle: z.enum(["monthly", "quarterly", "annual"]),
  studentLimit: z.number().int().min(1).max(100000),
  aiQuota: z.number().int().min(0).max(1000000),
  messageQuota: z.number().int().min(0).max(1000000),
  monthlyPrice: z.number().min(0).max(10000000),
  renewalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
