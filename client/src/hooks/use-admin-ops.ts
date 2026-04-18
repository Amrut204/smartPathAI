import useSWR, { mutate } from "swr";

import { withCsrfHeader } from "../utils/csrf";
import { parseApiResponse, requestJson } from "../utils/api";

async function fetcher<T>(url: string): Promise<T> {
  return requestJson<T>(url, { credentials: "include" }, "Admin API");
}

async function sendJson<T>(url: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  return requestJson<T>(url, {
    method,
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  }, "Admin API");
}

export type AdminTenantSummary = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  subscriptionTier: string | null;
};

export type AdminWorkspace = {
  tenant: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    config: Record<string, unknown>;
  };
  stats: {
    students: number;
    tpos: number;
    tests: number;
    resources: number;
    communications: number;
  };
  referenceData: {
    topics: Array<{ id: string; name: string }>;
    companies: Array<{ id: string; name: string }>;
    branches: string[];
    batches: string[];
    loginUrl: string;
  };
};

export type AdminStudentRow = {
  id: string;
  userId: string;
  createdAt: string;
  fullName: string;
  email: string;
  prn: string;
  rollNumber: string;
  branch: string;
  batch: string;
  cgpa: number;
  backlogs: number;
  totalHistoricalBacklogs: number;
  attendancePct: number;
  readinessScore: number;
  profileCompletenessPct: number;
  missingRequiredCount: number;
  waitingOnStudent: boolean;
  waitingOnCollege: boolean;
  isProfileCertified?: boolean;
  isProfileLocked?: boolean;
  pendingCredentialJobId?: string | null;
};

export type AdminTpoRow = {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  tenantId: string;
  createdAt: string;
  lastPasswordIssuedAt: string | null;
};

export type AdminStudentsPayload = {
  items: AdminStudentRow[];
  hasMore: boolean;
  nextCursor: string | null;
};

export type StudentImportPreview = {
  headers: string[];
  rows: Array<Record<string, string>>;
  mapping: Record<string, string> | null;
  errors: Array<{ row: number; message: string }>;
  tenantId?: string;
};

export type AdminImportJob = {
  type: "student_import";
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  totals: {
    totalRows: number;
    processedRows: number;
    created: number;
    updated: number;
    skipped: number;
    errorCount: number;
  };
  createdStudentIds?: string[];
  updatedStudentIds?: string[];
  errors: Array<{ row: number; message: string }>;
  errorCsvAvailable: boolean;
  errorMessage: string | null;
};

export type AdminOpsJob = {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  progress?: {
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
  };
  result?: Record<string, unknown> | null;
  errors?: Array<{ itemId?: string; message: string }>;
  errorMessage?: string | null;
  retryOf?: string | null;
};

export type AdminJobRow = AdminImportJob | AdminOpsJob;

export type AdminMockTestRow = {
  id: string;
  title: string;
  topicId: string | null;
  topicName: string | null;
  companyId: string | null;
  companyName: string | null;
  durationSec: number;
  difficulty: "easy" | "medium" | "hard";
  isActive: boolean;
  source: "tenant" | "global";
  tenantId: string | null;
  audienceMode: "all" | "filtered";
  audienceBranches: string[];
  audienceBatches: string[];
  audienceYears: string[];
  audienceSummary: string;
};

export type AdminMockQuestion = {
  text: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
  skillTag?: string;
};

export type AdminMockQuestionImportPreview = {
  tenantId?: string;
  headers: string[];
  rows: Array<Record<string, string>>;
  totalRows: number;
  validRows: number;
  rejectedRows: number;
  errors: Array<{ row: number; message: string }>;
  questions: AdminMockQuestion[];
};

export type AdminResourceRow = {
  id: string;
  title: string;
  description: string;
  url: string;
  resourceType: string;
  thumbnailUrl: string | null;
  durationSec: number;
  topicId: string | null;
  topicName: string | null;
  isActive: boolean;
  sourcePdf: string | null;
  branchRelevance: string[];
  careerTracks: string[];
  recommendedFor: string[];
  contentPackLabels: string[];
};

