export const DEMO_FEEDBACK_STATUSES = [
  "demo_completed",
  "follow_up_scheduled",
  "pilot_started",
  "converted",
  "lost",
] as const;

export type DemoFeedbackStatus = (typeof DEMO_FEEDBACK_STATUSES)[number];

export interface DemoFeedbackDocument {
  id: string;
  tenant_id: string;
  college_name: string;
  tpo_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  demo_date: string;
  demo_rating: number | null;
  product_fit: number | null;
  conversion_likelihood: number | null;
  pain_points: string[];
  feature_requests: string[];
  concerns: string[];
  competitor_mentions: string[];
  next_steps: string | null;
  follow_up_date: string | null;
  status: DemoFeedbackStatus;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const DEMO_FEEDBACK_COLLECTION = "demo_feedback";
