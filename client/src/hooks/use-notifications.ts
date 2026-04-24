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
      throw new Error("Notification routes are not active in the running server yet. Refresh once, and if it continues, restart the server process.");
    }

    throw new Error("Notification API returned HTML instead of JSON. Refresh the page, and if it continues, restart the client and server dev processes.");
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

export type NotificationPriority = "normal" | "important" | "urgent";
export type NotificationKind = "announcement" | "action";
export type NotificationType =
  | "announcement_published"
  | "drive_published"
  | "drive_deadline_reminder"
  | "result_released"
  | "grievance_created"
  | "grievance_updated"
  | "feedback_assigned"
  | "feedback_response_received"
  | "report_pack_ready"
  | "automation_review_ready";
export type NotificationView = "all" | "unread" | "announcements" | "actions";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  kind: NotificationKind;
  priority: NotificationPriority;
  title: string;
  message: string;
  targetPath: string | null;
  targetEntityId: string | null;
  sourceType: string | null;
  sourceId: string | null;
  metadata: Record<string, unknown>;
  readAt: string | null;
  seenAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NotificationListResponse = {
  unreadCount: number;
  items: NotificationItem[];
};

function notificationKey(view: NotificationView = "all", limit = 20) {
  return `/api/v1/notifications/me?view=${encodeURIComponent(view)}&limit=${limit}`;
}

export function mutateNotifications() {
  return mutate((key) => typeof key === "string" && key.startsWith("/api/v1/notifications/me"));
}

export function useNotifications(params?: { view?: NotificationView; limit?: number }) {
  const view = params?.view ?? "all";
  const limit = params?.limit ?? 20;
  return useSWR<NotificationListResponse>(notificationKey(view, limit), fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 30_000,
  });
}

export async function markNotificationRead(notificationId: string) {
  const response = await fetch(`/api/v1/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
  });

  const payload = await parseApiResponse<{ notificationId: string; readAt: string }>(response);

  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }

  await Promise.all([
    mutateNotifications(),
    mutate("/api/v1/students/me/announcements?limit=20"),
  ]);
  return payload.data;
}

export async function markAllNotificationsRead() {
  const response = await fetch("/api/v1/notifications/mark-all-read", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
  });

  const payload = await parseApiResponse<{ readAt: string }>(response);

  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }

  await Promise.all([
    mutateNotifications(),
    mutate("/api/v1/students/me/announcements?limit=20"),
  ]);
  return payload.data;
}
