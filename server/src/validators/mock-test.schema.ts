import { z } from "zod";

export const listMockTestsQuerySchema = z.object({
  topicId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const curatedMockTestsQuerySchema = z.object({
  topicId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
});

export const submitMockTestSchema = z.object({
  attemptId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(200),
  answers: z.array(z.object({ questionIndex: z.number().int().min(0), selectedOption: z.number().int().min(0) })).default([]),
  integrity: z.object({
    copyEvents: z.number().int().min(0).max(500).default(0),
    pasteEvents: z.number().int().min(0).max(500).default(0),
    visibilityChanges: z.number().int().min(0).max(500).default(0),
    blurEvents: z.number().int().min(0).max(500).default(0),
  }).optional(),
});

export const mockQuestionSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  options: z.array(z.string().trim().min(1).max(400)).min(2).max(8),
  correctIndex: z.number().int().min(0).max(7),
  explanation: z.string().trim().max(1500).optional(),
});

export const createMockTestSchema = z.object({
  title: z.string().trim().min(3).max(200),
  topicId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  durationSec: z.coerce.number().int().min(60).max(14_400),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  questions: z.array(mockQuestionSchema).default([]),
  isActive: z.boolean().default(false),
});

export const updateMockTestSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  topicId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  durationSec: z.coerce.number().int().min(60).max(14_400).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });

export const publishMockTestSchema = z.object({
  isActive: z.boolean().default(true),
});

export const upsertMockQuestionsSchema = z.object({
  append: z.boolean().default(true),
  questions: z.array(mockQuestionSchema).min(1).max(500),
});
