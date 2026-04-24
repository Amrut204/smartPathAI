import useSWR, { mutate } from "swr";

import { withCsrfHeader } from "../utils/csrf";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: { code?: string; message: string; details?: Array<{ field?: string; message: string }> };
}

async function parseApiResponse<T>(response: Response): Promise<ApiResponse<T>> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as ApiResponse<T>;
  } catch {
    throw new Error("Feedback API returned an unexpected response. Refresh the page and try again.");
  }
}

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = await parseApiResponse<T>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }
  return payload.data;
}

export type FeedbackCampaignType =
  | "drive_feedback"
  | "faculty_feedback_single"
  | "faculty_feedback_all"
  | "training_activity_feedback"
  | "mock_test_feedback"
  | "general_department_feedback"
  | "custom_feedback";

export type FeedbackCampaignStatus = "draft" | "published" | "closed" | "archived";
export type AcademicYear = "first_year" | "second_year" | "third_year" | "final_year";

export interface FeedbackTemplate {
  key: string;
  subjectMode: "single" | "multi";
  subjectLabel: string;
  questions: Array<{ key: string; label: string }>;
  commentPrompt: string;
}

export interface FeedbackCampaignSummary {
  id: string;
  type: FeedbackCampaignType;
  title: string;
  description: string;
  status: FeedbackCampaignStatus;
  department: string;
  targetBranches: string[];
  targetBatches: string[];
  targetAcademicYears: AcademicYear[];
  facultyTargets: Array<{ id: string; name: string }>;
  driveId: string | null;
  openAt: string | null;
  closeAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  responseCount: number;
  pendingCount: number;
  template: FeedbackTemplate | null;
  submittedAt?: string | null;
}

export interface FeedbackCampaignDetail extends FeedbackCampaignSummary {
  analytics: {
    totalResponses: number;
    questionAverages: Array<{ key: string; label: string; average: number; count: number }>;
    subjectBreakdown: Array<{ subjectLabel: string; average: number; count: number }>;
    comments: Array<{ studentName: string; subjectLabel: string; comment: string; submittedAt: string }>;
  };
}

export interface StudentFeedbackCampaign extends FeedbackCampaignSummary {
  studentContext: {
    fullName: string;
    branch: string;
    batch: string;
    academicYear: AcademicYear | null;
  };
}

export interface FeedbackCampaignResponses {
  items: Array<{
    id: string;
    student: {
      userId: string;
      studentId: string;
      fullName: string;
      email: string;
      branch: string;
      batch: string;
      academicYear: string | null;
      rollNumber: string;
      prn: string;
    };
    responses: Array<{
      subjectId?: string | null;
      subjectLabel: string;
      ratings: Record<string, number>;
      comment?: string;
    }>;
    submittedAt: string;
  }>;
}

export function useHodFeedbackCampaigns(params?: { status?: FeedbackCampaignStatus; type?: FeedbackCampaignType }) {
  const search = new URLSearchParams();
  search.set("limit", "50");
  if (params?.status) search.set("status", params.status);
  if (params?.type) search.set("type", params.type);
  return useSWR<FeedbackCampaignSummary[]>(`/api/v1/hod/feedback/campaigns?${search.toString()}`, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useHodFeedbackCampaignDetail(campaignId: string | null) {
  return useSWR<FeedbackCampaignDetail>(
    campaignId ? `/api/v1/hod/feedback/campaigns/${encodeURIComponent(campaignId)}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );
}

export function useHodFeedbackCampaignResponses(campaignId: string | null) {
  return useSWR<FeedbackCampaignResponses>(
    campaignId ? `/api/v1/hod/feedback/campaigns/${encodeURIComponent(campaignId)}/responses` : null,
    fetcher,
    { revalidateOnFocus: false },
  );
}

export function useStudentFeedbackCampaigns() {
  return useSWR<FeedbackCampaignSummary[]>("/api/v1/feedback/me", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useStudentFeedbackCampaign(campaignId: string | null) {
  return useSWR<StudentFeedbackCampaign>(
    campaignId ? `/api/v1/feedback/me/${encodeURIComponent(campaignId)}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );
}

export async function createFeedbackCampaign(input: {
  type: FeedbackCampaignType;
  title: string;
  description?: string;
  targetBatches: string[];
  targetAcademicYears: AcademicYear[];
  facultyTargets: Array<{ id?: string; name: string }>;
  driveId?: string;
  openAt?: string;
  closeAt?: string;
  customTemplate?: {
    subjectLabel: string;
    commentPrompt?: string;
    questions: Array<{ label: string }>;
  };
}) {
  const response = await fetch("/api/v1/hod/feedback/campaigns", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  const payload = await parseApiResponse<FeedbackCampaignSummary>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Unable to create feedback campaign.");
  }
  await mutate((key) => typeof key === "string" && key.startsWith("/api/v1/hod/feedback/campaigns?"));
  return payload.data;
}

export async function downloadFeedbackCampaignExport(campaignId: string, filenameHint: string) {
  const response = await fetch(`/api/v1/hod/feedback/campaigns/${encodeURIComponent(campaignId)}/export.xlsx`, {
    credentials: "include",
  });
  if (!response.ok) {
    const payload = await parseApiResponse<{ message?: string }>(response);
    throw new Error(payload.error?.message ?? "Unable to download feedback export.");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filenameHint.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "feedback-export"}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function publishFeedbackCampaign(campaignId: string) {
  const response = await fetch(`/api/v1/hod/feedback/campaigns/${encodeURIComponent(campaignId)}/publish`, {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader(undefined),
  });
  const payload = await parseApiResponse<FeedbackCampaignDetail>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Unable to publish feedback campaign.");
  }
  await Promise.all([
    mutate((key) => typeof key === "string" && key.startsWith("/api/v1/hod/feedback/campaigns?")),
    mutate(`/api/v1/hod/feedback/campaigns/${encodeURIComponent(campaignId)}`),
    mutate("/api/v1/feedback/me"),
  ]);
  return payload.data;
}

export async function submitFeedbackCampaign(campaignId: string, input: {
  responses: Array<{
    subjectId?: string;
    subjectLabel: string;
    ratings: Record<string, number>;
    comment?: string;
  }>;
}) {
  const response = await fetch(`/api/v1/feedback/me/${encodeURIComponent(campaignId)}/submit`, {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  const payload = await parseApiResponse<{ submittedAt: string }>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Unable to submit feedback right now.");
  }
  await Promise.all([
    mutate("/api/v1/feedback/me"),
    mutate(`/api/v1/feedback/me/${encodeURIComponent(campaignId)}`),
    mutate((key) => typeof key === "string" && key.startsWith("/api/v1/hod/feedback/campaigns?")),
  ]);
  return payload.data;
}
