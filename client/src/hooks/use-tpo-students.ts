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

export interface TpoStudentRow {
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
  attendancePct: number;
  skills: string[];
  readinessScore: number;
  profileData: Record<string, unknown>;
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
    updatedAt: string;
  }>;
}

export function useTpoStudents(query?: {
  batch?: string;
  branch?: string;
  cgpaMin?: number;
  cgpaMax?: number;
  backlogsMin?: number;
  backlogsMax?: number;
  sortBy?: "cgpa" | "created_at";
  sortDir?: "asc" | "desc";
}) {
  const params = new URLSearchParams();
  params.set("limit", "50");
  if (query?.batch) params.set("batch", query.batch);
  if (query?.branch) params.set("branch", query.branch);
  if (query?.cgpaMin !== undefined) params.set("cgpaMin", String(query.cgpaMin));
  if (query?.cgpaMax !== undefined) params.set("cgpaMax", String(query.cgpaMax));
  if (query?.backlogsMin !== undefined) params.set("backlogsMin", String(query.backlogsMin));
  if (query?.backlogsMax !== undefined) params.set("backlogsMax", String(query.backlogsMax));
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

export async function updateTpoStudent(studentId: string, updates: Record<string, unknown>) {
  const response = await fetch(`/api/v1/students/${studentId}`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
  });

  const payload = (await response.json()) as ApiResponse<Record<string, unknown>>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await Promise.all([mutate(`/api/v1/students/${studentId}`), mutate((key) => typeof key === "string" && key.startsWith("/api/v1/students?"))]);

  return payload.data;
}

export async function previewStudentCsv(csv: string) {
  const response = await fetch("/api/v1/students/upload", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
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

export async function confirmStudentCsv(input: {
  mapping: {
    fullName: string;
    email: string;
    rollNumber: string;
    branch: string;
    batch: string;
    cgpa?: string;
    backlogs?: string;
    attendancePct?: string;
  };
  rows: Array<Record<string, string>>;
}) {
  const response = await fetch("/api/v1/students/upload/confirm", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<{
    created: number;
    updated: number;
    skipped: number;
    errors: Array<{ row: number; message: string }>;
  }>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await mutate((key) => typeof key === "string" && key.startsWith("/api/v1/students?"));

  return payload.data;
}