export type AdminIntegrations = {
  googleForm: string | null;
  googleSheet: string | null;
  googleDriveSharedDriveId: string | null;
  googleDriveRootFolderId: string | null;
  googleDriveServiceAccountEmail: string | null;
  label: string | null;
  notes: string | null;
};

export type AdminEmailSettings = {
  fromName: string | null;
  fromEmail: string | null;
  replyToEmail: string | null;
};

export type AdminPlacementPolicy = {
  excludePlacedStudentsByDefault: boolean;
};

export function useAdminTenants() {
  return useSWR<AdminTenantSummary[]>("/api/v1/internal/admin-ops/tenants", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useAdminWorkspace(tenantId: string | null) {
  const key = tenantId ? `/api/v1/internal/admin-ops/workspace?tenantId=${encodeURIComponent(tenantId)}` : null;
  return useSWR<AdminWorkspace>(key, fetcher, { revalidateOnFocus: false });
}

export function useAdminStudents(tenantId: string | null, query?: { q?: string; branch?: string; batch?: string }) {
  const params = new URLSearchParams();
  if (tenantId) params.set("tenantId", tenantId);
  params.set("limit", "100");
  if (query?.q) params.set("q", query.q);
  if (query?.branch) params.set("branch", query.branch);
  if (query?.batch) params.set("batch", query.batch);
  const key = tenantId ? `/api/v1/internal/admin-ops/students?${params.toString()}` : null;
  return useSWR<AdminStudentsPayload>(key, fetcher, { revalidateOnFocus: false });
}

export function useAdminTpos(tenantId: string | null) {
  const key = tenantId ? `/api/v1/internal/admin-ops/tpo-accounts?tenantId=${encodeURIComponent(tenantId)}` : null;
  return useSWR<AdminTpoRow[]>(key, fetcher, { revalidateOnFocus: false });
}

export function useAdminMockTests(tenantId: string | null) {
  const key = tenantId ? `/api/v1/internal/admin-ops/mock-tests?tenantId=${encodeURIComponent(tenantId)}` : null;
  return useSWR<AdminMockTestRow[]>(key, fetcher, { revalidateOnFocus: false });
}

export function useAdminMockTestQuestions(tenantId: string | null, testId: string | null) {
  const key = tenantId && testId
    ? `/api/v1/internal/admin-ops/mock-tests/${encodeURIComponent(testId)}/questions?tenantId=${encodeURIComponent(tenantId)}`
    : null;
  return useSWR<AdminMockQuestion[]>(key, fetcher, { revalidateOnFocus: false });
}

export function useAdminResources(tenantId: string | null) {
  const key = tenantId ? `/api/v1/internal/admin-ops/resources?tenantId=${encodeURIComponent(tenantId)}` : null;
  return useSWR<AdminResourceRow[]>(key, fetcher, { revalidateOnFocus: false });
}

export function useAdminJobs(tenantId: string | null) {
  const key = tenantId ? `/api/v1/internal/admin-ops/jobs?tenantId=${encodeURIComponent(tenantId)}` : null;
  return useSWR<AdminJobRow[]>(key, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: tenantId ? 5000 : 0,
  });
}

export function useAdminIntegrations(tenantId: string | null) {
  const key = tenantId ? `/api/v1/internal/admin-ops/integrations?tenantId=${encodeURIComponent(tenantId)}` : null;
  return useSWR<AdminIntegrations>(key, fetcher, { revalidateOnFocus: false });
}

export function useAdminEmailSettings(tenantId: string | null) {
  const key = tenantId ? `/api/v1/internal/admin-ops/email-settings?tenantId=${encodeURIComponent(tenantId)}` : null;
  return useSWR<AdminEmailSettings>(key, fetcher, { revalidateOnFocus: false });
}

export function useAdminPlacementPolicy(tenantId: string | null) {
  const key = tenantId ? `/api/v1/internal/admin-ops/placement-policy?tenantId=${encodeURIComponent(tenantId)}` : null;
  return useSWR<AdminPlacementPolicy>(key, fetcher, { revalidateOnFocus: false });
}

export async function adminPreviewStudentCsv(input: { tenantId: string; csv: string }) {
  return sendJson<StudentImportPreview>("/api/v1/internal/admin-ops/students/import/preview", "POST", input);
}

export async function adminPreviewStudentFile(input: { tenantId: string; file: File }) {
  const form = new FormData();
  form.append("tenantId", input.tenantId);
  form.append("file", input.file);
  const response = await fetch("/api/v1/internal/admin-ops/students/import/file-preview", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader(undefined),
    body: form,
  });
  return parseApiResponse<StudentImportPreview>(response, "Admin API");
}

