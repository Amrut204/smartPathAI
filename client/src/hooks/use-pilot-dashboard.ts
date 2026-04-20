import useSWR from "swr";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = (await response.json()) as ApiResponse<T>;

  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }

  return payload.data;
}

export interface PilotStudentDashboard {
  studentName: string;
  branch: string;
  batch: string;
  cgpa: number;
  readinessScore: number;
  profileCompletenessPct: number;
  canAccessResources: boolean;
  canAccessMockTests: boolean;
  missingStudentFields: Array<{ key: string; label: string; owner: "student"; complete: boolean }>;
  missingSeededFields: Array<{ key: string; label: string; owner: "seeded"; complete: boolean }>;
  totalStudents: number;
  studyHours7d: number;
  mockTestsTaken7d: number;
  eligibleUpcomingDrives: number;
  checklist: Array<{ id: string; label: string; done: boolean }>;
  upcomingDrives: Array<{
    id: string;
    company: string;
    role: string;
    driveDate: string;
    status: string;
    eligibleCount: number;
    myStatus: string;
    myOutcome: string;
  }>;
  recentResources: Array<{
    resourceId: string;
    title: string;
    viewedAt: string;
  }>;
}

export interface PilotStudentDrive {
  id: string;
  company: string;
  role: string;
  driveDate: string;
  status: string;
  lifecycle?: string;
  eligibleCount: number;
  isEligible: boolean;
  reasons: Array<{ code: string; label: string }>;
  eligibility?: {
    finalVerdict: "eligible" | "not_eligible";
    blockingReasons: Array<{ code: string; label: string }>;
    advisoryNotes: string[];
  };
  criteria: {
    minCgpa: number;
    maxBacklogs: number;
    maxActiveBacklogs?: number;
    maxTotalBacklogs?: number;
    branches: string[];
    academicYears?: Array<"first_year" | "second_year" | "third_year" | "final_year">;
    minAttendance: number;
    excludePlacedStudents?: boolean;
  };
  myStatus: string;
  applicationState?: "not_applied" | "applied" | "withdrawn" | "absent";
  canWithdraw?: boolean;
  canApplyNow?: boolean;
  readinessSupport?: {
    profileCertified: boolean;
    hasResume: boolean;
  };
  actionHint?: {
    label: string;
    explanation: string;
    targetPath: string;
    ctaLabel: string;
  };
  prepBundle?: {
    summary: string;
    mockTests: Array<{
      id: string;
      title: string;
      difficulty: string;
      durationSec: number;
    }>;
    resources: Array<{
      id: string;
      title: string;
      resourceType: string;
    }>;
  } | null;
  myOutcome: string;
  remarks: string | null;
  timeline?: {
    registrationStatus: string;
    applicationState: string;
    profileCertified: boolean;
  };
}

export interface PilotTpoDashboard {
  summary: {
    totalStudents: number;
    upcomingDrives: number;
    eligibleStudents: number;
    mockTestsTakenThisWeek: number;
  };
  readiness: {
    high: number;
    medium: number;
    low: number;
  };
  upcomingDrives: Array<{
    driveId: string;
    company: string;
    role: string | null;
    driveDate: string;
    eligibleStudents: number;
    driveRiskScore: number;
  }>;
  studentsNeedingAttention: Array<{
    studentId: string;
    fullName: string;
    branch: string;
    batch: string;
    cgpa: number;
    profileCompletenessPct: number;
    mockAttempts: number;
    isActive7d: boolean;
    nextRecommendedAction: string;
  }>;
}

export function usePilotStudentDashboard() {
  return useSWR<PilotStudentDashboard>("/api/v1/students/me/pilot-dashboard", fetcher, {
    revalidateOnFocus: false,
  });
}

export function usePilotStudentDrives() {
  return useSWR<PilotStudentDrive[]>("/api/v1/students/me/drives", fetcher, {
    revalidateOnFocus: false,
  });
}

export function usePilotTpoDashboard() {
  return useSWR<PilotTpoDashboard>("/api/v1/tpo/dashboard/mvp", fetcher, {
    revalidateOnFocus: false,
  });
}
