import { mutate } from "swr";
import useSWR from "swr";
import { withCsrfHeader } from "../utils/csrf";

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

export interface TpoStudentRow {
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
  missingResume: boolean;
  waitingOnStudent: boolean;
  waitingOnCollege: boolean;
  canAccessResources: boolean;
  canAccessMockTests: boolean;
  isProfileCertified: boolean;
  isProfileLocked: boolean;
  hasResumeReady: boolean;
  isActive7d: boolean;
  appliedRecently: boolean;
  eligibleUpcomingDriveCount: number;
  blockedUpcomingDriveCount: number;
  nearestUpcomingDriveDate: string | null;
  primaryBlocker: string | null;
  needsIntervention: boolean;
  interventionLabel: string;
  lastActiveAt: string | null;
  riskScore: number;
  mockAttempts30d: number;
  lastMockSubmittedAt: string | null;
  targetRoles: string[];
  preferredLocations: string[];
  willingToRelocate: boolean | null;
}

export interface TpoStudentDetail {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  rollNumber: string;
  branch: string;
  batch: string;
  cgpa: number;
  backlogs: number;
  totalHistoricalBacklogs: number;
  attendancePct: number;
  skills: string[];
  readinessScore: number;
  profileData: Record<string, unknown>;
  profileCompletenessPct: number;
  declarationStatus: {
    policyVersion: string;
    onboarding: {
      required: boolean;
      acceptedAt: string | null;
      version: string | null;
      typedValue: string | null;
      expectedTypedValue: string;
    };
    profileCertification: {
      isCertified: boolean;
      acceptedAt: string | null;
      version: string | null;
      snapshotHash: string | null;
      invalidatedAt: string | null;
      invalidationReason: string | null;
      requiresRecertification: boolean;
      typedValueHint: string;
      isCompleteButUncertified: boolean;
    };
  };
  missingRequiredFields: Array<{ key: string; label: string; owner: "seeded" | "student"; complete: boolean }>;
  missingStudentFields: Array<{ key: string; label: string; owner: "student"; complete: boolean }>;
  pendingCollegeFields: Array<{ key: string; label: string; owner: "seeded"; complete: boolean }>;
  unlockRequest: null | {
    id: string;
    status: "pending" | "approved" | "denied" | "resolved";
    reasonCategory: "academic_record" | "resume_update" | "certification_correction" | "contact_update" | "other";
    requestedFields: string[];
    explanation: string;
    responseNote: string;
    createdAt: string;
    decidedAt: string | null;
    decidedBy: string | null;
    resolvedAt: string | null;
  };
  attempts: Array<{
    id: string;
    testId: string;
    testTitle: string;
    testDifficulty: string;
    score: number;
    submittedAt: string | null;
  }>;
  mastery: Array<{
    topicId: string;
    topicName: string;
    masteryLevel: number;
  }>;
  driveParticipation: Array<{
    driveId: string;
    company: string;
    role: string | null;
    driveDate: string | null;
    driveStatus: string | null;
    status: string;
    outcome: string;
    registered: boolean | null;
    appeared: boolean | null;
    offerDate: string | null;
    designationOffered: string | null;
    finalCtcLpa: number | null;
    joiningStatus: string | null;
    offerLetterReference: string | null;
    offerLetterUrl: string | null;
    joiningLetterUrl: string | null;
    selectionSource: string | null;
    verificationStatus: string | null;
    nonPlacementReason: string | null;
    actionPlan: string | null;
    resultReleasedAt: string | null;
    resultReleasedBy: string | null;
    resultNotificationStatus: string | null;
    resultNotificationCommunicationId: string | null;
    offerLetterSharedAt: string | null;
    offerLetterSharedBy: string | null;
    studentResultViewedAt: string | null;
    declarationAcceptedAt: string | null;
    declarationVersion: string | null;
    updatedAt: string;
  }>;
}

export interface TpoAuditEntry {
  id: string;
  createdAt: string;
  eventType: string;
  supportSessionId: string | null;
  actorUserId: string | null;
  actorRole: string | null;
  actorTenantId: string | null;
  method: string | null;
  path: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
}

