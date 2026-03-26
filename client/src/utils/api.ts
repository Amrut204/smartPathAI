export type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  meta?: {
    pagination?: {
      cursor: string | null;
      has_more: boolean;
      limit: number;
    };
    timestamp?: string;
    correlation_id?: string;
  };
  error?: {
    code?: string;
    message: string;
    details?: Array<{ field?: string; message: string }>;
  };
};

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: Array<{ field?: string; message: string }>;

  constructor(message: string, options?: { status?: number; code?: string; details?: Array<{ field?: string; message: string }> }) {
    super(message);
    this.name = "ApiError";
    this.status = options?.status ?? 500;
    this.code = options?.code;
    this.details = options?.details;
  }
}

function truncate(value: string, length = 160) {
  return value.length <= length ? value : `${value.slice(0, length)}...`;
}

export function buildUnexpectedResponseMessage(response: Response, bodyText: string, label = "API") {
  const trimmed = bodyText.trim();
  const lowered = trimmed.toLowerCase();

  if (response.status === 429) {
    return `${label} is rate limited right now. Wait a moment and try again.`;
  }

  if ((response.status === 502 || response.status === 503 || response.status === 504) && trimmed.length === 0) {
    return `${label} is temporarily unavailable. Check the backend service and try again.`;
  }

  if (lowered.startsWith("<!doctype") || lowered.startsWith("<html")) {
    return `${label} returned an HTML page instead of JSON. Check the frontend proxy and backend service.`;
  }

  if (trimmed.length > 0) {
    return `${label} returned an unexpected response: ${truncate(trimmed)}`;
  }

  return `${label} returned an empty response.`;
}

export async function parseApiEnvelope<T>(response: Response, label = "API"): Promise<{
  data: T;
  meta?: ApiEnvelope<T>["meta"];
}> {
  const bodyText = await response.text();
  let payload: ApiEnvelope<T> | null = null;

  try {
    payload = JSON.parse(bodyText) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(buildUnexpectedResponseMessage(response, bodyText, label), { status: response.status });
  }

  if (!response.ok || !payload.success) {
    const details = payload.error?.details ?? [];
    const detailMessage = details.length > 0
      ? details.map((detail) => detail.field ? `${detail.field}: ${detail.message}` : detail.message).join(", ")
      : "";
    const baseMessage = payload.error?.message?.trim() || `Request failed with status ${response.status}`;
    const message = detailMessage ? `${baseMessage}: ${detailMessage}` : baseMessage;
    throw new ApiError(message, {
      status: response.status,
      code: payload.error?.code,
      details,
    });
  }

  return {
    data: payload.data,
    meta: payload.meta,
  };
}

export async function parseApiResponse<T>(response: Response, label = "API"): Promise<T> {
  const payload = await parseApiEnvelope<T>(response, label);
  return payload.data;
}

export async function requestJson<T>(url: string, init: RequestInit, label = "API"): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError(`Unable to reach ${label.toLowerCase()}. Check the network or backend service and try again.`);
  }

  return parseApiResponse<T>(response, label);
}
