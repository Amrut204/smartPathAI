import { z } from "zod";

export const driveStatusSchema = z.enum([
  "draft",
  "published",
  "registration_closed",
  "in_process",
  "results_pending",
  "completed",
  "archived",
  "cancelled",
]);
export const driveOutcomeSchema = z.enum(["pending", "shortlisted", "selected", "rejected"]);
export const driveApplicationStateSchema = z.enum(["not_applied", "applied", "withdrawn", "absent"]);
export const driveMouStatusSchema = z.enum(["not_started", "in_discussion", "signed", "not_applicable"]);
export const driveSelectionSourceSchema = z.enum(["on_campus", "off_campus", "self_reported"]);
export const driveVerificationStatusSchema = z.enum(["pending", "verified", "rejected"]);
export const driveJoiningStatusSchema = z.enum(["pending", "joined", "not_joined", "deferred"]);
export const driveResultSourceSchema = z.enum(["employer_email", "employer_portal", "manual_update"]);
export const driveResultReleaseAudienceSchema = z.enum(["selected", "rejected", "finalized"]);

export const driveCriteriaSchema = z.object({
  minCgpa: z.number().min(0).max(10).optional(),
  maxBacklogs: z.number().int().min(0).optional(),
  maxActiveBacklogs: z.number().int().min(0).optional(),
  maxTotalBacklogs: z.number().int().min(0).optional(),
  branches: z.array(z.string().trim().min(1).max(64)).max(30).optional(),
  minAttendance: z.number().min(0).max(100).optional(),
  excludePlacedStudents: z.boolean().optional(),
});

export const driveListQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: driveStatusSchema.optional(),
});

export const createDriveSchema = z.object({
  company: z.string().trim().min(2).max(120),
  role: z.string().trim().min(1).max(120).optional(),
  driveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)"),
  sectorOrIndustry: z.string().trim().min(2).max(120).optional(),
  ctcMinLpa: z.number().min(0).max(1000).optional(),
  ctcMaxLpa: z.number().min(0).max(1000).optional(),
  ctcFinalLpa: z.number().min(0).max(1000).optional(),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
  roundsConducted: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  mouStatus: driveMouStatusSchema.optional(),
  reportingNotes: z.string().trim().max(2000).optional(),
  registrationInstructions: z.string().trim().max(3000).optional(),
  requiredDocuments: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
  location: z.string().trim().min(1).max(160).optional(),
  mode: z.enum(["on_campus", "off_campus", "hybrid"]).optional(),
  dressCode: z.string().trim().max(240).optional(),
  criteria: driveCriteriaSchema.default({}),
  status: driveStatusSchema.default("draft"),
  previewDigest: z.string().trim().min(12).max(256).optional(),
});

export const previewDriveEligibilitySchema = z.object({
  criteria: driveCriteriaSchema.default({}),
});

export const updateDriveSchema = z.object({
  company: z.string().trim().min(2).max(120).optional(),
  role: z.string().trim().min(1).max(120).optional(),
  driveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
  sectorOrIndustry: z.string().trim().min(2).max(120).optional(),
  ctcMinLpa: z.number().min(0).max(1000).optional(),
  ctcMaxLpa: z.number().min(0).max(1000).optional(),
  ctcFinalLpa: z.number().min(0).max(1000).optional(),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
  roundsConducted: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  mouStatus: driveMouStatusSchema.optional(),
  reportingNotes: z.string().trim().max(2000).optional(),
  registrationInstructions: z.string().trim().max(3000).optional(),
  requiredDocuments: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
  location: z.string().trim().min(1).max(160).optional(),
  mode: z.enum(["on_campus", "off_campus", "hybrid"]).optional(),
  dressCode: z.string().trim().max(240).optional(),
  criteria: driveCriteriaSchema.optional(),
  status: driveStatusSchema.optional(),
  previewDigest: z.string().trim().min(12).max(256).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });

export const updateDriveResultsSchema = z.object({
  updates: z.array(z.object({
    studentId: z.string().uuid(),
    outcome: driveOutcomeSchema,
    applicationState: driveApplicationStateSchema.optional(),
    remarks: z.string().trim().max(500).optional(),
    registered: z.boolean().optional(),
    appeared: z.boolean().optional(),
    shortlistedRound: z.string().trim().min(1).max(120).optional(),
    offerDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
    designationOffered: z.string().trim().min(1).max(160).optional(),
    finalCtcLpa: z.number().min(0).max(1000).optional(),
    joiningStatus: driveJoiningStatusSchema.optional(),
    offerLetterReference: z.string().trim().min(1).max(160).optional(),
    offerLetterUrl: z.string().trim().url().max(1024).optional(),
    joiningLetterUrl: z.string().trim().url().max(1024).optional(),
    selectionSource: driveSelectionSourceSchema.optional(),
    verificationStatus: driveVerificationStatusSchema.optional(),
    sourceNote: z.string().trim().max(500).optional(),
    nonPlacementReason: z.string().trim().max(500).optional(),
    actionPlan: z.string().trim().max(500).optional(),
    rounds: z.array(z.object({
      key: z.string().trim().min(1).max(80),
      label: z.string().trim().min(1).max(160),
      stageType: z.enum(["screening", "aptitude", "group_discussion", "technical_interview", "hr_interview", "final_decision", "custom"]),
      status: z.enum(["pending", "qualified", "not_qualified", "scheduled", "completed"]),
      decidedAt: z.string().datetime().optional(),
      releasedAt: z.string().datetime().optional(),
      notes: z.string().trim().max(500).optional(),
    })).max(20).optional(),
  })).min(1).max(500),
  resultIntake: z.object({
    source: driveResultSourceSchema.optional(),
    receivedAt: z.string().datetime().optional(),
    companyResultReference: z.string().trim().max(200).optional(),
    attachmentNote: z.string().trim().max(1000).optional(),
  }).optional(),
  markCompleted: z.boolean().optional(),
  allowOutcomeOverride: z.boolean().optional(),
});

export const driveResultReleasePreviewSchema = z.object({
  audience: driveResultReleaseAudienceSchema,
});

export const driveResultReleaseSchema = driveResultReleasePreviewSchema;

export const driveEligibilityOverrideSchema = z.object({
  decision: z.enum(["eligible", "not_eligible"]),
  reason: z.string().trim().min(3).max(500),
});
