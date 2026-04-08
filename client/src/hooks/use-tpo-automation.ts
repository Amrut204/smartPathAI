import useSWR, { mutate } from "swr";

import { withCsrfHeader } from "../utils/csrf";
import type { ReportFilters, ReportType } from "./use-reports";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error: { code: string; message: string; details?: Array<{ field?: string; message: string }> };
}

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }
  return payload.data;
}

export type TpoAutomationType =
  | "eligible_not_applied"
  | "blocked_profile_followup"
  | "weekly_tpo_digest"
  | "scheduled_report_pack"
  | "unplaced_intervention_refresh"
  | "result_notification_review";

export type TpoAutomationRunStatus =
  | "draft"
  | "ready"
  | "sent"
  | "completed"
  | "failed"
  | "dismissed";

export type TpoAutomationTriggerSource =
  | "scheduled"
  | "manual"
  | "result_release"
  | "drive_update";

export interface TpoAutomationRunItem {
  id: string;
  runId: string;
  automationType: TpoAutomationType;
  entityType: string;
  entityId: string;
  reasonKey: string;
  reasonLabel: string;
  status: "pending" | "sent" | "dismissed" | "completed";
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TpoAutomationRun {
  id: string;
  automationType: TpoAutomationType;
  triggerSource: TpoAutomationTriggerSource;
  status: TpoAutomationRunStatus;
  scope: Record<string, unknown>;
  dateBucket: string;
  idempotencyKey: string;
  explanation: string;
  counts: Record<string, number>;
  filters: Record<string, unknown>;
  audienceSummary: string | null;
  preview: Record<string, unknown>;
  linkedCommunicationId: string | null;
  linkedReportPackId: string | null;
  releasedAt: string | null;
  releasedBy: string | null;
  dismissedAt: string | null;
  dismissedBy: string | null;
  completedAt: string | null;
  failedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TpoAutomationRunDetail extends TpoAutomationRun {
  items: TpoAutomationRunItem[];
}

export interface ScheduledReportPackSummary extends TpoAutomationRun {
  items: TpoAutomationRunItem[];
}

export function useTpoAutomationSummary() {
  return useSWR<{
    pendingDrafts: number;
    dueToday: number;
    counts: {
      eligibleNotApplied: number;
      blockedProfiles: number;
      unplacedIntervention: number;
    };
    lastWeeklyDigestAt: string | null;
    lastReportPackAt: string | null;
    items: Array<{
      id: string;
      automationType: TpoAutomationType;
      status: TpoAutomationRunStatus;
      explanation: string;
      counts: Record<string, number>;
      targetPath: string;
    }>;
  }>("/api/v1/tpo/automation/summary", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useTpoAutomationRuns(query?: {
  status?: TpoAutomationRunStatus;
  automationType?: TpoAutomationType;
  triggerSource?: TpoAutomationTriggerSource;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (query?.status) params.set("status", query.status);
  if (query?.automationType) params.set("automationType", query.automationType);
  if (query?.triggerSource) params.set("triggerSource", query.triggerSource);
  if (query?.limit) params.set("limit", String(query.limit));
  const href = `/api/v1/tpo/automation/runs${params.toString() ? `?${params.toString()}` : ""}`;
  return useSWR<TpoAutomationRun[]>(href, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useScheduledReportPacks() {
  return useSWR<ScheduledReportPackSummary[]>("/api/v1/tpo/reports/scheduled", fetcher, {
    revalidateOnFocus: false,
  });
}

async function postJson<T>(url: string, body?: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(body ?? {}),
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }
  await Promise.all([
    mutate("/api/v1/tpo/automation/summary"),
    mutate((key: string) => typeof key === "string" && key.startsWith("/api/v1/tpo/automation/runs")),
    mutate("/api/v1/tpo/reports/scheduled"),
    mutate("/api/v1/communication/history?limit=50"),
  ]);
  return payload.data;
}

export function releaseAutomationRun(runId: string) {
  return postJson<TpoAutomationRunDetail>(`/api/v1/tpo/automation/runs/${encodeURIComponent(runId)}/release`);
}

export function dismissAutomationRun(runId: string) {
  return postJson<TpoAutomationRunDetail>(`/api/v1/tpo/automation/runs/${encodeURIComponent(runId)}/dismiss`);
}

export function runAutomationNow(input: {
  automationType: TpoAutomationType;
  frequency?: "weekly" | "monthly";
}) {
  return postJson<TpoAutomationRunDetail[]>("/api/v1/tpo/automation/run-now", input);
}

export function regenerateScheduledReportRun(runId: string) {
  return postJson<TpoAutomationRunDetail>(`/api/v1/tpo/reports/scheduled/${encodeURIComponent(runId)}/regenerate`);
}

export function extractReportPayload(item: TpoAutomationRunItem) {
  const payload = item.payload as {
    reportType?: ReportType;
    filters?: ReportFilters;
    title?: string;
    ready?: boolean;
    blockers?: string[];
    rowCount?: number;
    generatedAt?: string;
  };
  return {
    reportType: payload.reportType ?? "final_placement_statistics",
    filters: payload.filters ?? { preset: "placement_season", academicYear: "2025-2026" },
    title: payload.title ?? "Scheduled report",
    ready: payload.ready ?? false,
    blockers: payload.blockers ?? [],
    rowCount: payload.rowCount ?? 0,
    generatedAt: payload.generatedAt ?? null,
  };
}
