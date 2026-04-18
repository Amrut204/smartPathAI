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

export const saveMockTestProgressSchema = z.object({
  answers: z.record(z.string(), z.number().int().min(0)).default({}),
  currentQuestion: z.number().int().min(0).default(0),
});

export const mockQuestionSchema = z.object({
  text: z.string().trim().min(1).max(420),
  options: z.array(z.string().trim().min(1).max(180)).min(2).max(8),
  correctIndex: z.number().int().min(0).max(7),
  explanation: z.string().trim().max(1500).optional(),
  skillTag: z.string().trim().min(1).max(160).optional(),
});

export const mockTestAudienceModeSchema = z.enum(["all", "filtered"]);

const mockTestAudienceFields = {
  audienceMode: mockTestAudienceModeSchema.default("all"),
  audienceBranches: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  audienceBatches: z.array(z.string().trim().min(1).max(12)).max(20).default([]),
};

function hasAudienceSelection(value: { audienceMode?: "all" | "filtered"; audienceBranches?: string[]; audienceBatches?: string[] }) {
  if (value.audienceMode !== "filtered") {
    return true;
  }

  return (value.audienceBranches?.length ?? 0) > 0 || (value.audienceBatches?.length ?? 0) > 0;
}

export const createMockTestSchema = z.object({
  title: z.string().trim().min(3).max(200),
  topicId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  durationSec: z.coerce.number().int().min(60).max(14_400),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  questions: z.array(mockQuestionSchema).default([]),
  isActive: z.boolean().default(false),
  ...mockTestAudienceFields,
}).refine(hasAudienceSelection, {
  message: "Select at least one branch or batch when using a filtered audience.",
  path: ["audienceMode"],
});

export const updateMockTestSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  topicId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  durationSec: z.coerce.number().int().min(60).max(14_400).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  isActive: z.boolean().optional(),
  audienceMode: mockTestAudienceModeSchema.optional(),
  audienceBranches: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  audienceBatches: z.array(z.string().trim().min(1).max(12)).max(20).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });

export const publishMockTestSchema = z.object({
  isActive: z.boolean().default(true),
});

export const upsertMockQuestionsSchema = z.object({
  append: z.boolean().default(true),
  questions: z.array(mockQuestionSchema).min(1).max(500),
});
