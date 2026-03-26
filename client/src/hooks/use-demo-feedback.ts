import useSWR, { mutate } from "swr";
import { withCsrfHeader } from "../utils/csrf";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: { message: string };
}

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }
  return payload.data;
}

export type DemoFeedbackStatus =
  | "demo_completed"
  | "follow_up_scheduled"
  | "pilot_started"
  | "converted"
  | "lost";

export interface DemoFeedbackEntry {
  id: string;
  collegeName: string;
  tpoName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  demoDate: string;
  demoRating: number | null;
  productFit: number | null;
  conversionLikelihood: number | null;
  painPoints: string[];
  featureRequests: string[];
  concerns: string[];
  competitorMentions: string[];
  nextSteps: string | null;
  followUpDate: string | null;
  status: DemoFeedbackStatus;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DemoAnalyticsPayload {
  totalDemos: number;
  avgDemoRating: number;
  avgProductFit: number;
  avgConversionLikelihood: number;
  statusBreakdown: Record<DemoFeedbackStatus, number>;
  commonPainPoints: Array<{ painPoint: string; count: number }>;
  topFeatureRequests: Array<{ feature: string; count: number }>;
  conversionFunnel: {
    demos: number;
    followUps: number;
    pilots: number;
    conversions: number;
    conversionRate: number;
  };
}

export function useDemoFeedbackList(query?: {
  status?: DemoFeedbackStatus;
  search?: string;
}) {
  const params = new URLSearchParams();
  if (query?.status) params.set("status", query.status);
  if (query?.search) params.set("search", query.search);
  params.set("limit", "100");

  return useSWR<{ items: DemoFeedbackEntry[]; total: number }>(
    `/api/internal/demo-feedback?${params.toString()}`,
    fetcher,
    { revalidateOnFocus: false },
  );
}

export function useDemoAnalytics() {
  return useSWR<DemoAnalyticsPayload>("/api/internal/demo-analytics", fetcher, {
    revalidateOnFocus: false,
  });
}

export async function createDemoFeedback(input: {
  collegeName: string;
  tpoName: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  demoDate?: string | null;
  demoRating?: number | null;
  productFit?: number | null;
  conversionLikelihood?: number | null;
  painPoints: string[];
  featureRequests: string[];
  concerns: string[];
  competitorMentions: string[];
  nextSteps?: string | null;
  followUpDate?: string | null;
  status: DemoFeedbackStatus;
  notes?: string | null;
}) {
  const response = await fetch("/api/internal/demo-feedback", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<DemoFeedbackEntry>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Unable to create demo feedback");
  }

  await Promise.all([
    mutate((key) => typeof key === "string" && key.startsWith("/api/internal/demo-feedback")),
    mutate("/api/internal/demo-analytics"),
  ]);

  return payload.data;
}
