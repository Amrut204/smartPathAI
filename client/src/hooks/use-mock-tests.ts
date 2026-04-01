import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { withCsrfHeader } from "../utils/csrf";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error: { code: string; message: string; details?: Array<{ field?: string; message: string }> };
  meta?: { pagination?: { cursor: string | null; has_more: boolean; limit: number }; timestamp?: string; correlation_id?: string };
}

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = (await response.json()) as ApiResponse<T>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}

export interface MockTestListItem {
  id: string;
  title: string;
  topicId: string | null;
  companyId: string | null;
  topicName?: string | null;
  companyName?: string | null;
  trackCategory?: "company_prep" | "verbal" | "aptitude" | "branch_core" | "general";
  durationSec: number;
  difficulty: string;
  attemptCount: number;
  avgScore?: number | null;
  lastScore?: number | null;
  lastSubmittedAt?: string | null;
  recommendationScore?: number;
  recommendationReasons?: string[];
  recommendationBucket?: string;
  difficultyFit?: "stretch" | "fit" | "easy";
  primaryBranches?: string[];
  isCrossBranch?: boolean;
}

export interface MockTestMetadata {
  id: string;
  title: string;
  topicId: string | null;
  companyId: string | null;
  durationSec: number;
  difficulty: string;
  questionCount: number;
}

export interface CuratedMockTestsPayload {
  context: {
    branchTrackLabel: string | null;
    targetRoles: string[];
    branchCoverageQualified: boolean;
    upcomingDriveCount: number;
    hasPreDriveBundle: boolean;
  };
  stats: {
    totalCatalog: number;
    hardSets: number;
    companyFocused: number;
    avgAttempts: number;
  };
  sections: {
    forYourBranch: MockTestListItem[];
    placementEssentials: MockTestListItem[];
    companyPatternPrep: MockTestListItem[];
    interviewPractice: MockTestListItem[];
    exploreMore: MockTestListItem[];
  };
  preDriveBundle: {
    title: string;
    description: string;
    items: MockTestListItem[];
  } | null;
}

export interface MockTestStartPayload {
  attemptId: string;
  startedAt: string;
  serverTime: string;
  durationSec: number;
  resumed: boolean;
  savedAnswers: Record<string, number>;
  currentQuestion: number;
  questions: Array<{ text: string; options: string[] }>;
}

export interface MockTestSubmitPayload {
  attemptId: string;
  score: number;
  timeTakenSec: number;
  topicBreakdown: Record<string, unknown>;
  skillBreakdown?: Record<string, unknown>;
  pointsAwarded: number;
  readinessScore: number;
  idempotent: boolean;
}

export interface MockTestResultPayload {
  attemptId: string;
  testId: string;
  title: string;
  score: number;
  timeTakenSec: number;
  topicBreakdown: Record<string, unknown>;
  skillBreakdown: Record<string, unknown>;
  submittedAt: string | null;
  attemptedQuestions: number;
  correctAnswers: number;
  incorrectAnswers: number;
  unattemptedQuestions: number;
  percentileRank: number | null;
  attemptPopulation: number;
  weakAreas: Array<{
    skillTag: string;
    masteryLevel: number;
    totalQuestions: number;
    correctAnswers: number;
    lastAssessed: string | null;
  }>;
  nextRecommendedTests: MockTestListItem[];
  retrySuggested: boolean;
  answers: Array<{ questionIndex: number; selectedOption: number; isCorrect: boolean }>;
  questions: Array<{
    text: string;
    options: string[];
    correctIndex: number;
    explanation: string;
    skillTag: string;
    attempted: boolean;
  }>;
}

export interface MockTestTopicOption {
  id: string;
  name: string;
}

export interface MockTestCompanyOption {
  id: string;
  name: string;
}

interface MockTestQuery {
  topicId?: string;
  companyId?: string;
  difficulty?: string;
  limit?: number;
}

