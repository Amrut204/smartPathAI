import { mutate } from "swr";
import useSWR from "swr";
import { withCsrfHeader } from "../utils/csrf";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error: { code: string; message: string; details?: Array<{ field?: string; message: string }> };
  meta?: { pagination?: { cursor: string | null; has_more: boolean; limit: number }; timestamp?: string; correlation_id?: string };
}

function buildApiErrorMessage(payload: ApiResponse<unknown>, fallback = "Request failed") {
  const baseMessage = payload.error?.message?.trim() || fallback;
  const details = payload.error?.details ?? [];
  if (details.length === 0) {
    return baseMessage;
  }

  const detailMessage = details
    .map((detail) => (detail.field ? `${detail.field}: ${detail.message}` : detail.message))
    .join(", ");

  return `${baseMessage}: ${detailMessage}`;
}

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = (await response.json()) as ApiResponse<T>;

  if (!payload.success) {
    throw new Error(buildApiErrorMessage(payload));
  }

  return payload.data;
}

export interface StudentProfile {
  id: string;
  tenant_id: string;
  user_id: string;
  seededProfile: {
    fullName: string;
    collegeEmail: string;
    prn: string;
    rollNumber: string;
    branch: string;
    batch: string;
    cgpa: number | null;
    activeBacklogs: number | null;
    totalHistoricalBacklogs: number | null;
    degree: string;
    currentSemester: string;
    attendancePct: number | null;
  };
  studentEditableProfile: {
    prn: string;
    rollNumber: string;
    branch: string;
    batch: string;
    cgpa: number | null;
    activeBacklogs: number | null;
    totalHistoricalBacklogs: number | null;
    degree: string;
    currentSemester: string;
    attendancePct: number | null;
    phone: string;
    personalEmail: string;
    resumeUrl: string;
    targetRoles: string[];
    preferredLocations: string[];
    willingToRelocate: boolean | null;
    skills: string[];
    linkedIn: string;
    githubUrl: string;
    portfolioUrl: string;
    internships: string;
    projects: string;
    certifications: string;
    achievements: string;
    languages: string[];
    dataConsentAccepted: boolean;
    accuracyDeclarationAccepted: boolean;
  };
  profileCompleteness: {
    pct: number;
    isComplete: boolean;
    completedRequiredFields: number;
    totalRequiredFields: number;
  };
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
      isLocked: boolean;
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
  profileCertificationPreview: {
    studentName: string;
    collegeEmail: string;
    prn: string;
    rollNumber: string;
    branch: string;
    batch: string;
    degree: string;
    currentSemester: string;
    cgpa: number | null;
    activeBacklogs: number | null;
    totalHistoricalBacklogs: number | null;
    attendancePct: number | null;
    personalEmail: string;
    phone: string;
    resumeUrl: string;
    targetRoles: string[];
    preferredLocations: string[];
    willingToRelocate: boolean | null;
    typedValueHint: string;
    snapshotHash: string;
  };
  requiredFields: Array<{
    key: string;
    label: string;
    owner: "seeded" | "student";
    complete: boolean;
  }>;
  missingRequiredFields: Array<{
    key: string;
    label: string;
    owner: "seeded" | "student";
    complete: boolean;
  }>;
  missingSeededFields: Array<{
    key: string;
    label: string;
    owner: "seeded";
    complete: boolean;
  }>;
  missingStudentFields: Array<{
    key: string;
    label: string;
    owner: "student";
    complete: boolean;
  }>;
  pendingCollegeFields: Array<{
    key: string;
    label: string;
    owner: "seeded";
    complete: boolean;
  }>;
  recommendedFields: Array<{
    key: string;
    label: string;
    complete: boolean;
  }>;
  canAccessResources: boolean;
  canAccessMockTests: boolean;
}

export function useStudentProfile() {
  return useSWR<StudentProfile>("/api/v1/students/me", fetcher, {
    revalidateOnFocus: false,
  });
}

export async function acceptOnboardingDeclaration(input: { typedValue: string }) {
  const response = await fetch("/api/v1/students/me/declaration/onboarding-accept", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      accepted: true,
      typedValue: input.typedValue,
    }),
  });

  const payload = (await response.json()) as ApiResponse<StudentProfile>;
  if (!payload.success) {
    throw new Error(buildApiErrorMessage(payload));
  }

  await mutate("/api/v1/students/me");
  await mutate("/api/v1/students/me/dashboard");
  await mutate("/api/v1/students/me/pilot-dashboard");

  return payload.data;
}

export async function getProfileCertificationPreview() {
  const response = await fetch("/api/v1/students/me/profile-certification-preview", {
    credentials: "include",
  });

  const payload = (await response.json()) as ApiResponse<{
    profileCompleteness: StudentProfile["profileCompleteness"];
    declarationStatus: StudentProfile["declarationStatus"];
    certificationPreview: StudentProfile["profileCertificationPreview"];
    materialFieldLabels: string[];
  }>;

  if (!payload.success) {
    throw new Error(buildApiErrorMessage(payload));
  }

  return payload.data;
}

export async function certifyStudentProfile(input: { typedValue: string }) {
  const response = await fetch("/api/v1/students/me/profile-certification", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify({ typedValue: input.typedValue }),
  });

  const payload = (await response.json()) as ApiResponse<StudentProfile>;
  if (!payload.success) {
    throw new Error(buildApiErrorMessage(payload));
  }

  await mutate("/api/v1/students/me");
  await mutate("/api/v1/students/me/dashboard");
  await mutate("/api/v1/students/me/pilot-dashboard");
  await mutate("/api/v1/students/my-risk-score");

  return payload.data;
}

export async function updateStudentProfile(input: {
  skills?: string[];
  prn?: string;
  rollNumber?: string;
  branch?: string;
  batch?: string;
  degree?: string;
  currentSemester?: string;
  cgpa?: number | null;
  activeBacklogs?: number | null;
  totalHistoricalBacklogs?: number | null;
  attendancePct?: number | null;
  phone?: string;
  personalEmail?: string;
  resumeUrl?: string;
  targetRoles?: string[];
  preferredLocations?: string[];
  willingToRelocate?: boolean;
  linkedIn?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  internships?: string;
  projects?: string;
  certifications?: string;
  achievements?: string;
  languages?: string[];
  dataConsentAccepted?: boolean;
  accuracyDeclarationAccepted?: boolean;
}): Promise<StudentProfile> {
  const response = await fetch("/api/v1/students/me", {
    method: "PATCH",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<StudentProfile>;

  if (!payload.success) {
    throw new Error(buildApiErrorMessage(payload));
  }

  await mutate("/api/v1/students/me");
  await mutate("/api/v1/students/me/dashboard");
  await mutate("/api/v1/students/me/pilot-dashboard");
  await mutate("/api/v1/students/my-risk-score");

  return payload.data;
}