export async function adminCreateStudentImportJob(input: {
  tenantId: string;
  mapping: StudentImportPreview["mapping"];
  rows: Array<Record<string, string>>;
}) {
  return sendJson<AdminImportJob>("/api/v1/internal/admin-ops/students/import/jobs", "POST", {
    tenantId: input.tenantId,
    mapping: input.mapping,
    rows: input.rows,
  });
}

export async function adminFetchImportJob(input: { tenantId: string; jobId: string }) {
  return fetcher<AdminImportJob>(`/api/v1/internal/admin-ops/students/import/jobs/${encodeURIComponent(input.jobId)}?tenantId=${encodeURIComponent(input.tenantId)}`);
}

export async function adminDownloadImportErrorReport(input: { tenantId: string; jobId: string }) {
  const response = await fetch(`/api/v1/internal/admin-ops/students/import/jobs/${encodeURIComponent(input.jobId)}/error-report.csv?tenantId=${encodeURIComponent(input.tenantId)}`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Unable to download import error report");
  }
  return response.text();
}

export async function adminQueueImportCredentials(input: { tenantId: string; importJobId: string }) {
  const data = await sendJson<AdminOpsJob>(`/api/v1/internal/admin-ops/students/import/jobs/${encodeURIComponent(input.importJobId)}/credentials`, "POST", {
    tenantId: input.tenantId,
  });
  await mutate(`/api/v1/internal/admin-ops/jobs?tenantId=${encodeURIComponent(input.tenantId)}`);
  return data;
}

export async function adminCreateStudent(input: {
  tenantId: string;
  fullName: string;
  email: string;
  prn: string;
  rollNumber?: string;
  branch: string;
  batch: string;
  degree?: string;
  currentSemester?: string;
  cgpa?: number;
  backlogs?: number;
  totalHistoricalBacklogs?: number;
  attendancePct?: number;
}) {
  const data = await sendJson<{ student: AdminStudentRow; credentialJob: AdminOpsJob }>("/api/v1/internal/admin-ops/students", "POST", input);
  await Promise.all([
    mutate((key) => typeof key === "string" && key.startsWith(`/api/v1/internal/admin-ops/students?tenantId=${encodeURIComponent(input.tenantId)}`)),
    mutate(`/api/v1/internal/admin-ops/jobs?tenantId=${encodeURIComponent(input.tenantId)}`),
    mutate(`/api/v1/internal/admin-ops/workspace?tenantId=${encodeURIComponent(input.tenantId)}`),
  ]);
  return data;
}

export async function adminCreateTpo(input: {
  tenantId: string;
  fullName: string;
  email: string;
}) {
  const data = await sendJson<{ tpo: AdminTpoRow; credentialJob: AdminOpsJob }>("/api/v1/internal/admin-ops/tpo-accounts", "POST", input);
  await Promise.all([
    mutate(`/api/v1/internal/admin-ops/tpo-accounts?tenantId=${encodeURIComponent(input.tenantId)}`),
    mutate(`/api/v1/internal/admin-ops/jobs?tenantId=${encodeURIComponent(input.tenantId)}`),
    mutate(`/api/v1/internal/admin-ops/workspace?tenantId=${encodeURIComponent(input.tenantId)}`),
  ]);
  return data;
}