export function useTpoStudents(query?: {
  q?: string;
  batch?: string;
  branch?: string;
  prn?: string;
  cgpaMin?: number;
  cgpaMax?: number;
  readinessMin?: number;
  readinessMax?: number;
  attendanceMin?: number;
  attendanceMax?: number;
  backlogsMin?: number;
  backlogsMax?: number;
  totalHistoricalBacklogsMin?: number;
  totalHistoricalBacklogsMax?: number;
  profileCompletenessMin?: number;
  profileCompletenessMax?: number;
  missingResume?: boolean;
  waitingOnStudent?: boolean;
  waitingOnCollege?: boolean;
  canAccessResources?: boolean;
  canAccessMockTests?: boolean;
  targetRole?: string;
  preferredLocation?: string;
  willingToRelocate?: boolean;
  eligibleForUpcomingDrive?: boolean;
  isCertified?: boolean;
  hasResume?: boolean;
  isActive7d?: boolean;
  appliedRecently?: boolean;
  needsIntervention?: boolean;
  sortBy?: "cgpa" | "created_at" | "readiness_score" | "profile_completeness" | "risk_score" | "upcoming_drive_impact" | "activity";
  sortDir?: "asc" | "desc";
  limit?: number;
}) {
  const params = new URLSearchParams();
  params.set("limit", String(query?.limit ?? 100));
  if (query?.q) params.set("q", query.q);
  if (query?.batch) params.set("batch", query.batch);
  if (query?.branch) params.set("branch", query.branch);
  if (query?.prn) params.set("prn", query.prn);
  if (query?.cgpaMin !== undefined) params.set("cgpaMin", String(query.cgpaMin));
  if (query?.cgpaMax !== undefined) params.set("cgpaMax", String(query.cgpaMax));
  if (query?.readinessMin !== undefined) params.set("readinessMin", String(query.readinessMin));
  if (query?.readinessMax !== undefined) params.set("readinessMax", String(query.readinessMax));
  if (query?.attendanceMin !== undefined) params.set("attendanceMin", String(query.attendanceMin));
  if (query?.attendanceMax !== undefined) params.set("attendanceMax", String(query.attendanceMax));
  if (query?.backlogsMin !== undefined) params.set("backlogsMin", String(query.backlogsMin));
  if (query?.backlogsMax !== undefined) params.set("backlogsMax", String(query.backlogsMax));
  if (query?.totalHistoricalBacklogsMin !== undefined) params.set("totalHistoricalBacklogsMin", String(query.totalHistoricalBacklogsMin));
  if (query?.totalHistoricalBacklogsMax !== undefined) params.set("totalHistoricalBacklogsMax", String(query.totalHistoricalBacklogsMax));
  if (query?.profileCompletenessMin !== undefined) params.set("profileCompletenessMin", String(query.profileCompletenessMin));
  if (query?.profileCompletenessMax !== undefined) params.set("profileCompletenessMax", String(query.profileCompletenessMax));
  if (query?.missingResume !== undefined) params.set("missingResume", String(query.missingResume));
  if (query?.waitingOnStudent !== undefined) params.set("waitingOnStudent", String(query.waitingOnStudent));
  if (query?.waitingOnCollege !== undefined) params.set("waitingOnCollege", String(query.waitingOnCollege));
  if (query?.canAccessResources !== undefined) params.set("canAccessResources", String(query.canAccessResources));
  if (query?.canAccessMockTests !== undefined) params.set("canAccessMockTests", String(query.canAccessMockTests));
  if (query?.targetRole) params.set("targetRole", query.targetRole);
  if (query?.preferredLocation) params.set("preferredLocation", query.preferredLocation);
  if (query?.willingToRelocate !== undefined) params.set("willingToRelocate", String(query.willingToRelocate));
  if (query?.eligibleForUpcomingDrive !== undefined) params.set("eligibleForUpcomingDrive", String(query.eligibleForUpcomingDrive));
  if (query?.isCertified !== undefined) params.set("isCertified", String(query.isCertified));
  if (query?.hasResume !== undefined) params.set("hasResume", String(query.hasResume));
  if (query?.isActive7d !== undefined) params.set("isActive7d", String(query.isActive7d));
  if (query?.appliedRecently !== undefined) params.set("appliedRecently", String(query.appliedRecently));
  if (query?.needsIntervention !== undefined) params.set("needsIntervention", String(query.needsIntervention));
  if (query?.sortBy) params.set("sortBy", query.sortBy);
  if (query?.sortDir) params.set("sortDir", query.sortDir);

  return useSWR<{ items: TpoStudentRow[]; hasMore: boolean; nextCursor: string | null }>(`/api/v1/students?${params.toString()}`, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useTpoStudentById(studentId: string | null) {
  return useSWR<TpoStudentDetail>(studentId ? `/api/v1/students/${studentId}` : null, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useTpoStudentAudit(studentId: string | null, limit = 20) {
  return useSWR<TpoAuditEntry[]>(
    studentId ? `/api/v1/students/${studentId}/audit?limit=${limit}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );
}

export async function updateTpoStudent(studentId: string, updates: Record<string, unknown>) {
  const response = await fetch(`/api/v1/students/${studentId}`, {
    method: "PATCH",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(updates),
  });

  const payload = (await response.json()) as ApiResponse<Record<string, unknown>>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await Promise.all([mutate(`/api/v1/students/${studentId}`), mutate((key) => typeof key === "string" && key.startsWith("/api/v1/students?"))]);

  return payload.data;
}

export async function reviewStudentUnlockRequest(input: {
  studentId: string;
  requestId: string;
  decision: "approved" | "denied";
  responseNote?: string;
}) {
  const response = await fetch(`/api/v1/students/${encodeURIComponent(input.studentId)}/profile-unlock-request/${encodeURIComponent(input.requestId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      decision: input.decision,
      responseNote: input.responseNote,
    }),
  });

  const payload = (await response.json()) as ApiResponse<Record<string, unknown>>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await Promise.all([mutate(`/api/v1/students/${input.studentId}`), mutate((key) => typeof key === "string" && key.startsWith("/api/v1/students?"))]);
  return payload.data;
}

export async function previewStudentCsv(csv: string) {
  const response = await fetch("/api/v1/students/upload", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify({ csv }),
  });

  const payload = (await response.json()) as ApiResponse<{
    headers: string[];
    rows: Array<Record<string, string>>;
    mapping: Record<string, string> | null;
    errors: Array<{ row: number; message: string }>;
  }>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}

export async function previewStudentFile(file: File) {
  const form = new FormData();
  form.append("file", file);

  const response = await fetch("/api/v1/students/upload/file-preview", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader(undefined),
    body: form,
  });

  const payload = (await response.json()) as ApiResponse<{
    headers: string[];
    rows: Array<Record<string, string>>;
    mapping: Record<string, string> | null;
    errors: Array<{ row: number; message: string }>;
  }>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}

export async function confirmStudentCsv(input: {
  mapping: {
    fullName: string;
    email: string;
    prn?: string;
    rollNumber: string;
    degree?: string;
    branch: string;
    batch: string;
    currentSemester?: string;
    cgpa?: string;
    backlogs?: string;
    totalHistoricalBacklogs?: string;
    attendancePct?: string;
  };
  rows: Array<Record<string, string>>;
}) {
  const response = await fetch("/api/v1/students/upload/confirm", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<{
    created: number;
    updated: number;
    skipped: number;
    errors: Array<{ row: number; message: string }>;
    errorCsv?: string | null;
  }>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await mutate((key) => typeof key === "string" && key.startsWith("/api/v1/students?"));

  return payload.data;
}

export type StudentImportJob = {
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
  errors: Array<{ row: number; message: string }>;
  errorCsvAvailable: boolean;
  errorMessage: string | null;
};

export async function confirmStudentCsvAsync(input: {
  mapping: {
    fullName: string;
    email: string;
    prn?: string;
    rollNumber: string;
    degree?: string;
    branch: string;
    batch: string;
    currentSemester?: string;
    cgpa?: string;
    backlogs?: string;
    totalHistoricalBacklogs?: string;
    attendancePct?: string;
  };
  rows: Array<Record<string, string>>;
}) {
  const response = await fetch("/api/v1/students/upload/confirm-async", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<StudentImportJob>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  // Lists will change once the job completes; we refresh them at the end in the page.
  return payload.data;
}

export async function fetchStudentImportJob(jobId: string) {
  const response = await fetch(`/api/v1/students/upload/jobs/${jobId}`, {
    method: "GET",
    credentials: "include",
  });
  const payload = (await response.json()) as ApiResponse<StudentImportJob>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }
  return payload.data;
}

export async function downloadStudentImportErrorReport(jobId: string) {
  const response = await fetch(`/api/v1/students/upload/jobs/${jobId}/error-report.csv`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Unable to download error report");
  }
  return await response.text();
}
