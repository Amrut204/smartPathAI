import useSWR, { mutate } from "swr";

import { withCsrfHeader } from "../utils/csrf";

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

export type ReportType =
  | "drive_completion_summary"
  | "weekly_placement_status"
  | "monthly_branch_breakdown"
  | "company_visit_register"
  | "final_placement_statistics"
  | "naac_5_2_progression"
  | "branch_wise_placement_analysis"
  | "placement_brochure_pack"
  | "unplaced_student_action_report"
  | "employer_data_register"
  | "tp_annual_report_workbook";

export interface ReportFilters {
  preset?: "this_week" | "this_month" | "placement_season" | "academic_year" | "custom";
  academicYear?: string;
  dateFrom?: string;
  dateTo?: string;
  branch?: string;
  placementSource?: "on_campus" | "off_campus" | "self_reported";
  verificationStatus?: "pending" | "verified" | "rejected";
  campusMode?: "on_campus" | "off_campus";
  driveStatus?: "upcoming" | "active" | "completed" | "cancelled";
  company?: string;
  sector?: string;
  driveId?: string;
  includeOffCampus?: boolean;
}

export interface ReportTemplate {
  type: ReportType;
  title: string;
  audience: string;
  group: string;
  description: string;
  exportFormats: string[];
}

export interface ReportPreview {
  type: ReportType;
  title: string;
  audience: string;
  group: string;
  reportingPeriod: string;
  generatedAt: string;
  ready: boolean;
  blockers: string[];
  missingData: Array<{ key: string; label: string; count: number }>;
  summaryMetrics: Array<{ label: string; value: string | number | boolean | null }>;
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
  filtersUsed: Record<string, string | number | boolean | null>;
}

export type AnnualRegisterType =
  | "training_activities"
  | "industrial_inplant_training"
  | "higher_education_abroad"
  | "industrial_visit";

export interface AnnualReportRegisterEntry {
  id: string;
  registerType: AnnualRegisterType;
  academicYear: string;
  branch: string | null;
  payload: Record<string, string | number>;
  createdAt: string;
  updatedAt: string;
}

function buildQuery(filters?: ReportFilters) {
  const params = new URLSearchParams();
  if (!filters) return params.toString();
  if (filters.preset) params.set("preset", filters.preset);
  if (filters.academicYear) params.set("academicYear", filters.academicYear);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.branch) params.set("branch", filters.branch);
  if (filters.placementSource) params.set("placementSource", filters.placementSource);
  if (filters.verificationStatus) params.set("verificationStatus", filters.verificationStatus);
  if (filters.campusMode) params.set("campusMode", filters.campusMode);
  if (filters.driveStatus) params.set("driveStatus", filters.driveStatus);
  if (filters.company) params.set("company", filters.company);
  if (filters.sector) params.set("sector", filters.sector);
  if (filters.driveId) params.set("driveId", filters.driveId);
  if (filters.includeOffCampus !== undefined) params.set("includeOffCampus", String(filters.includeOffCampus));
  return params.toString();
}

export function useReportTemplates() {
  return useSWR<ReportTemplate[]>("/api/v1/reports/templates", fetcher, { revalidateOnFocus: false });
}

export function useReportPreview(type: ReportType | null, filters?: ReportFilters) {
  const query = buildQuery(filters);
  return useSWR<ReportPreview>(type ? `/api/v1/reports/${type}/preview${query ? `?${query}` : ""}` : null, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useAnnualReportRegisterEntries(query: {
  academicYear?: string;
  branch?: string;
  registerType?: AnnualRegisterType;
}) {
  const params = new URLSearchParams();
  if (query.academicYear) params.set("academicYear", query.academicYear);
  if (query.branch) params.set("branch", query.branch);
  if (query.registerType) params.set("registerType", query.registerType);
  const href = `/api/v1/reports/annual-registers${params.toString() ? `?${params.toString()}` : ""}`;
  return useSWR<AnnualReportRegisterEntry[]>(href, fetcher, { revalidateOnFocus: false });
}

async function sendAnnualRegisterMutation<T>(url: string, init: RequestInit) {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      ...withCsrfHeader({ "Content-Type": "application/json" }),
      ...(init.headers ?? {}),
    },
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }
  await Promise.all([
    mutate((key) => typeof key === "string" && key.startsWith("/api/v1/reports/annual-registers")),
    mutate((key) => typeof key === "string" && key.startsWith("/api/v1/reports/tp_annual_report_workbook/preview")),
  ]);
  return payload.data;
}

export function createAnnualReportRegisterEntry(body: Record<string, unknown>) {
  return sendAnnualRegisterMutation<AnnualReportRegisterEntry>("/api/v1/reports/annual-registers", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateAnnualReportRegisterEntry(entryId: string, body: Record<string, unknown>) {
  return sendAnnualRegisterMutation<AnnualReportRegisterEntry>(`/api/v1/reports/annual-registers/${encodeURIComponent(entryId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteAnnualReportRegisterEntry(entryId: string) {
  return sendAnnualRegisterMutation<{ id: string; deleted: boolean }>(`/api/v1/reports/annual-registers/${encodeURIComponent(entryId)}`, {
    method: "DELETE",
  });
}

export function downloadReport(type: ReportType, filters: ReportFilters, format: "xlsx" | "pdf" | "csv") {
  const query = buildQuery(filters);
  const href = `/api/v1/reports/${type}/export?${query ? `${query}&` : ""}format=${format}`;
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.click();
}