export async function adminUpdateTpo(input: {
  tenantId: string;
  userId: string;
  fullName?: string;
  isActive?: boolean;
}) {
  const data = await sendJson<AdminTpoRow>(`/api/v1/internal/admin-ops/tpo-accounts/${encodeURIComponent(input.userId)}`, "PATCH", input);
  await Promise.all([
    mutate(`/api/v1/internal/admin-ops/tpo-accounts?tenantId=${encodeURIComponent(input.tenantId)}`),
    mutate(`/api/v1/internal/admin-ops/workspace?tenantId=${encodeURIComponent(input.tenantId)}`),
  ]);
  return data;
}

export async function adminResetTpoCredentials(input: { tenantId: string; userId: string }) {
  const data = await sendJson<AdminOpsJob>(`/api/v1/internal/admin-ops/tpo-accounts/${encodeURIComponent(input.userId)}/reset-credentials`, "POST", {
    tenantId: input.tenantId,
  });
  await mutate(`/api/v1/internal/admin-ops/jobs?tenantId=${encodeURIComponent(input.tenantId)}`);
  return data;
}

export async function adminResetStudentCredentials(input: { tenantId: string; studentId: string }) {
  const data = await sendJson<AdminOpsJob>(`/api/v1/internal/admin-ops/students/${encodeURIComponent(input.studentId)}/reset-credentials`, "POST", {
    tenantId: input.tenantId,
  });
  await mutate(`/api/v1/internal/admin-ops/jobs?tenantId=${encodeURIComponent(input.tenantId)}`);
  return data;
}

export async function adminSendStudentCredentials(input: { tenantId: string; studentId: string }) {
  const data = await sendJson<AdminOpsJob>(`/api/v1/internal/admin-ops/students/${encodeURIComponent(input.studentId)}/send-credentials`, "POST", {
    tenantId: input.tenantId,
  });
  await Promise.all([
    mutate(`/api/v1/internal/admin-ops/jobs?tenantId=${encodeURIComponent(input.tenantId)}`),
    mutate((key) => typeof key === "string" && key.startsWith(`/api/v1/internal/admin-ops/students?tenantId=${encodeURIComponent(input.tenantId)}`)),
  ]);
  return data;
}

export async function adminCreateCollege(input: {
  collegeName: string;
  tpoFullName: string;
  tpoEmail: string;
  tpoPassword: string;
  branches: string[];
}) {
  const data = await sendJson<{
    tenant: {
      id: string;
      name: string;
      slug: string;
      isActive: boolean;
      branches: string[];
    };
    tpo: AdminTpoRow;
    credentialEmail: { id: string; status?: string };
  }>("/api/v1/internal/admin-ops/colleges", "POST", input);
  await Promise.all([
    mutate("/api/v1/internal/admin-ops/tenants"),
    mutate(`/api/v1/internal/admin-ops/workspace?tenantId=${encodeURIComponent(data.tenant.id)}`),
    mutate(`/api/v1/internal/admin-ops/tpo-accounts?tenantId=${encodeURIComponent(data.tenant.id)}`),
    mutate(`/api/v1/internal/admin-ops/jobs?tenantId=${encodeURIComponent(data.tenant.id)}`),
  ]);
  return data;
}

export async function adminDeleteStudent(input: { tenantId: string; studentId: string }) {
  const data = await sendJson<{
    studentId: string;
    userId: string;
    email: string;
    fullName: string;
  }>(`/api/v1/internal/admin-ops/students/${encodeURIComponent(input.studentId)}`, "DELETE", {
    tenantId: input.tenantId,
  });
  await Promise.all([
    mutate((key) => typeof key === "string" && key.startsWith(`/api/v1/internal/admin-ops/students?tenantId=${encodeURIComponent(input.tenantId)}`)),
    mutate(`/api/v1/internal/admin-ops/workspace?tenantId=${encodeURIComponent(input.tenantId)}`),
    mutate(`/api/v1/internal/admin-ops/jobs?tenantId=${encodeURIComponent(input.tenantId)}`),
  ]);
  return data;
}

