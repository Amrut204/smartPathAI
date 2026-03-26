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

export type SalesPipelineStage =
  | "contacted"
  | "demo_scheduled"
  | "demo_completed"
  | "pilot_started"
  | "pilot_completed"
  | "converted"
  | "lost";

export type SalesPipelinePriority = "A" | "B" | "C";

export interface SalesPipelineEntry {
  id: string;
  collegeName: string;
  collegeLocation: string | null;
  studentCount: number | null;
  tpoName: string;
  tpoEmail: string | null;
  tpoPhone: string | null;
  tpoLinkedIn: string | null;
  stage: SalesPipelineStage;
  priority: SalesPipelinePriority;
  contactDate: string | null;
  demoDate: string | null;
  pilotStartDate: string | null;
  conversionDate: string | null;
  expectedRevenue: number | null;
  lostReason: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  notes: string[];
  linkedDemoFeedback: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SalesPipelineAnalytics {
  totalContacts: number;
  byStage: Record<SalesPipelineStage, number>;
  conversionRates: {
    contactToDemo: number;
    demoToPilot: number;
    pilotToConversion: number;
    overallConversion: number;
  };
  expectedRevenue: {
    total: number;
    byStage: Record<SalesPipelineStage, number>;
  };
  avgTimeInStage: Record<SalesPipelineStage, number>;
}

export function useSalesPipelineList(query?: {
  stage?: SalesPipelineStage;
  priority?: SalesPipelinePriority;
  search?: string;
}) {
  const params = new URLSearchParams();
  if (query?.stage) params.set("stage", query.stage);
  if (query?.priority) params.set("priority", query.priority);
  if (query?.search) params.set("search", query.search);
  params.set("limit", "300");

  return useSWR<{ items: SalesPipelineEntry[]; total: number }>(
    `/api/sales/pipeline?${params.toString()}`,
    fetcher,
    { revalidateOnFocus: false },
  );
}

export function useSalesPipelineRecord(id?: string) {
  return useSWR<SalesPipelineEntry>(
    id ? `/api/sales/pipeline/${id}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );
}

export function useSalesPipelineAnalytics() {
  return useSWR<SalesPipelineAnalytics>(
    "/api/sales/pipeline/analytics",
    fetcher,
    { revalidateOnFocus: false },
  );
}

export async function createSalesPipeline(input: {
  collegeName: string;
  collegeLocation?: string | null;
  studentCount?: number | null;
  tpoName: string;
  tpoEmail?: string | null;
  tpoPhone?: string | null;
  tpoLinkedIn?: string | null;
  stage?: SalesPipelineStage;
  priority?: SalesPipelinePriority;
  contactDate?: string | null;
  demoDate?: string | null;
  pilotStartDate?: string | null;
  conversionDate?: string | null;
  expectedRevenue?: number | null;
  lostReason?: string | null;
  nextAction?: string | null;
  nextActionDate?: string | null;
  notes?: string[];
  linkedDemoFeedback?: string | null;
}) {
  const response = await fetch("/api/sales/pipeline", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<SalesPipelineEntry>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Unable to add pipeline entry");
  }

  await Promise.all([
    mutate((key) => typeof key === "string" && key.startsWith("/api/sales/pipeline?")),
    mutate("/api/sales/pipeline/analytics"),
  ]);

  return payload.data;
}

export async function updateSalesPipeline(
  id: string,
  input: Partial<{
    collegeName: string;
    collegeLocation: string | null;
    studentCount: number | null;
    tpoName: string;
    tpoEmail: string | null;
    tpoPhone: string | null;
    tpoLinkedIn: string | null;
    stage: SalesPipelineStage;
    priority: SalesPipelinePriority;
    contactDate: string | null;
    demoDate: string | null;
    pilotStartDate: string | null;
    conversionDate: string | null;
    expectedRevenue: number | null;
    lostReason: string | null;
    nextAction: string | null;
    nextActionDate: string | null;
    notes: string[];
    linkedDemoFeedback: string | null;
    addNote: string;
  }>,
) {
  const response = await fetch(`/api/sales/pipeline/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<SalesPipelineEntry>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Unable to update pipeline entry");
  }

  await Promise.all([
    mutate((key) => typeof key === "string" && key.startsWith("/api/sales/pipeline?")),
    mutate(`/api/sales/pipeline/${id}`),
    mutate("/api/sales/pipeline/analytics"),
  ]);

  return payload.data;
}
