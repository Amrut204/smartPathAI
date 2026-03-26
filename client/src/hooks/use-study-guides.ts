import useSWR from "swr";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error: { code: string; message: string; details?: Array<{ field?: string; message: string }> };
  meta?: { timestamp?: string };
}

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!payload.success) throw new Error(payload.error.message);
  return payload.data;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!payload.success) throw new Error(payload.error.message);
  return payload.data;
}

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!payload.success) throw new Error(payload.error.message);
  return payload.data;
}

// ─── Types ─────────────────────────────────────────────────────────

export interface StudyGuideListItem {
  id: string;
  topicName: string;
  title: string;
  slug: string;
  category: string;
  subcategory: string;
  difficulty: string;
  status: string;
  summary: string;
  keyConcepts: string[];
  estimatedReadMinutes: number;
  wordCount: number;
  qualityScore: number | null;
  createdAt: string;
  publishedAt: string | null;
}

interface StudyGuideListResponse {
  items: StudyGuideListItem[];
  hasMore: boolean;
  nextCursor: string | null;
}

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

export interface StudyGuideDetail {
  id: string;
  tenant_id: string | null;
  topic_name: string;
  title: string;
  slug: string;
  category: string;
  subcategory: string;
  difficulty: string;
  status: string;
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
  quality_score: number | null;
  created_at: string;
  published_at: string | null;
}

export interface StudyGuideCategorySummary {
  category: string;
  count: number;
}

// ─── Hooks ─────────────────────────────────────────────────────────

export function useStudyGuides(filters?: {
  category?: string;
  difficulty?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters?.category) params.set("category", filters.category);
  if (filters?.difficulty) params.set("difficulty", filters.difficulty);
  if (filters?.search) params.set("search", filters.search);
  if (filters?.cursor) params.set("cursor", filters.cursor);
  if (filters?.limit) params.set("limit", String(filters.limit));

  const query = params.toString();
  const url = `/api/v1/study-guides${query ? `?${query}` : ""}`;

  return useSWR<StudyGuideListResponse>(url, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
}

export function useStudyGuideBySlug(slug: string | null) {
  const url = slug ? `/api/v1/study-guides/by-slug/${encodeURIComponent(slug)}` : null;

  return useSWR<StudyGuideDetail>(url, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useStudyGuideById(guideId: string | null) {
  const url = guideId ? `/api/v1/study-guides/guide/${encodeURIComponent(guideId)}` : null;

  return useSWR<StudyGuideDetail>(url, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useStudyGuideCategories() {
  return useSWR<StudyGuideCategorySummary[]>(
    "/api/v1/study-guides/categories/summary",
    fetcher,
    { revalidateOnFocus: false },
  );
}

// ─── Mutations ─────────────────────────────────────────────────────

export function generateStudyGuide(input: {
  topicName: string;
  category: string;
  subcategory?: string;
  difficulty?: string;
  companyContext?: string;
}): Promise<StudyGuideDetail> {
  return postJson("/api/v1/study-guides/generate", input);
}

export function reviewStudyGuide(
  guideId: string,
  input: { qualityScore: number; reviewNotes?: string; status: string },
): Promise<StudyGuideDetail> {
  return patchJson(`/api/v1/study-guides/${guideId}/review`, input);
}
