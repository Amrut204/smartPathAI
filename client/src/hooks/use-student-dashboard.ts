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

export interface StudentDashboard {
  branch: string;
  studyHoursToday: number;
  studyHoursWeek: number;
  studentRank: number;
  totalStudents: number;
  totalPoints: number;
  readinessScore: number;
  streakCurrent: number;
  streakLongest: number;
  weakAreas: Array<{ topicId: string; topicName: string; masteryLevel: number }>;
  studiedTopics: Array<{
    topicId: string;
    topicName: string;
    totalHours: number;
    sessions: number;
    lastStudied: string;
  }>;
  branchTrack: {
    label: string;
    summary: string;
    focusAreas: Array<{ topicId: string | null; topicName: string; reason: string }>;
    recommendedActions: string[];
    starterPrompts: string[];
  };
  studyTopicOptions: Array<{ topicId: string; topicName: string; reason: string }>;
  recommendedTest: { id: string; title: string; difficulty: string; durationSec: number } | null;
  upcomingDrives: Array<{
    id: string;
    company: string;
    role: string;
    driveDate: string;
    status: string;
  }>;
  resourceUsage: {
    resourcesOpened7d: number;
    readingMinutes7d: number;
    activeDays7d: number;
    lastViewedAt: string | null;
    lastViewedTitle: string | null;
    recentResources: Array<{
      resourceId: string;
      title: string;
      viewedAt: string;
      resourceType: string;
      progressPct: number | null;
    }>;
  };
}

export function useStudentDashboard() {
  return useSWR<StudentDashboard>("/api/v1/students/me/dashboard", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 20_000,
  });
}
