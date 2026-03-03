import useSWR, { mutate } from "swr";

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

export interface TopicMasteryItem {
  topicId: string;
  topicName: string;
  masteryLevel: number;
  totalAttempts: number;
  correctAttempts: number;
  confidenceScore: number;
}

export type TopicProgressStatus = "incomplete" | "in_progress" | "complete";

export interface TopicProgressItem {
  topicId: string;
  topicName: string;
  status: TopicProgressStatus;
  covered: boolean;
  updatedAt: string | null;
  completedAt: string | null;
}

export interface TopicProgressSummary {
  totalTopics: number;
  completeCount: number;
  inProgressCount: number;
  incompleteCount: number;
  coveredCount: number;
  completionPct: number;
}

export interface TopicProgressPayload {
  items: TopicProgressItem[];
  summary: TopicProgressSummary;
}

export function useMastery() {
  return useSWR<TopicMasteryItem[]>("/api/v1/students/me/mastery", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useTopicProgress() {
  return useSWR<TopicProgressPayload>("/api/v1/students/me/topic-progress", fetcher, {
    revalidateOnFocus: false,
  });
}

export async function updateTopicProgress(input: {
  topicId: string;
  status: TopicProgressStatus;
}): Promise<TopicProgressItem> {
  const response = await fetch("/api/v1/students/me/topic-progress", {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<TopicProgressItem>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await mutate("/api/v1/students/me/topic-progress");
  return payload.data;
}

export async function updateTopicProgressBulk(input: {
  topicIds: string[];
  status: TopicProgressStatus;
}): Promise<{ updatedCount: number; invalidTopicIds: string[]; status: TopicProgressStatus; updatedAt: string }> {
  const response = await fetch("/api/v1/students/me/topic-progress/bulk", {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<{
    updatedCount: number;
    invalidTopicIds: string[];
    status: TopicProgressStatus;
    updatedAt: string;
  }>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await mutate("/api/v1/students/me/topic-progress");
  return payload.data;
}
