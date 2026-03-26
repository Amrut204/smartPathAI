export type ProviderName = "gemini" | "groq" | "openrouter";

export interface ProviderRequest {
  prompt: string;
  timeoutMs: number;
}

export interface ProviderResponse {
  provider: ProviderName;
  model: string;
  text: string;
}

export class ProviderError extends Error {
  provider: ProviderName;
  status: number;
  retryable: boolean;
  code?: string;

  constructor(params: {
    provider: ProviderName;
    message: string;
    status?: number;
    retryable?: boolean;
    code?: string;
  }) {
    super(params.message);
    this.name = "ProviderError";
    this.provider = params.provider;
    this.status = params.status ?? 500;
    this.retryable = params.retryable ?? false;
    this.code = params.code;
  }
}

function coerceStatus(status: number): number {
  if (Number.isFinite(status) && status >= 100 && status <= 599) {
    return status;
  }
  return 500;
}

export function createProviderHttpError(
  provider: ProviderName,
  status: number,
  bodyText: string,
): ProviderError {
  const safeStatus = coerceStatus(status);
  const retryable = safeStatus === 429 || safeStatus >= 500;
  const message = bodyText.trim().slice(0, 400) || `${provider} request failed`;
  return new ProviderError({
    provider,
    status: safeStatus,
    retryable,
    message,
    code: safeStatus === 429 ? "RATE_LIMIT" : undefined,
  });
}

export function createProviderNetworkError(
  provider: ProviderName,
  error: unknown,
  timeoutMs: number,
): ProviderError {
  const raw = error as { name?: string; message?: string };
  const isAbort = raw?.name === "AbortError";
  return new ProviderError({
    provider,
    status: 503,
    retryable: true,
    code: isAbort ? "TIMEOUT" : "NETWORK_ERROR",
    message: isAbort
      ? `${provider} timed out after ${timeoutMs}ms`
      : raw?.message || `${provider} network error`,
  });
}