function buildMockTestsUrl(query?: MockTestQuery, cursor?: string | null) {
  const params = new URLSearchParams();
  if (query?.topicId) params.set("topicId", query.topicId);
  if (query?.companyId) params.set("companyId", query.companyId);
  if (query?.difficulty) params.set("difficulty", query.difficulty);
  if (query?.limit) params.set("limit", String(query.limit));
  if (cursor) params.set("cursor", cursor);

  return `/api/v1/mock-tests${params.toString() ? `?${params.toString()}` : ""}`;
}

export function useMockTests(query?: MockTestQuery) {
  const url = buildMockTestsUrl(query);

  return useSWR<{ items: MockTestListItem[]; hasMore: boolean; nextCursor: string | null }>(url, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useCuratedMockTests(query?: MockTestQuery) {
  const params = new URLSearchParams();
  if (query?.topicId) params.set("topicId", query.topicId);
  if (query?.companyId) params.set("companyId", query.companyId);
  if (query?.difficulty) params.set("difficulty", query.difficulty);
  const url = `/api/v1/mock-tests/curated${params.toString() ? `?${params.toString()}` : ""}`;
  return useSWR<CuratedMockTestsPayload>(url, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useInfiniteMockTests(query?: MockTestQuery) {
  const response = useSWRInfinite<{ items: MockTestListItem[]; hasMore: boolean; nextCursor: string | null }>(
    (pageIndex, previousPageData) => {
      if (previousPageData && !previousPageData.hasMore) return null;
      if (pageIndex === 0) return buildMockTestsUrl(query);
      return buildMockTestsUrl(query, previousPageData?.nextCursor ?? null);
    },
    fetcher,
    {
      revalidateOnFocus: false,
      persistSize: false,
    },
  );

  const pages = response.data ?? [];
  const items = pages.flatMap((page) => page.items);
  const lastPage = pages[pages.length - 1];

  return {
    ...response,
    items,
    hasMore: lastPage?.hasMore ?? false,
    nextCursor: lastPage?.nextCursor ?? null,
    isLoadingInitial: !response.data && !response.error,
    isLoadingMore: response.isValidating && pages.length > 0,
  };
}

export function useMockTestMetadata(testId: string | null) {
  return useSWR<MockTestMetadata>(testId ? `/api/v1/mock-tests/${testId}` : null, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useMockTestTopicOptions() {
  return useSWR<MockTestTopicOption[]>("/api/v1/resources/topics?limit=50", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useMockTestCompanyOptions() {
  return useSWR<MockTestCompanyOption[]>("/api/v1/vault", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useMockTestResult(attemptId: string | null) {
  return useSWR<MockTestResultPayload>(
    attemptId ? `/api/v1/mock-tests/attempts/${attemptId}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
    },
  );
}

export async function startMockTest(testId: string): Promise<MockTestStartPayload> {
  const response = await fetch(`/api/v1/mock-tests/${testId}/start`, {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader(undefined),
  });

  const payload = (await response.json()) as ApiResponse<MockTestStartPayload>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}

export async function submitMockTest(
  testId: string,
  input: {
    attemptId: string;
    idempotencyKey: string;
    answers: Array<{ questionIndex: number; selectedOption: number }>;
    integrity?: {
      copyEvents: number;
      pasteEvents: number;
      visibilityChanges: number;
      blurEvents: number;
    };
  },
): Promise<MockTestSubmitPayload> {
  const response = await fetch(`/api/v1/mock-tests/${testId}/submit`, {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<MockTestSubmitPayload>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}

export async function saveMockTestProgress(
  attemptId: string,
  input: {
    answers: Record<string, number>;
    currentQuestion: number;
  },
) {
  const response = await fetch(`/api/v1/mock-tests/attempts/${attemptId}/progress`, {
    method: "PATCH",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<{
    attemptId: string;
    saved: boolean;
    currentQuestion: number;
  }>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}