export async function adminUnlockStudentProfile(input: { tenantId: string; studentId: string }) {
  const data = await sendJson<{
    studentId: string;
    userId: string;
    unlockedAt: string;
    unlockedBy: string;
  }>(`/api/v1/internal/admin-ops/students/${encodeURIComponent(input.studentId)}/unlock-profile`, "POST", {
    tenantId: input.tenantId,
  });
  await Promise.all([
    mutate((key) => typeof key === "string" && key.startsWith(`/api/v1/internal/admin-ops/students?tenantId=${encodeURIComponent(input.tenantId)}`)),
    mutate(`/api/v1/internal/admin-ops/workspace?tenantId=${encodeURIComponent(input.tenantId)}`),
  ]);
  return data;
}

export async function adminCreateMockTest(input: {
  tenantId: string;
  title: string;
  topicId?: string;
  companyId?: string;
  durationSec: number;
  difficulty: "easy" | "medium" | "hard";
  questions: AdminMockQuestion[];
  isActive: boolean;
  audienceMode?: "all" | "filtered";
  audienceBranches?: string[];
  audienceBatches?: string[];
  audienceYears?: Array<"first_year" | "second_year" | "third_year" | "final_year">;
  customTopicName?: string;
  customCompanyName?: string;
}) {
  const data = await sendJson<AdminMockTestRow>("/api/v1/internal/admin-ops/mock-tests", "POST", input);
  await Promise.all([
    mutate(`/api/v1/internal/admin-ops/mock-tests?tenantId=${encodeURIComponent(input.tenantId)}`),
    mutate(`/api/v1/internal/admin-ops/workspace?tenantId=${encodeURIComponent(input.tenantId)}`),
  ]);
  return data;
}

export async function adminUpdateMockTest(input: {
  tenantId: string;
  testId: string;
  title?: string;
  topicId?: string;
  companyId?: string;
  durationSec?: number;
  difficulty?: "easy" | "medium" | "hard";
  isActive?: boolean;
  audienceMode?: "all" | "filtered";
  audienceBranches?: string[];
  audienceBatches?: string[];
  audienceYears?: Array<"first_year" | "second_year" | "third_year" | "final_year">;
  customTopicName?: string;
  customCompanyName?: string;
}) {
  const data = await sendJson<AdminMockTestRow>(`/api/v1/internal/admin-ops/mock-tests/${encodeURIComponent(input.testId)}`, "PATCH", input);
  await mutate(`/api/v1/internal/admin-ops/mock-tests?tenantId=${encodeURIComponent(input.tenantId)}`);
  return data;
}

export async function adminPublishMockTest(input: { tenantId: string; testId: string; isActive: boolean }) {
  const data = await sendJson<AdminMockTestRow>(`/api/v1/internal/admin-ops/mock-tests/${encodeURIComponent(input.testId)}/publish`, "POST", {
    tenantId: input.tenantId,
    isActive: input.isActive,
  });
  await mutate(`/api/v1/internal/admin-ops/mock-tests?tenantId=${encodeURIComponent(input.tenantId)}`);
  return data;
}

export async function adminUpdateMockTestQuestions(input: {
  tenantId: string;
  testId: string;
  append: boolean;
  questions: AdminMockQuestion[];
}) {
  const data = await sendJson<unknown>(`/api/v1/internal/admin-ops/mock-tests/${encodeURIComponent(input.testId)}/questions`, "PUT", input);
  await mutate(`/api/v1/internal/admin-ops/mock-tests/${encodeURIComponent(input.testId)}/questions?tenantId=${encodeURIComponent(input.tenantId)}`);
  return data;
}

