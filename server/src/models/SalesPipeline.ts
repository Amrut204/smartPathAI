export const SALES_PIPELINE_STAGES = [
  "contacted",
  "demo_scheduled",
  "demo_completed",
  "pilot_started",
  "pilot_completed",
  "converted",
  "lost",
] as const;

export const SALES_PIPELINE_PRIORITIES = ["A", "B", "C"] as const;

export type SalesPipelineStage = (typeof SALES_PIPELINE_STAGES)[number];
export type SalesPipelinePriority = (typeof SALES_PIPELINE_PRIORITIES)[number];

export interface SalesPipelineDocument {
  id: string;
  tenant_id: string;
  college_name: string;
  college_location: string | null;
  student_count: number | null;
  tpo_name: string;
  tpo_email: string | null;
  tpo_phone: string | null;
  tpo_linkedin: string | null;
  stage: SalesPipelineStage;
  priority: SalesPipelinePriority;
  contact_date: string | null;
  demo_date: string | null;
  pilot_start_date: string | null;
  conversion_date: string | null;
  expected_revenue: number | null;
  lost_reason: string | null;
  next_action: string | null;
  next_action_date: string | null;
  notes: string[];
  linked_demo_feedback: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const SALES_PIPELINE_COLLECTION = "sales_pipeline";
