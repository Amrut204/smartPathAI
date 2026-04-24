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
    throw new Error("Support API returned an unexpected response. Refresh the page and try again.");
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

export type SupportTicketDestinationRole = "tpo" | "hod";
export type SupportTicketType = "grievance" | "suggestion" | "feedback";
export type SupportTicketCategory =
  | "placement_process"
  | "drive_eligibility"
  | "profile_or_resume"
  | "mock_tests"
  | "resources"
  | "technical_issue"
  | "harassment_or_misconduct"
  | "general_feedback";
export type SupportTicketPriority = "low" | "medium" | "high" | "urgent";
export type SupportTicketStatus = "open" | "in_review" | "resolved" | "closed" | "rejected";

export interface SupportTicketSummary {
  id: string;
  destinationRole: SupportTicketDestinationRole;
  destinationDepartment: string | null;
  ticketType: SupportTicketType;
  category: SupportTicketCategory;
  title: string;
  description: string;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  confidential: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  resolutionNote: string | null;
  createdBy: {
    userId: string;
    role: "student" | "tpo" | "admin" | "hod";
    fullName: string;
    email: string;
  };
  assignedTo: {
    userId: string;
    fullName: string;
    email: string;
  } | null;
}

export interface SupportTicketDetail extends SupportTicketSummary {
  events: Array<{
    id: string;
    eventType: string;
    actorUserId: string;
    actorRole: "student" | "tpo" | "admin" | "hod";
    note: string | null;
    changes: Record<string, unknown>;
    createdAt: string;
  }>;
}

function ownerPrefix(owner: "tpo" | "hod") {
  return owner === "hod" ? "/api/v1/hod/support" : "/api/v1/tpo/support";
}

export function useMySupportTickets() {
  return useSWR<SupportTicketSummary[]>("/api/v1/support/tickets/me", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useSupportOwnerTickets(owner: "tpo" | "hod", params: {
  status?: SupportTicketStatus;
  category?: SupportTicketCategory;
  priority?: SupportTicketPriority;
  submitterRole?: "student" | "tpo" | "hod";
  assignedToMe?: boolean;
  q?: string;
}) {
  const search = new URLSearchParams();
  search.set("limit", "50");
  if (params.status) search.set("status", params.status);
  if (params.category) search.set("category", params.category);
  if (params.priority) search.set("priority", params.priority);
  if (params.submitterRole) search.set("submitterRole", params.submitterRole);
  if (params.assignedToMe) search.set("assignedToMe", "true");
  if (params.q) search.set("q", params.q);

  return useSWR<{
    counts: { open: number; inReview: number; resolved: number };
    items: SupportTicketSummary[];
  }>(`${ownerPrefix(owner)}/tickets?${search.toString()}`, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useTpoSupportTickets(params: {
  status?: SupportTicketStatus;
  category?: SupportTicketCategory;
  priority?: SupportTicketPriority;
  submitterRole?: "student" | "tpo" | "hod";
  assignedToMe?: boolean;
  q?: string;
}) {
  return useSupportOwnerTickets("tpo", params);
}

export function useHodSupportTickets(params: {
  status?: SupportTicketStatus;
  category?: SupportTicketCategory;
  priority?: SupportTicketPriority;
  submitterRole?: "student" | "tpo" | "hod";
  assignedToMe?: boolean;
  q?: string;
}) {
  return useSupportOwnerTickets("hod", params);
}

export function useSupportOwnerTicket(owner: "tpo" | "hod", ticketId: string | null) {
  return useSWR<SupportTicketDetail>(
    ticketId ? `${ownerPrefix(owner)}/tickets/${encodeURIComponent(ticketId)}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );
}

export function useTpoSupportTicket(ticketId: string | null) {
  return useSupportOwnerTicket("tpo", ticketId);
}

export function useHodSupportTicket(ticketId: string | null) {
  return useSupportOwnerTicket("hod", ticketId);
}

export async function createSupportTicket(input: {
  ticketType: SupportTicketType;
  category: SupportTicketCategory;
  title: string;
  description: string;
  priority: SupportTicketPriority;
  destinationRole: SupportTicketDestinationRole;
  confidential?: boolean;
}) {
  const response = await fetch("/api/v1/support/tickets", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  const payload = await parseApiResponse<SupportTicketSummary>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }

  await Promise.all([
    mutate("/api/v1/support/tickets/me"),
    mutate((key) => typeof key === "string" && key.startsWith("/api/v1/tpo/support/tickets?")),
    mutate((key) => typeof key === "string" && key.startsWith("/api/v1/hod/support/tickets?")),
  ]);
  return payload.data;
}

export async function updateSupportTicket(owner: "tpo" | "hod", ticketId: string, input: {
  status?: SupportTicketStatus;
  priority?: SupportTicketPriority;
  assignedToUserId?: string | null;
  resolutionNote?: string | null;
  confidential?: boolean;
}) {
  const response = await fetch(`${ownerPrefix(owner)}/tickets/${encodeURIComponent(ticketId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  const payload = await parseApiResponse<SupportTicketDetail>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }

  await Promise.all([
    mutate(`${ownerPrefix(owner)}/tickets/${encodeURIComponent(ticketId)}`),
    mutate((key) => typeof key === "string" && key.startsWith(`${ownerPrefix(owner)}/tickets?`)),
    mutate("/api/v1/support/tickets/me"),
  ]);
  return payload.data;
}

export async function resolveSupportTicket(owner: "tpo" | "hod", ticketId: string, input: {
  resolutionNote: string;
  status?: "resolved" | "closed" | "rejected";
}) {
  const response = await fetch(`${ownerPrefix(owner)}/tickets/${encodeURIComponent(ticketId)}/resolve`, {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  const payload = await parseApiResponse<SupportTicketDetail>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }

  await Promise.all([
    mutate(`${ownerPrefix(owner)}/tickets/${encodeURIComponent(ticketId)}`),
    mutate((key) => typeof key === "string" && key.startsWith(`${ownerPrefix(owner)}/tickets?`)),
    mutate("/api/v1/support/tickets/me"),
  ]);
  return payload.data;
}
