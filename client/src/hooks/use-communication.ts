import { mutate } from "swr";
import useSWR from "swr";
import { withCsrfHeader } from "../utils/csrf";

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
    updatedAt: string;
    topFailureReason: string | null;
    sent: number;
    failed: number;
    delivery: {
      delivered: number;
      opened: number;
      bounced: number;
      blocked: number;
    };
  };

  return useSWR<
    {
      items: CommunicationHistoryItem[];
      hasMore: boolean;
      nextCursor: string | null;
    }
  >("/api/v1/communication/history?limit=50", async (url: string) => {
    const raw = await fetcher<{
      items?: CommunicationHistoryItem[];
      hasMore?: boolean;
      nextCursor?: string | null;
    }>(url);

    // Defensive: ensure items is always an array even if the API shape changes
    return {
      items: Array.isArray(raw?.items) ? raw.items : [],
      hasMore: Boolean(raw?.hasMore),
      nextCursor: raw?.nextCursor ?? null,
    };
  }, {
    revalidateOnFocus: false,
    refreshInterval: (data) => {
      if (!data || !Array.isArray(data.items) || data.items.length === 0) {
        return 10_000;
      }

      const hasInFlight = data.items.some((item) =>
        item.status === "queued" || item.status === "processing");
      return hasInFlight ? 3_000 : 10_000;
    },
  });
}

export async function previewCommunication(input: {
  templateId?: string;
  subject?: string;
  body?: string;
  filters?: {
    driveId?: string;
    eligibleOnly?: boolean;
    batch?: string;
    branch?: string;
    minCgpa?: number;
    maxRecipients?: number;
  };
}) {
  const response = await fetch("/api/v1/communication/preview", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<{
    mode: "resend";
    queueBackend: "inline";
    sender: {
      fromEmail: string;
      fromName: string;
      replyToEmail: string | null;
      tenantName: string;
      senderSource: "tenant" | "platform-fallback";
      displayFrom: string;
    };
    recipientCount: number;
    sampleRecipients: Array<{
      studentId: string;
      fullName: string;
      email: string;
      driveName: string | null;
    }>;
    subject: string | null;
    bodyPreview: string | null;
  }>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
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
    maxRecipients?: number;
  };
}) {
  const response = await fetch("/api/v1/communication/send", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<{
    communicationId: string;
    recipientCount: number;
    status: string;
    mode: "resend";
    queueBackend: "inline";
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
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<{ id: string }>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await mutate("/api/v1/communication/templates");
  return payload.data;
}
