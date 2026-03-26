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

export function useAiConversations() {
  return useSWR<
    Array<{
      id: string;
      topic: string;
      model: string;
      updatedAt: string;
      preview: string;
    }>
  >("/api/v1/ai/conversations", fetcher, { revalidateOnFocus: false });
}

export function useAiConversation(conversationId: string | null) {
  return useSWR<{
    id: string;
    topic: string;
    model: string;
    messages: Array<{ role: "user" | "assistant" | "system"; content: string; timestamp: string }>;
  }>(conversationId ? `/api/v1/ai/conversations/${conversationId}` : null, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useAiUsage() {
  return useSWR<{
    userTokensToday: number;
    userTokenLimit: number;
    tenantTokensToday: number;
    tenantTokenLimit: number;
    groqBudget?: {
      enabled: boolean;
      requestCount: number;
      requestLimit: number | null;
      tokenCount: number;
      tokenLimit: number | null;
      estimatedCostUsd: number;
      costLimitUsd: number | null;
      warning: boolean;
      blocked: boolean;
      message: string | null;
    };
  }>("/api/v1/ai/usage", fetcher, { revalidateOnFocus: false });
}

export async function streamAiChat(params: {
  message: string;
  conversationId?: string;
  onToken: (token: string) => void;
  onDone: (payload: {
    conversationId: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  }) => void;
}) {
  const response = await fetch("/api/v1/ai/chat", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      message: params.message,
      conversationId: params.conversationId,
    }),
  });

  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    if (contentType.includes("application/json")) {
      const payload = (await response.json().catch(() => null)) as ApiResponse<unknown> | null;
      if (payload && !payload.success) {
        throw new Error(payload.error.message || "Unable to get AI response");
      }
      throw new Error(`Unable to get AI response (status ${response.status})`);
    }

    const text = await response.text();
    throw new Error(text || `Unable to get AI response (status ${response.status})`);
  }

  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as ApiResponse<{
      conversationId: string;
      response: string;
      tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
      groqBudget?: {
        warning?: boolean;
        blocked?: boolean;
        message?: string | null;
      };
    }>;

    if (!payload.success) {
      throw new Error(payload.error.message);
    }

    if (payload.data.response) {
      params.onToken(payload.data.response);
    }

    params.onDone({
      conversationId: payload.data.conversationId,
      usage: payload.data.tokenUsage,
    });
    return;
  }

  if (!response.body) {
    throw new Error("Unable to read AI response");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";

    for (const chunk of lines) {
      const line = chunk.trim();
      if (!line.startsWith("data: ")) {
        continue;
      }

      const payload = JSON.parse(line.slice(6)) as {
        token?: string;
        done?: boolean;
        conversationId?: string;
        usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
      };

      if (payload.token) {
        params.onToken(payload.token);
      }

      if (payload.done && payload.conversationId) {
        params.onDone({
          conversationId: payload.conversationId,
          usage: payload.usage,
        });
      }
    }
  }
}

export async function askAiOnce(message: string, conversationId?: string) {
  const response = await fetch("/api/v1/ai/chat", {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      message,
      conversationId,
    }),
  });

  const payload = (await response.json()) as ApiResponse<{
    conversationId: string;
    model: string;
    topic: string;
    response: string;
    tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    groqBudget?: {
      warning?: boolean;
      blocked?: boolean;
      message?: string | null;
    };
  }>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}
