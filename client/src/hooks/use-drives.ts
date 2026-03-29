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

export interface DriveCriteria {
  minCgpa?: number;
  maxBacklogs?: number;
  maxActiveBacklogs?: number;
  maxTotalBacklogs?: number;
  branches?: string[];
  minAttendance?: number;
  excludePlacedStudents?: boolean;
}

export interface DriveSummary {
  id: string;
  company: string;
  role: string | null;
  driveDate: string;
  sectorOrIndustry: string | null;
  ctcMinLpa: number | null;
  ctcMaxLpa: number | null;
  ctcFinalLpa: number | null;
  visitDate: string | null;
  roundsConducted: string[];
  mouStatus: "not_started" | "in_discussion" | "signed" | "not_applicable";
  reportingNotes: string | null;
  registrationInstructions?: string | null;
  requiredDocuments?: string[];
  location?: string | null;
  mode?: "on_campus" | "off_campus" | "hybrid" | null;
  dressCode?: string | null;
  criteria: DriveCriteria;
  status: "draft" | "published" | "registration_closed" | "in_process" | "results_pending" | "completed" | "archived" | "cancelled";
  eligibleCount: number;
}

export interface DriveResultRow {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  rollNumber: string;
  branch: string;
  batch: string;
  cgpa: number;
  backlogs: number;
  attendancePct: number;
  readinessScore: number;
  status: "eligible" | "applied" | "not_eligible" | "not_computed";
  applicationState: "not_applied" | "applied" | "withdrawn" | "absent";
  outcome: "pending" | "shortlisted" | "selected" | "rejected";
  rounds: Array<{
    key: string;
    label: string;
    stageType: "screening" | "aptitude" | "group_discussion" | "technical_interview" | "hr_interview" | "final_decision" | "custom";
    status: "pending" | "qualified" | "not_qualified" | "scheduled" | "completed";
    decidedAt?: string | null;
    releasedAt?: string | null;
    notes?: string | null;
  }>;
  remarks: string | null;
  registered: boolean | null;
  appeared: boolean | null;
  shortlistedRound: string | null;
  offerDate: string | null;
  designationOffered: string | null;
  finalCtcLpa: number | null;
  joiningStatus: "pending" | "joined" | "not_joined" | "deferred";
  offerLetterReference: string | null;
  offerLetterUrl: string | null;
  joiningLetterUrl: string | null;
  selectionSource: "on_campus" | "off_campus" | "self_reported";
  verificationStatus: "pending" | "verified" | "rejected";
  sourceNote: string | null;
  nonPlacementReason: string | null;
  actionPlan: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  resultReleasedAt: string | null;
  resultReleasedBy: string | null;
  resultNotificationStatus: "queued" | "sent" | "failed" | null;
  resultNotificationCommunicationId: string | null;
  offerLetterSharedAt: string | null;
  offerLetterSharedBy: string | null;
  studentResultViewedAt: string | null;
  updatedAt: string;
}

export interface DriveEligibilityReason {
  code: string;
  label: string;
  count: number;
}

export interface DriveEligibilitySnapshot {
  id: string;
  driveId: string;
  version: number;
  criteria: DriveCriteria;
  totalStudents: number;
  eligibleCount: number;
  ineligibleCount: number;
  reasons: DriveEligibilityReason[];
  branchBreakdown?: Array<{ branch: string; eligibleCount: number; ineligibleCount: number; totalStudents: number }>;
  sampleExcludedStudents?: Array<{ studentId: string; fullName: string; branch: string; cgpa: number; attendancePct: number; reasons: string[] }>;
  previewDigest?: string | null;
  computedAt: string;
  computedBy: string;
}

export interface DriveEligibilityCandidate {
  id: string;
  fullName: string;
  email: string;
  branch: string;
  cgpa: number;
  attendancePct: number;
  readinessScore: number;
}

export interface DriveEligibilityPreview {
  criteria: DriveCriteria;
  totalStudents: number;
  eligibleCount: number;
  ineligibleCount: number;
  eligibleRate: number;
  reasons: DriveEligibilityReason[];
  topEligibleStudents: DriveEligibilityCandidate[];
  branchBreakdown?: Array<{ branch: string; eligibleCount: number; ineligibleCount: number; totalStudents: number }>;
  sampleExcludedStudents?: Array<{ studentId: string; fullName: string; branch: string; cgpa: number; attendancePct: number; reasons: string[] }>;
  previewDigest?: string;
}

export interface DriveDetail extends DriveSummary {
  createdAt: string;
  updatedAt: string;
  previewDigest?: string | null;
  previewedAt?: string | null;
  eligibility: {
    latestVersion: number | null;
    lastComputedAt: string | null;
    snapshots: DriveEligibilitySnapshot[];
  };
  resultIntake: {
    source: "employer_email" | "employer_portal" | "manual_update" | null;
    receivedAt: string | null;
    receivedBy: string | null;
    companyResultReference: string | null;
    attachmentNote: string | null;
  };
  results: DriveResultRow[];
}

