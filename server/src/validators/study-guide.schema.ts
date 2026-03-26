import { z } from "zod";

export const listStudyGuidesSchema = z.object({
  category: z.enum(["aptitude", "technical", "company_specific", "soft_skills", "branch_core"]).optional(),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  search: z.string().trim().max(200).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const generateStudyGuideSchema = z.object({
  topicName: z.string().trim().min(2).max(120),
  category: z.enum(["aptitude", "technical", "company_specific", "soft_skills", "branch_core"]),
  subcategory: z.string().trim().min(1).max(60).default("general"),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]).default("intermediate"),
  companyContext: z.string().trim().max(200).optional(),
});

export const batchGenerateSchema = z.object({
  category: z.enum(["aptitude", "technical", "company_specific", "soft_skills", "branch_core"]).optional(),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]).default("intermediate"),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const reviewStudyGuideSchema = z.object({
  qualityScore: z.number().int().min(0).max(100),
  reviewNotes: z.string().trim().max(1000).optional(),
  status: z.enum(["published", "review", "archived"]),
});
