import useSWR from "swr";

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
  durationSec: number;
  difficulty: string;
  attemptCount: number;
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

export interface MockTestStartPayload {
  attemptId: string;
  startedAt: string;
  serverTime: string;
  durationSec: number;
  questions: Array<{ text: string; options: string[] }>;
}

export interface MockTestSubmitPayload {
  attemptId: string;
  score: number;
  timeTakenSec: number;
  topicBreakdown: Record<string, unknown>;
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
  submittedAt: string | null;
  answers: Array<{ questionIndex: number; selectedOption: number; isCorrect: boolean }>;
  questions: Array<{
    text: string;
    options: string[];
    correctIndex: number;
    explanation: string;
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

export function useMockTests(query?: {
  topicId?: string;
  companyId?: string;
  difficulty?: string;
}) {
  const params = new URLSearchParams();
  if (query?.topicId) params.set("topicId", query.topicId);
  if (query?.companyId) params.set("companyId", query.companyId);
  if (query?.difficulty) params.set("difficulty", query.difficulty);

  const url = `/api/v1/mock-tests${params.toString() ? `?${params.toString()}` : ""}`;

  return useSWR<{ items: MockTestListItem[]; hasMore: boolean; nextCursor: string | null }>(url, fetcher, {
    revalidateOnFocus: false,
  });
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
  },
): Promise<MockTestSubmitPayload> {
  const response = await fetch(`/api/v1/mock-tests/${testId}/submit`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<MockTestSubmitPayload>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}
