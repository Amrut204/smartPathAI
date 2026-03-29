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

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }
  return payload.data;
}

export interface SupportSessionInfo {
  active: boolean;
  sessionId?: string;
  tenantId?: string;
  tenantSlug?: string;
  tenantName?: string;
  expiresAt?: string;
  approvedBy?: string;
}

export interface SupportRequest {
  id: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  requested_by_user_id: string;
  requested_by_email: string;
  reason: string;
  status: "pending" | "approved" | "denied" | "revoked";
  is_expired?: boolean;
  created_at: string;
  decided_at: string | null;
  decided_by_user_id: string | null;
  decided_by_email: string | null;
  decision_note: string | null;
  expires_at: string | null;
  last_started_at: string | null;
  last_stopped_at: string | null;
  revoked_at: string | null;
}

export interface StudentSupportRequest {
  id: string;
  tenant_id: string;
  student_id: string;
  student_email: string;
  student_name: string;
  subject: string;
  message: string;
  status: "open" | "resolved";
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  resolved_by_email: string | null;
  resolution_note: string | null;
}

export function useSupportSession(enabled: boolean) {
  return useSWR<SupportSessionInfo>(enabled ? "/api/v1/support/session" : null, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useAdminSupportRequests(enabled: boolean) {
  return useSWR<SupportRequest[]>(enabled ? "/api/v1/support/requests" : null, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useTpoSupportInbox(enabled: boolean) {
  return useSWR<SupportRequest[]>(enabled ? "/api/v1/support/inbox" : null, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useStudentSupportRequests(enabled: boolean) {
  return useSWR<StudentSupportRequest[]>(enabled ? "/api/v1/support/student-requests/me" : null, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useTpoStudentSupportInbox(enabled: boolean) {
  return useSWR<StudentSupportRequest[]>(enabled ? "/api/v1/support/student-requests/inbox" : null, fetcher, {
    revalidateOnFocus: false,
  });
}

export async function requestSupportAccess(input: { tenantSlug: string; reason: string }) {
  const data = await postJson<SupportRequest>("/api/v1/support/requests", input);
  await mutate("/api/v1/support/requests");
  return data;
}

export async function startSupportSession(sessionId: string) {
  const data = await postJson<SupportSessionInfo>(`/api/v1/support/requests/${encodeURIComponent(sessionId)}/start`, {});
  await mutate("/api/v1/support/session");
  // Tenant changes, so revalidate everything.
  await mutate(() => true, undefined, { revalidate: true });
  return data;
}

export async function stopSupportSession() {
  const data = await postJson<SupportSessionInfo>("/api/v1/support/session/stop", {});
  await mutate("/api/v1/support/session");
  await mutate(() => true, undefined, { revalidate: true });
  return data;
}

export async function approveSupportRequest(sessionId: string, ttlMinutes = 60) {
  const data = await postJson<SupportRequest>(`/api/v1/support/requests/${encodeURIComponent(sessionId)}/approve`, { ttlMinutes });
  await mutate("/api/v1/support/inbox");
  return data;
}

export async function denySupportRequest(sessionId: string, note: string) {
  const data = await postJson<SupportRequest>(`/api/v1/support/requests/${encodeURIComponent(sessionId)}/deny`, { note });
  await mutate("/api/v1/support/inbox");
  return data;
}

export async function createStudentSupportRequest(input: { subject: string; message: string }) {
  const data = await postJson<StudentSupportRequest>("/api/v1/support/student-requests", input);
  await mutate("/api/v1/support/student-requests/me");
  await mutate("/api/v1/support/student-requests/inbox");
  return data;
}

export async function resolveStudentSupportRequest(requestId: string, note: string) {
  const data = await postJson<StudentSupportRequest>(`/api/v1/support/student-requests/${encodeURIComponent(requestId)}/resolve`, { note });
  await mutate("/api/v1/support/student-requests/inbox");
  await mutate("/api/v1/support/student-requests/me");
  return data;
}