export interface DriveResultReleasePreview {
  audience: "selected" | "rejected" | "finalized";
  driveId: string;
  driveName: string;
  sender: {
    fromEmail: string;
    fromName: string;
    replyToEmail: string | null;
    tenantName: string;
    senderSource: "tenant" | "platform-fallback";
    displayFrom: string;
  };
  recipientCount: number;
  selectedCount: number;
  rejectedCount: number;
  selectedWithOfferLetters: number;
  warnings: string[];
  sampleRecipients: Array<{
    studentId: string;
    fullName: string;
    email: string;
    outcome: "selected" | "rejected";
    hasOfferLetter: boolean;
  }>;
}

export interface DriveReleaseStatus {
  driveId: string;
  driveName: string;
  summary: {
    selectedCount: number;
    rejectedCount: number;
    releasedCount: number;
    pendingReleaseCount: number;
    queuedCount: number;
    sentCount: number;
    failedCount: number;
    offerAttachedCount: number;
    offerSharedCount: number;
  };
  items: Array<{
    studentId: string;
    fullName: string;
    email: string;
    outcome: "selected" | "rejected";
    resultReleasedAt: string | null;
    resultReleasedBy: string | null;
    resultNotificationStatus: "queued" | "sent" | "failed" | null;
    resultNotificationCommunicationId: string | null;
    offerLetterReference: string | null;
    offerLetterUrl: string | null;
    offerLetterSharedAt: string | null;
    offerLetterSharedBy: string | null;
    updatedAt: string | null;
  }>;
}

