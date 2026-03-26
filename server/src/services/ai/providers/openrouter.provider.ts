import { postJson } from "./http.js";
import { ProviderError, ProviderRequest, ProviderResponse } from "./provider.types.js";

function extractOpenRouterText(payload: unknown): string {
  const choice = (payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0];
  return String(choice?.message?.content ?? "").trim();
}

export async function callOpenRouter(
  apiKey: string,
  model: string,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  const payload = await postJson({
    provider: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    timeoutMs: request.timeoutMs,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.APP_URL ?? "http://localhost:5173",
      "X-Title": process.env.APP_NAME ?? "CampusDrive AI",
    },
    body: {
      model,
      messages: [
        {
          role: "user",
          content: request.prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 900,
    },
  });

  const text = extractOpenRouterText(payload);
  if (!text) {
    throw new ProviderError({
      provider: "openrouter",
      status: 502,
      retryable: true,
      code: "EMPTY_RESPONSE",
      message: "openrouter returned empty response",
    });
  }

  return {
    provider: "openrouter",
    model,
    text,
  };
}

