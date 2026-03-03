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

export interface StudentProfile {
  id: string;
  tenant_id: string;
  user_id: string;
  roll_number: string;
  branch: string;
  batch: string;
  cgpa: number | null;
  backlogs: number;
  attendance_pct: number | null;
  skills: string[];
  profile_data: Record<string, unknown>;
}

export function useStudentProfile() {
  return useSWR<StudentProfile>("/api/v1/students/me", fetcher, {
    revalidateOnFocus: false,
  });
}

export async function updateStudentProfile(input: {
  fullName?: string;
  skills?: string[];
  profileData?: Record<string, unknown>;
}): Promise<StudentProfile> {
  const response = await fetch("/api/v1/students/me", {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<StudentProfile>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await mutate("/api/v1/students/me");
  await mutate("/api/v1/students/me/dashboard");

  return payload.data;
}
