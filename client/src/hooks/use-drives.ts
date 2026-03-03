import { mutate } from "swr";
import useSWR from "swr";

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
  branches?: string[];
  minAttendance?: number;
}

export interface DriveSummary {
  id: string;
  company: string;
  role: string | null;
  driveDate: string;
  criteria: DriveCriteria;
  status: "upcoming" | "active" | "completed" | "cancelled";
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
  status: "eligible" | "ineligible";
  outcome: "pending" | "shortlisted" | "selected" | "rejected";
  remarks: string | null;
  updatedAt: string;
}

export interface DriveDetail extends DriveSummary {
  createdAt: string;
  updatedAt: string;
  results: DriveResultRow[];
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

export async function createDrive(input: {
  company: string;
  role?: string;
  driveDate: string;
  criteria: DriveCriteria;
  status?: DriveSummary["status"];
}) {
  const response = await fetch("/api/v1/drives", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<DriveDetail>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await mutate((key) => typeof key === "string" && key.startsWith("/api/v1/drives?"));

  return payload.data;
}

export async function updateDrive(
  driveId: string,
  input: Partial<{
    company: string;
    role: string;
    driveDate: string;
    criteria: DriveCriteria;
    status: DriveSummary["status"];
  }>,
) {
  const response = await fetch(`/api/v1/drives/${driveId}`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
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
  });

  const payload = (await response.json()) as ApiResponse<{
    driveId: string;
    eligibleCount: number;
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
    remarks?: string;
  }>;
  markCompleted?: boolean;
}) {
  const response = await fetch(`/api/v1/drives/${input.driveId}/results`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      updates: input.updates,
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
