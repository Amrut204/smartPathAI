import { z } from "zod";

export const supportTicketTypeSchema = z.enum(["grievance", "suggestion", "feedback"]);
export const supportTicketCategorySchema = z.enum([
  "placement_process",
  "drive_eligibility",
  "profile_or_resume",
  "mock_tests",
  "resources",
  "technical_issue",
  "harassment_or_misconduct",
  "general_feedback",
]);
export const supportTicketPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export const supportTicketStatusSchema = z.enum(["open", "in_review", "resolved", "closed", "rejected"]);
export const supportTicketDestinationRoleSchema = z.enum(["tpo", "hod"]);

export const createSupportTicketSchema = z.object({
  ticketType: supportTicketTypeSchema,
  category: supportTicketCategorySchema,
  title: z.string().trim().min(4).max(160),
  description: z.string().trim().min(10).max(5000),
  priority: supportTicketPrioritySchema.default("medium"),
  destinationRole: supportTicketDestinationRoleSchema.default("tpo"),
  confidential: z.boolean().default(false),
});

export const supportTicketListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: supportTicketStatusSchema.optional(),
  category: supportTicketCategorySchema.optional(),
  priority: supportTicketPrioritySchema.optional(),
  submitterRole: z.enum(["student", "tpo"]).optional(),
  assignedToMe: z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
    return value;
  }, z.boolean().optional()),
  q: z.string().trim().min(1).max(160).optional(),
});

export const updateSupportTicketSchema = z.object({
  status: supportTicketStatusSchema.optional(),
  priority: supportTicketPrioritySchema.optional(),
  assignedToUserId: z.union([z.string().trim().min(1).max(120), z.literal(""), z.null()]).optional(),
  resolutionNote: z.union([z.string().trim().min(2).max(4000), z.literal(""), z.null()]).optional(),
  confidential: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required",
});

export const resolveSupportTicketSchema = z.object({
  resolutionNote: z.string().trim().min(2).max(4000),
  status: z.enum(["resolved", "closed", "rejected"]).default("resolved"),
});
