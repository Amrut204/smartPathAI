export const STUDY_GUIDE_CATEGORIES = [
  "aptitude",
  "technical",
  "company_specific",
  "soft_skills",
  "branch_core",
] as const;

export type StudyGuideCategory = (typeof STUDY_GUIDE_CATEGORIES)[number];

export const STUDY_GUIDE_DIFFICULTIES = [
  "beginner",
  "intermediate",
  "advanced",
] as const;

export type StudyGuideDifficulty = (typeof STUDY_GUIDE_DIFFICULTIES)[number];

export const STUDY_GUIDE_STATUSES = [
  "draft",
  "generating",
  "review",
  "published",
  "archived",
] as const;

export type StudyGuideStatus = (typeof STUDY_GUIDE_STATUSES)[number];

export interface StudyGuideSection {
  heading: string;
  content: string;
  order: number;
}

export interface StudyGuidePracticeQuestion {
  question: string;
  answer: string;
  explanation: string;
}

export interface StudyGuideDocument {
  id: string;
  tenant_id: string | null;
  topic_name: string;
  title: string;
  slug: string;
  category: StudyGuideCategory;
  subcategory: string;
  difficulty: StudyGuideDifficulty;
  status: StudyGuideStatus;
  summary: string;
  markdown_content: string;
  sections: StudyGuideSection[];
  key_concepts: string[];
  practice_questions: StudyGuidePracticeQuestion[];
  placement_tips: string[];
  estimated_read_minutes: number;
  word_count: number;
  version: number;
  ai_provider: string;
  ai_model: string;
  generation_prompt_hash: string;
  generation_cost_estimate_usd: number;
  quality_score: number | null;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface StudyGuideTopicDocument {
  id: string;
  name: string;
  category: StudyGuideCategory;
  subcategory: string;
  priority: number;
  estimated_word_count: number;
  difficulty_range: StudyGuideDifficulty[];
  created_at: string;
}

export interface StudyGuideCostLogEntry {
  id: string;
  tenant_id: string | null;
  guide_id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  created_at: string;
}

export const STUDY_GUIDE_COLLECTION = "study_guides";
export const STUDY_GUIDE_TOPIC_COLLECTION = "study_guide_topics";
export const STUDY_GUIDE_COST_LOG_COLLECTION = "study_guide_cost_log";
