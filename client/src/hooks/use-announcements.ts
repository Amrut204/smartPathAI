import { mutate } from "swr";
import useSWR from "swr";

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
    if (response.status === 404) {
      throw new Error("Announcement routes are not active in the running server yet. Refresh once, and if it continues, restart the server process.");
    }

    throw new Error("Announcement API returned HTML instead of JSON. Refresh the page, and if it continues, restart the client and server dev processes.");
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

export type AnnouncementPriority = "normal" | "important" | "urgent";
export type AnnouncementAudienceMode = "all_students" | "drive_specific" | "custom";
export type DriveAudienceScope = "eligible" | "appearing_applied" | "both";

export type AnnouncementFilters = {
  audienceMode?: AnnouncementAudienceMode;
  driveAudienceScope?: DriveAudienceScope;
  q?: string;
  prn?: string;
  driveId?: string;
  eligibleOnly?: boolean;
  batch?: string;
  branch?: string;
  minCgpa?: number;
  cgpaMax?: number;
  backlogsMin?: number;
  backlogsMax?: number;
  maxActiveBacklogs?: number;
  totalHistoricalBacklogsMin?: number;
  totalHistoricalBacklogsMax?: number;
  maxTotalBacklogs?: number;
  minAttendance?: number;
  attendanceMax?: number;
  readinessMin?: number;
  readinessMax?: number;
  profileCompletenessMin?: number;
  profileCompletenessMax?: number;
  tenthMarksMin?: number;
  tenthMarksMax?: number;
  twelfthMarksMin?: number;
  twelfthMarksMax?: number;
  diplomaMarksMin?: number;
  diplomaMarksMax?: number;
  waitingOnStudent?: boolean;
  waitingOnCollege?: boolean;
  hasResume?: boolean;
  isCertified?: boolean;
  canAccessResources?: boolean;
  canAccessMockTests?: boolean;
  targetRole?: string;
  preferredLocation?: string;
  willingToRelocate?: boolean;
  eligibleForUpcomingDrive?: boolean;
  isPlaced?: boolean;
  isActive7d?: boolean;
  appliedRecently?: boolean;
  needsIntervention?: boolean;
  maxRecipients?: number;
  emails?: string[];
  studentIds?: string[];
};

export function useAnnouncementHistory() {
  return useSWR<Array<{
    id: string;
    title: string;
    message: string;
    priority: AnnouncementPriority;
    audienceSummary: string;
    relatedDriveName: string | null;
    recipientCount: number;
    status: "published" | "expired" | "archived";
    showPopup: boolean;
    publishedAt: string;
    expiresAt: string | null;
    createdAt: string;
  }>>("/api/v1/communication/announcements?limit=20", fetcher, {
    revalidateOnFocus: false,
  });
}

export async function previewAnnouncement(input: {
  title: string;
  message: string;
  priority: AnnouncementPriority;
  relatedDriveId?: string;
  expiresAt?: string;
  filters?: AnnouncementFilters;
}) {
  const response = await fetch("/api/v1/communication/announcements/preview", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  const payload = await parseApiResponse<{
    recipientCount: number;
    sampleRecipients: Array<{
      studentId: string;
      fullName: string;
      email: string;
      driveName: string | null;
    }>;
    audienceSummary: string;
    preview: {
      title: string;
      message: string;
      priority: AnnouncementPriority;
      relatedDriveName: string | null;
      expiresAt: string | null;
      showPopup: boolean;
    };
  }>(response);

  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }

  return payload.data;
}

export async function publishAnnouncement(input: {
  title: string;
  message: string;
  priority: AnnouncementPriority;
  relatedDriveId?: string;
  expiresAt?: string;
  filters?: AnnouncementFilters;
}) {
  const response = await fetch("/api/v1/communication/announcements", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  const payload = await parseApiResponse<{
    announcementId: string;
    recipientCount: number;
    status: "published" | "expired" | "archived";
  }>(response);

  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }

  await mutate("/api/v1/communication/announcements?limit=20");
  await mutate("/api/v1/students/me/announcements?limit=20");
  return payload.data;
}

export function useStudentAnnouncements() {
  return useSWR<Array<{
    id: string;
    title: string;
    message: string;
    priority: AnnouncementPriority;
    relatedDriveName: string | null;
    showPopup: boolean;
    publishedAt: string;
    expiresAt: string | null;
    readAt: string | null;
    dismissedPopupAt: string | null;
    seenOnDashboardAt: string | null;
    unread: boolean;
    popupEligible: boolean;
    hasNavIndicator: boolean;
  }>>("/api/v1/students/me/announcements?limit=20", fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 30_000,
  });
}

export async function markAnnouncementRead(announcementId: string) {
  const response = await fetch(`/api/v1/students/me/announcements/${encodeURIComponent(announcementId)}/read`, {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
  });

  const payload = await parseApiResponse<{ announcementId: string; readAt: string }>(response);

  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }

  await mutate("/api/v1/students/me/announcements?limit=20");
  return payload.data;
}

export async function dismissAnnouncementPopup(announcementId: string) {
  const response = await fetch(`/api/v1/students/me/announcements/${encodeURIComponent(announcementId)}/dismiss-popup`, {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
  });

  const payload = await parseApiResponse<{ announcementId: string; dismissedPopupAt: string }>(response);

  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }

  await mutate("/api/v1/students/me/announcements?limit=20");
  return payload.data;
}

export async function markAnnouncementsSeen() {
  const response = await fetch("/api/v1/students/me/announcements/mark-seen", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
  });

  const payload = await parseApiResponse<{ count: number; seenAt: string }>(response);

  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }

  await mutate("/api/v1/students/me/announcements?limit=20");
  return payload.data;
}
