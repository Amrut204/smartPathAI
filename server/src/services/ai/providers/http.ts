import {
  ProviderName,
  createProviderHttpError,
  createProviderNetworkError,
} from "./provider.types.js";

interface PostJsonInput {
  provider: ProviderName;
  url: string;
  timeoutMs: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export async function postJson(input: PostJsonInput): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...input.headers,
      },
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });

    const raw = await response.text();
    if (!response.ok) {
      throw createProviderHttpError(input.provider, response.status, raw);
    }

    if (!raw.trim()) return {};
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw createProviderHttpError(input.provider, 502, `${input.provider} returned non-JSON payload`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ProviderError") {
      throw error;
    }
    throw createProviderNetworkError(input.provider, error, input.timeoutMs);
  } finally {
    clearTimeout(timeout);
  }
}

