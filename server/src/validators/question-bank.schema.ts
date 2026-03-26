import { z } from "zod";

export const questionBankStatusSchema = z.enum(["draft", "reviewed", "approved", "rejected"]);

export const listQuestionBankQuerySchema = z.object({
  status: questionBankStatusSchema.optional(),
  llmSource: z.string().trim().min(1).max(50).optional(),
  topic: z.string().trim().min(1).max(200).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  duplicatesOnly: z.coerce.boolean().optional(),
  flaggedOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const reviewQuestionBankSchema = z.object({
  status: questionBankStatusSchema.optional(),
  qualityScore: z.coerce.number().min(0).max(100).optional(),
  reviewNotes: z.string().trim().max(1500).optional().nullable(),
  flaggedForMocks: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required",
});
