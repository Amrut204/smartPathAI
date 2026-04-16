import { z } from "zod";

const booleanQuery = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}, z.boolean().optional());

export const reportTypeSchema = z.enum([
  "drive_completion_summary",
  "weekly_placement_status",
  "monthly_branch_breakdown",
  "company_visit_register",
  "final_placement_statistics",
  "naac_5_2_progression",
  "branch_wise_placement_analysis",
  "placement_brochure_pack",
  "unplaced_student_action_report",
  "employer_data_register",
  "tp_annual_report_workbook",
]);

const reportFilterBaseSchema = z.object({
  preset: z.enum(["this_week", "this_month", "placement_season", "academic_year", "custom"]).default("placement_season"),
  academicYear: z.string().trim().min(4).max(16).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  branch: z.string().trim().min(1).max(80).optional(),
  placementSource: z.enum(["on_campus", "off_campus", "self_reported"]).optional(),
  verificationStatus: z.enum(["pending", "verified", "rejected"]).optional(),
  campusMode: z.enum(["on_campus", "off_campus"]).optional(),
  driveStatus: z.enum(["upcoming", "active", "completed", "cancelled"]).optional(),
  company: z.string().trim().min(1).max(120).optional(),
  sector: z.string().trim().min(1).max(120).optional(),
  driveId: z.string().uuid().optional(),
  includeOffCampus: booleanQuery,
});

export const reportFilterSchema = reportFilterBaseSchema.refine((value) => {
  if (value.preset !== "custom") return true;
  return Boolean(value.dateFrom && value.dateTo);
}, {
  message: "Custom report ranges require both dateFrom and dateTo",
  path: ["dateFrom"],
});

export const reportExportQuerySchema = reportFilterBaseSchema.extend({
  format: z.enum(["xlsx", "pdf", "csv"]).default("xlsx"),
}).refine((value) => {
  if (value.preset !== "custom") return true;
  return Boolean(value.dateFrom && value.dateTo);
}, {
  message: "Custom report ranges require both dateFrom and dateTo",
  path: ["dateFrom"],
});
