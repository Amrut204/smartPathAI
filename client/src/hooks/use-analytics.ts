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

export function useReadinessAnalytics() {
  return useSWR<{
    batchAverages: Array<{ batch: string; avgReadiness: number; studentCount: number }>;
    trend: Array<{ date: string; avgScore: number; attempts: number }>;
  }>("/api/v1/analytics/readiness", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useTopicAnalytics() {
  return useSWR<{
    summary: Array<{ topicId: string; topicName: string; avgMastery: number; studentsCovered: number }>;
    students: Array<{ studentId: string; studentName: string }>;
    cells: Array<{ studentId: string; topicId: string; topicName: string; masteryLevel: number }>;
  }>("/api/v1/analytics/topics", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useTestAnalytics() {
  return useSWR<{
    totalStudents: number;
    totalAttempts: number;
    tests: Array<{
      testId: string;
      title: string;
      difficulty: string;
      completedStudents: number;
      completionRate: number;
      averageScore: number;
    }>;
  }>("/api/v1/analytics/tests", fetcher, {
    revalidateOnFocus: false,
  });
}

export function usePlacementAnalytics() {
  return useSWR<{
    funnel: Array<{ stage: string; count: number }>;
    outcomes: {
      pending: number;
      shortlisted: number;
      selected: number;
      rejected: number;
    };
  }>("/api/v1/analytics/placement", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useTpoDashboardAnalytics() {
  return useSWR<{
    totalStudents: number;
    activeDrives: number;
    avgReadiness: number;
    readinessTrend: Array<{ date: string; avgScore: number }>;
    upcomingDrives: Array<{
      id: string;
      company: string;
      role: string | null;
      driveDate: string;
      status: string;
      eligibleCount: number;
    }>;
    actionItems: string[];
  }>("/api/v1/analytics/dashboard", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useStudentRankings(limit = 20, windowDays = 30) {
  return useSWR<{
    generatedAt: string;
    windowDays: number;
    parameters: Array<{ key: string; label: string; weight: number }>;
    items: Array<{
      studentId: string;
      fullName: string;
      rollNumber: string;
      branch: string;
      batch: string;
      metrics: {
        readinessScore: number;
        mockPerformanceScore: number;
        studyConsistencyScore: number;
        avgMockScore: number;
        mockAttempts: number;
        studyHoursWindow: number;
        activeStudyDaysWindow: number;
        studyHours30d: number;
        activeStudyDays30d: number;
        overallScore: number;
      };
      ranks: {
        overall: number;
        readiness: number;
        mockPerformance: number;
        studyConsistency: number;
      };
    }>;
  }>(`/api/v1/analytics/student-rankings?limit=${limit}&windowDays=${windowDays}`, fetcher, {
    revalidateOnFocus: false,
  });
}
