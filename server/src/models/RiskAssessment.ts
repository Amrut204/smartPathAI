export const RISK_CATEGORIES = ["LOW_RISK", "MEDIUM_RISK", "HIGH_RISK"] as const;

export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const RISK_INTERVENTION_ACTIONS = [
  "personal_call",
  "email_sent",
  "peer_mentor_assigned",
  "marked_for_followup",
  "reminder_sent",
  "profile_review",
  "mock_test_assigned",
  "drive_application_push",
] as const;

export type RiskInterventionAction = (typeof RISK_INTERVENTION_ACTIONS)[number];

export interface RiskFactorBreakdown {
  activityScore: number;
  performanceScore: number;
  opportunityScore: number;
  peerScore: number;
  activityPoints: number;
  performancePoints: number;
  opportunityPoints: number;
  peerPoints: number;
  reasons: string[];
}

export interface RiskScoreDocument {
  id: string;
  tenant_id: string;
  student_id: string;
  risk_score: number;
  category: RiskCategory;
  factors: RiskFactorBreakdown;
  recommended_actions: string[];
  last_active_at: string | null;
  eligible_drives: number;
  applied_drives: number;
  mock_tests_attempted: number;
  avg_mock_score: number;
  profile_completeness_pct: number;
  created_at: string;
  updated_at: string;
}

export interface RiskHistoryDocument {
  id: string;
  tenant_id: string;
  student_id: string;
  date: string;
  risk_score: number;
  category: RiskCategory;
  factors: RiskFactorBreakdown;
  created_at: string;
}

export interface RiskInterventionDocument {
  id: string;
  tenant_id: string;
  student_id: string;
  action: RiskInterventionAction;
  notes: string | null;
  created_by: string;
  created_at: string;
}

export const RISK_SCORE_COLLECTION = "risk_scores";
export const RISK_HISTORY_COLLECTION = "risk_history";
export const RISK_INTERVENTION_COLLECTION = "risk_interventions";
