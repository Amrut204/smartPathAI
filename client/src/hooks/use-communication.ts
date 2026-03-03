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

export function useCommunicationTemplates() {
  return useSWR<
    Array<{
      id: string;
      name: string;
      slug: string;
      subject: string;
      body: string;
      isSystem: boolean;
    }>
  >("/api/v1/communication/templates", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useCommunicationHistory() {
  type CommunicationHistoryItem = {
    id: string;
    subject: string;
    status: string;
    provider: string | null;
    recipientCount: number;
    sentAt: string | null;
    createdAt: string;
  };

  return useSWR<
    {
      items: CommunicationHistoryItem[];
      hasMore: boolean;
      nextCursor: string | null;
    }
  >("/api/v1/communication/history?limit=50", fetcher, {
    revalidateOnFocus: false,
  });
}

export async function sendCommunication(input: {
  templateId?: string;
  subject?: string;
  body?: string;
  variables?: Record<string, string>;
  filters?: {
    driveId?: string;
    eligibleOnly?: boolean;
    batch?: string;
    branch?: string;
    minCgpa?: number;
  };
}) {
  const response = await fetch("/api/v1/communication/send", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<{
    communicationId: string;
    recipientCount: number;
    status: string;
  }>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await mutate("/api/v1/communication/history?limit=50");
  return payload.data;
}

export async function createCommunicationTemplate(input: {
  name: string;
  slug: string;
  subject: string;
  body: string;
}) {
  const response = await fetch("/api/v1/communication/templates", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<{ id: string }>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await mutate("/api/v1/communication/templates");
  return payload.data;
}
