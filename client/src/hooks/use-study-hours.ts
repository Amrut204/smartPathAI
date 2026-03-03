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

export interface StudyHourHistoryRow {
  id: string;
  topicId: string;
  studyDate: string;
  hours: number;
  pointsAwarded: number;
}

export interface StudyHourLogResult {
  studyHourId: string;
  studyDate: string;
  hours: number;
  pointsAwarded: number;
  streak: {
    streakCurrent: number;
    streakLongest: number;
  };
}

export function useStudyHours() {
  return useSWR<StudyHourHistoryRow[]>("/api/v1/students/me/study-hours", fetcher, {
    revalidateOnFocus: false,
  });
}

export async function logStudyHours(input: {
  topicId: string;
  studyDate?: string;
  hours: number;
}): Promise<StudyHourLogResult> {
  const response = await fetch("/api/v1/students/me/study-hours", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<StudyHourLogResult>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await Promise.all([
    mutate("/api/v1/students/me/dashboard"),
    mutate("/api/v1/students/leaderboard"),
  ]);

  return payload.data;
}
