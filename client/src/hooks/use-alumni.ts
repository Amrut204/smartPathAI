import useSWR, { mutate } from "swr";

import { withCsrfHeader } from "../utils/csrf";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error: { code: string; message: string; details?: Array<{ field?: string; message: string }> };
}

async function parseApiResponse<T>(response: Response): Promise<ApiResponse<T>> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as ApiResponse<T>;
  } catch {
    throw new Error("Alumni API returned an unexpected response. Refresh the page and try again.");
  }
}

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = await parseApiResponse<T>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }
  return payload.data;
}

export type AlumniVerificationStatus = "pending" | "verified" | "unverified";
export type AlumniOpportunityType = "referral" | "hiring_lead" | "mentorship_session" | "alumni_talk";
export type AlumniOpportunityStatus = "draft" | "active" | "closed" | "archived";
export type AlumniAcademicYear = "first_year" | "second_year" | "third_year" | "final_year";

export interface AlumniContact {
  id: string;
  fullName: string;
  branch: string;
  graduationYear: string;
  company: string;
  role: string;
  location: string | null;
  linkedinUrl: string | null;
  email: string | null;
  phone: string | null;
  canRefer: boolean;
  canMentor: boolean;
  isHiring: boolean;
  notes: string | null;
  verificationStatus: AlumniVerificationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AlumniOpportunity {
  id: string;
  type: AlumniOpportunityType;
  title: string;
  description: string;
  status: AlumniOpportunityStatus;
  branches: string[];
  batches: string[];
  academicYears: AlumniAcademicYear[];
  driveId: string | null;
  studentIds: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  alumniContact: {
    id: string;
    fullName: string;
    company: string;
    role: string;
    branch: string;
    graduationYear: string;
    canRefer: boolean;
    canMentor: boolean;
    isHiring: boolean;
    verificationStatus: AlumniVerificationStatus;
  } | null;
  linkedDrive: {
    id: string;
    company: string;
    role: string | null;
    driveDate: string | null;
  } | null;
}

export function useAlumniContacts(params?: {
  q?: string;
  branch?: string;
  verificationStatus?: AlumniVerificationStatus;
  canRefer?: boolean;
  isHiring?: boolean;
}) {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.branch) search.set("branch", params.branch);
  if (params?.verificationStatus) search.set("verificationStatus", params.verificationStatus);
  if (params?.canRefer !== undefined) search.set("canRefer", String(params.canRefer));
  if (params?.isHiring !== undefined) search.set("isHiring", String(params.isHiring));
  const key = `/api/v1/tpo/alumni/contacts${search.toString() ? `?${search.toString()}` : ""}`;

  return useSWR<AlumniContact[]>(key, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useAlumniOpportunities(params?: {
  q?: string;
  type?: AlumniOpportunityType;
  status?: AlumniOpportunityStatus;
}) {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.type) search.set("type", params.type);
  if (params?.status) search.set("status", params.status);
  const key = `/api/v1/tpo/alumni/opportunities${search.toString() ? `?${search.toString()}` : ""}`;

  return useSWR<AlumniOpportunity[]>(key, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useStudentAlumniOpportunities(enabled = true) {
  return useSWR<AlumniOpportunity[]>(enabled ? "/api/v1/students/me/alumni-opportunities" : null, fetcher, {
    revalidateOnFocus: false,
  });
}

export async function createAlumniContact(input: {
  fullName: string;
  branch: string;
  graduationYear: string;
  company: string;
  role: string;
  location?: string;
  linkedinUrl?: string;
  email?: string;
  phone?: string;
  canRefer: boolean;
  canMentor: boolean;
  isHiring: boolean;
  notes?: string;
  verificationStatus: AlumniVerificationStatus;
}) {
  const response = await fetch("/api/v1/tpo/alumni/contacts", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  const payload = await parseApiResponse<AlumniContact>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }
  await mutate((key) => typeof key === "string" && key.startsWith("/api/v1/tpo/alumni/contacts"));
  return payload.data;
}

export async function updateAlumniContact(contactId: string, input: Partial<{
  fullName: string;
  branch: string;
  graduationYear: string;
  company: string;
  role: string;
  location: string;
  linkedinUrl: string;
  email: string;
  phone: string;
  canRefer: boolean;
  canMentor: boolean;
  isHiring: boolean;
  notes: string;
  verificationStatus: AlumniVerificationStatus;
}>) {
  const response = await fetch(`/api/v1/tpo/alumni/contacts/${encodeURIComponent(contactId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  const payload = await parseApiResponse<AlumniContact>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }
  await Promise.all([
    mutate((key) => typeof key === "string" && key.startsWith("/api/v1/tpo/alumni/contacts")),
    mutate((key) => typeof key === "string" && key.startsWith("/api/v1/tpo/alumni/opportunities")),
    mutate("/api/v1/students/me/alumni-opportunities"),
  ]);
  return payload.data;
}

export async function createAlumniOpportunity(input: {
  type: AlumniOpportunityType;
  title: string;
  description: string;
  alumniContactId: string;
  branches: string[];
  batches: string[];
  academicYears: AlumniAcademicYear[];
  driveId?: string;
  status: AlumniOpportunityStatus;
  studentIds: string[];
  notes?: string;
}) {
  const response = await fetch("/api/v1/tpo/alumni/opportunities", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  const payload = await parseApiResponse<AlumniOpportunity>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }
  await Promise.all([
    mutate((key) => typeof key === "string" && key.startsWith("/api/v1/tpo/alumni/opportunities")),
    mutate("/api/v1/students/me/alumni-opportunities"),
  ]);
  return payload.data;
}

export async function updateAlumniOpportunity(opportunityId: string, input: Partial<{
  type: AlumniOpportunityType;
  title: string;
  description: string;
  alumniContactId: string;
  branches: string[];
  batches: string[];
  academicYears: AlumniAcademicYear[];
  driveId: string | null;
  status: AlumniOpportunityStatus;
  studentIds: string[];
  notes: string;
}>) {
  const response = await fetch(`/api/v1/tpo/alumni/opportunities/${encodeURIComponent(opportunityId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  const payload = await parseApiResponse<AlumniOpportunity>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }
  await Promise.all([
    mutate((key) => typeof key === "string" && key.startsWith("/api/v1/tpo/alumni/opportunities")),
    mutate("/api/v1/students/me/alumni-opportunities"),
  ]);
  return payload.data;
}