export function useDrives(params?: { status?: DriveSummary["status"] }) {
  const query = new URLSearchParams();
  query.set("limit", "50");
  if (params?.status) {
    query.set("status", params.status);
  }

  return useSWR<{ items: DriveSummary[]; hasMore: boolean; nextCursor: string | null }>(`/api/v1/drives?${query.toString()}`, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useDriveById(driveId: string | null) {
  return useSWR<DriveDetail>(driveId ? `/api/v1/drives/${driveId}` : null, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useDriveResults(driveId: string | null) {
  return useSWR<DriveResultRow[]>(driveId ? `/api/v1/drives/${driveId}/results` : null, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useDriveReleaseStatus(driveId: string | null) {
  return useSWR<DriveReleaseStatus>(driveId ? `/api/v1/drives/${driveId}/results/release-status` : null, fetcher, {
    revalidateOnFocus: false,
  });
}

export async function createDrive(input: {
  company: string;
  role?: string;
  driveDate: string;
  sectorOrIndustry?: string;
  ctcMinLpa?: number;
  ctcMaxLpa?: number;
  ctcFinalLpa?: number;
  visitDate?: string;
  roundsConducted?: string[];
  mouStatus?: DriveSummary["mouStatus"];
  reportingNotes?: string;
  registrationInstructions?: string;
  requiredDocuments?: string[];
  location?: string;
  mode?: NonNullable<DriveSummary["mode"]>;
  dressCode?: string;
  criteria: DriveCriteria;
  status?: DriveSummary["status"];
  previewDigest?: string;
}) {
  const response = await fetch("/api/v1/drives", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<DriveDetail>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await mutate((key) => typeof key === "string" && key.startsWith("/api/v1/drives?"));

  return payload.data;
}

export async function previewDriveEligibility(input: {
  criteria: DriveCriteria;
}) {
  const response = await fetch("/api/v1/drives/eligibility/preview", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<DriveEligibilityPreview>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}

export async function updateDrive(
  driveId: string,
  input: Partial<{
    company: string;
    role: string;
    driveDate: string;
    sectorOrIndustry: string;
    ctcMinLpa: number;
    ctcMaxLpa: number;
    ctcFinalLpa: number;
    visitDate: string;
    roundsConducted: string[];
    mouStatus: DriveSummary["mouStatus"];
    reportingNotes: string;
    registrationInstructions: string;
    requiredDocuments: string[];
    location: string;
    mode: NonNullable<DriveSummary["mode"]>;
    dressCode: string;
    criteria: DriveCriteria;
    status: DriveSummary["status"];
    previewDigest: string;
  }>,
) {
  const response = await fetch(`/api/v1/drives/${driveId}`, {
    method: "PATCH",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<DriveDetail>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await Promise.all([
    mutate(`/api/v1/drives/${driveId}`),
    mutate((key) => typeof key === "string" && key.startsWith("/api/v1/drives?")),
  ]);

  return payload.data;
}

export async function deleteDrive(driveId: string) {
  const response = await fetch(`/api/v1/drives/${driveId}`, {
    method: "DELETE",
    credentials: "include",
    headers: withCsrfHeader(undefined),
  });

  const payload = (await response.json()) as ApiResponse<{ driveId: string; deleted: boolean }>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await Promise.all([
    mutate(`/api/v1/drives/${driveId}`),
    mutate((key) => typeof key === "string" && key.startsWith("/api/v1/drives?")),
  ]);

  return payload.data;
}

export async function computeDriveEligibility(driveId: string) {
  const response = await fetch(`/api/v1/drives/${driveId}/eligibility`, {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader(undefined),
  });

  const payload = (await response.json()) as ApiResponse<{
    driveId: string;
    eligibleCount: number;
    totalStudents: number;
    ineligibleCount: number;
    eligibleRate: number;
    reasons: DriveEligibilityReason[];
    snapshot: DriveEligibilitySnapshot;
    students: DriveResultRow[];
  }>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await Promise.all([mutate(`/api/v1/drives/${driveId}`), mutate(`/api/v1/drives/${driveId}/results`)]);

  return payload.data;
}

export async function updateDriveResults(input: {
  driveId: string;
  updates: Array<{
    studentId: string;
    outcome: "pending" | "shortlisted" | "selected" | "rejected";
    applicationState?: DriveResultRow["applicationState"];
    remarks?: string;
    registered?: boolean;
    appeared?: boolean;
    shortlistedRound?: string;
    offerDate?: string;
    designationOffered?: string;
    finalCtcLpa?: number;
    joiningStatus?: DriveResultRow["joiningStatus"];
    offerLetterReference?: string;
    offerLetterUrl?: string;
    joiningLetterUrl?: string;
    selectionSource?: DriveResultRow["selectionSource"];
    verificationStatus?: DriveResultRow["verificationStatus"];
    sourceNote?: string;
    nonPlacementReason?: string;
    actionPlan?: string;
    rounds?: DriveResultRow["rounds"];
  }>;
  resultIntake?: {
    source?: "employer_email" | "employer_portal" | "manual_update";
    receivedAt?: string;
    companyResultReference?: string;
    attachmentNote?: string;
  };
  markCompleted?: boolean;
}) {
  const response = await fetch(`/api/v1/drives/${input.driveId}/results`, {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      updates: input.updates,
      resultIntake: input.resultIntake,
      markCompleted: input.markCompleted,
    }),
  });

  const payload = (await response.json()) as ApiResponse<{
    driveId: string;
    updated: number;
    results: DriveResultRow[];
  }>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await Promise.all([
    mutate(`/api/v1/drives/${input.driveId}`),
    mutate(`/api/v1/drives/${input.driveId}/results`),
    mutate((key) => typeof key === "string" && key.startsWith("/api/v1/drives?")),
  ]);

  return payload.data;
}

export async function withdrawFromDrive(driveId: string) {
  const response = await fetch(`/api/v1/students/me/drives/${driveId}/withdraw`, {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify({ confirmWithdrawal: true }),
  });

  const payload = (await response.json()) as ApiResponse<{ driveId: string; applicationState: "withdrawn" }>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await Promise.all([
    mutate("/api/v1/students/me/drives"),
    mutate("/api/v1/students/me/pilot-dashboard"),
  ]);

  return payload.data;
}

export async function previewDriveResultRelease(input: {
  driveId: string;
  audience: "selected" | "rejected" | "finalized";
}) {
  const response = await fetch(`/api/v1/drives/${input.driveId}/results/release-preview`, {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify({ audience: input.audience }),
  });

  const payload = (await response.json()) as ApiResponse<DriveResultReleasePreview>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}

export async function releaseDriveResults(input: {
  driveId: string;
  audience: "selected" | "rejected" | "finalized";
}) {
  const response = await fetch(`/api/v1/drives/${input.driveId}/results/release`, {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify({ audience: input.audience }),
  });

  const payload = (await response.json()) as ApiResponse<{
    driveId: string;
    audience: "selected" | "rejected" | "finalized";
    releasedAt: string;
    selectedCount: number;
    rejectedCount: number;
    communications: Array<{ communicationId: string; audience: "selected" | "rejected"; recipientCount: number }>;
    results: DriveResultRow[];
  }>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await Promise.all([
    mutate(`/api/v1/drives/${input.driveId}`),
    mutate(`/api/v1/drives/${input.driveId}/results`),
    mutate(`/api/v1/drives/${input.driveId}/results/release-status`),
  ]);

  return payload.data;
}

export async function resendDriveResultEmail(input: {
  driveId: string;
  studentId: string;
}) {
  const response = await fetch(`/api/v1/drives/${input.driveId}/results/${input.studentId}/resend-result-email`, {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader(undefined),
  });

  const payload = (await response.json()) as ApiResponse<{
    driveId: string;
    studentId: string;
    communicationId: string;
    outcome: "selected" | "rejected";
    status: "queued";
  }>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await Promise.all([
    mutate(`/api/v1/drives/${input.driveId}/results`),
    mutate(`/api/v1/drives/${input.driveId}/results/release-status`),
  ]);

  return payload.data;
}