export async function adminPreviewMockTestImportFile(input: { tenantId: string; file: File }) {
  const form = new FormData();
  form.append("tenantId", input.tenantId);
  form.append("file", input.file);
  const response = await fetch("/api/v1/internal/admin-ops/mock-tests/import/preview", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader(undefined),
    body: form,
  });
  return parseApiResponse<AdminMockQuestionImportPreview>(response, "Admin API");
}

export async function adminCreateMockTestFromImport(input: {
  tenantId: string;
  title: string;
  topicId?: string;
  companyId?: string;
  durationSec: number;
  difficulty: "easy" | "medium" | "hard";
  isActive: boolean;
  audienceMode?: "all" | "filtered";
  audienceBranches?: string[];
  audienceBatches?: string[];
  audienceYears?: Array<"first_year" | "second_year" | "third_year" | "final_year">;
  customTopicName?: string;
  customCompanyName?: string;
  rows: Array<Record<string, string>>;
}) {
  const data = await sendJson<AdminMockTestRow>("/api/v1/internal/admin-ops/mock-tests/import/create", "POST", input);
  await Promise.all([
    mutate(`/api/v1/internal/admin-ops/mock-tests?tenantId=${encodeURIComponent(input.tenantId)}`),
    mutate(`/api/v1/internal/admin-ops/workspace?tenantId=${encodeURIComponent(input.tenantId)}`),
  ]);
  return data;
}

export async function adminUpdateMockTestFromImport(input: {
  tenantId: string;
  testId: string;
  append: boolean;
  rows: Array<Record<string, string>>;
}) {
  const data = await sendJson<{ testId: string; questionCount: number }>(`/api/v1/internal/admin-ops/mock-tests/${encodeURIComponent(input.testId)}/import`, "POST", input);
  await mutate(`/api/v1/internal/admin-ops/mock-tests/${encodeURIComponent(input.testId)}/questions?tenantId=${encodeURIComponent(input.tenantId)}`);
  return data;
}

export async function adminCreateExternalResource(input: {
  tenantId: string;
  title: string;
  description?: string;
  url: string;
  resourceType: string;
  topicId?: string | null;
  durationSec?: number;
  thumbnailUrl?: string | null;
  isActive?: boolean;
  branchRelevance?: string[];
  careerTracks?: string[];
  recommendedFor?: string[];
  contentPackLabels?: string[];
}) {
  const data = await sendJson<{ id: string }>("/api/v1/internal/admin-ops/resources/external", "POST", input);
  await Promise.all([
    mutate(`/api/v1/internal/admin-ops/resources?tenantId=${encodeURIComponent(input.tenantId)}`),
    mutate(`/api/v1/internal/admin-ops/workspace?tenantId=${encodeURIComponent(input.tenantId)}`),
  ]);
  return data;
}

export async function adminUploadResource(input: {
  tenantId: string;
  title: string;
  description?: string;
  topicId?: string | null;
  resourceType: string;
  durationSec?: number;
  thumbnailUrl?: string | null;
  isActive?: boolean;
  branchRelevance?: string[];
  careerTracks?: string[];
  recommendedFor?: string[];
  contentPackLabels?: string[];
  file: File;
}) {
  const form = new FormData();
  form.append("tenantId", input.tenantId);
  form.append("title", input.title);
  form.append("description", input.description ?? "");
  form.append("topicId", input.topicId ?? "");
  form.append("resourceType", input.resourceType);
  form.append("durationSec", String(input.durationSec ?? 0));
  form.append("thumbnailUrl", input.thumbnailUrl ?? "");
  form.append("isActive", String(input.isActive ?? true));
  form.append("branchRelevance", (input.branchRelevance ?? []).join(", "));
  form.append("careerTracks", (input.careerTracks ?? []).join(", "));
  form.append("recommendedFor", (input.recommendedFor ?? []).join(", "));
  form.append("contentPackLabels", (input.contentPackLabels ?? []).join(", "));
  form.append("file", input.file);

  const response = await fetch("/api/v1/internal/admin-ops/resources/upload", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader(undefined),
    body: form,
  });
  const payload = await parseApiResponse<{ id: string; assetId: string; url: string; storageKey: string }>(response, "Admin API");
  await Promise.all([
    mutate(`/api/v1/internal/admin-ops/resources?tenantId=${encodeURIComponent(input.tenantId)}`),
    mutate(`/api/v1/internal/admin-ops/workspace?tenantId=${encodeURIComponent(input.tenantId)}`),
  ]);
  return payload;
}

