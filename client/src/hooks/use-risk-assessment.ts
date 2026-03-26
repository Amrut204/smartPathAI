import useSWR, { mutate } from "swr";
import { withCsrfHeader } from "../utils/csrf";

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

export interface RiskStudentRow {
  studentId: string;
  fullName: string;
  branch: string;
  batch: string;
  cgpa: number;
  riskScore: number;
  category: "HIGH_RISK" | "MEDIUM_RISK" | "LOW_RISK";
  riskFactors: string[];
  recommendedActions: string[];
  lastActive: string | null;
  eligibleDrives: number;
  appliedDrives: number;
  mockTestsAttempted: number;
  avgMockScore: number;
  profileCompletenessPct: number;
}

export interface RiskAssessmentSnapshot {
  summary: {
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
    totalStudents: number;
  };
  highRiskStudents: RiskStudentRow[];
  mediumRiskStudents: RiskStudentRow[];
  trends: {
    weeklyChange: {
      highRisk: number;
      mediumRisk: number;
      lowRisk: number;
    };
  };
}

export interface StudentRiskScore {
  score: number;
  category: "HIGH_RISK" | "MEDIUM_RISK" | "LOW_RISK";
  message: string;
  recommendations: string[];
  comparisonToPeers: {
    yourMockTests: number;
    avgInYourBranch: number;
    yourScore: number;
    avgScoreInYourBranch: number;
  };
}

export function useTpoRiskAssessment() {
  return useSWR<RiskAssessmentSnapshot>("/api/v1/tpo/risk-assessment", fetcher, {
    revalidateOnFocus: false,
  });
}

export async function refreshTpoRiskAssessment() {
  const response = await fetch("/api/v1/tpo/risk-assessment/refresh", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify({}),
  });

  const payload = (await response.json()) as ApiResponse<{ summary: { totalStudents: number } }>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Unable to refresh risk assessment");
  }

  await mutate("/api/v1/tpo/risk-assessment");
  return payload.data;
}

export function useStudentRiskScore() {
  return useSWR<StudentRiskScore>("/api/v1/students/my-risk-score", fetcher, {
    revalidateOnFocus: false,
  });
}

export async function logRiskIntervention(input: {
  studentId: string;
  action: string;
  notes?: string;
}) {
  const response = await fetch("/api/v1/tpo/interventions", {
    method: "POST",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<{ id: string }>;

  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Unable to log intervention");
  }

  return payload.data;
}