export async function adminUpdateResource(input: {
  tenantId: string;
  resourceId: string;
  title?: string;
  description?: string;
  topicId?: string | null;
  resourceType?: string;
  durationSec?: number;
  thumbnailUrl?: string | null;
  isActive?: boolean;
  url?: string | null;
  branchRelevance?: string[];
  careerTracks?: string[];
  recommendedFor?: string[];
  contentPackLabels?: string[];
}) {
  const data = await sendJson<{ id: string }>(`/api/v1/internal/admin-ops/resources/${encodeURIComponent(input.resourceId)}`, "PATCH", input);
  await mutate(`/api/v1/internal/admin-ops/resources?tenantId=${encodeURIComponent(input.tenantId)}`);
  return data;
}

export async function adminSaveIntegrations(input: {
  tenantId: string;
  googleForm?: string | null;
  googleSheet?: string | null;
  googleDriveSharedDriveId?: string | null;
  googleDriveRootFolderId?: string | null;
  label?: string | null;
  notes?: string | null;
}) {
  const data = await sendJson<AdminIntegrations>("/api/v1/internal/admin-ops/integrations", "PUT", input);
  await mutate(`/api/v1/internal/admin-ops/integrations?tenantId=${encodeURIComponent(input.tenantId)}`);
  return data;
}

export async function adminSaveEmailSettings(input: { tenantId: string; fromName?: string | null; fromEmail?: string | null; replyToEmail?: string | null }) {
  const data = await sendJson<AdminEmailSettings>("/api/v1/internal/admin-ops/email-settings", "PUT", input);
  await mutate(`/api/v1/internal/admin-ops/email-settings?tenantId=${encodeURIComponent(input.tenantId)}`);
  return data;
}

export async function adminSavePlacementPolicy(input: { tenantId: string; excludePlacedStudentsByDefault: boolean }) {
  const data = await sendJson<AdminPlacementPolicy>("/api/v1/internal/admin-ops/placement-policy", "PUT", input);
  await mutate(`/api/v1/internal/admin-ops/placement-policy?tenantId=${encodeURIComponent(input.tenantId)}`);
  await mutate(`/api/v1/internal/admin-ops/workspace?tenantId=${encodeURIComponent(input.tenantId)}`);
  return data;
}

export async function adminRetryJob(input: { tenantId: string; jobId: string }) {
  const data = await sendJson<AdminOpsJob>(`/api/v1/internal/admin-ops/jobs/${encodeURIComponent(input.jobId)}/retry`, "POST", {
    tenantId: input.tenantId,
  });
  await mutate(`/api/v1/internal/admin-ops/jobs?tenantId=${encodeURIComponent(input.tenantId)}`);
  return data;
}

export async function adminReleaseJob(input: { tenantId: string; jobId: string }) {
  const data = await sendJson<AdminOpsJob>(`/api/v1/internal/admin-ops/jobs/${encodeURIComponent(input.jobId)}/release`, "POST", {
    tenantId: input.tenantId,
  });
  await Promise.all([
    mutate(`/api/v1/internal/admin-ops/jobs?tenantId=${encodeURIComponent(input.tenantId)}`),
    mutate((key) => typeof key === "string" && key.startsWith(`/api/v1/internal/admin-ops/students?tenantId=${encodeURIComponent(input.tenantId)}`)),
  ]);
  return data;
}

