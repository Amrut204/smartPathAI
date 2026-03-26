import { postJson } from "./http.js";
import { ProviderError, ProviderRequest, ProviderResponse } from "./provider.types.js";

function extractGroqText(payload: unknown): string {
  const choice = (payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0];
  return String(choice?.message?.content ?? "").trim();
}

export async function callGroq(
  apiKey: string,
  model: string,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  const payload = await postJson({
    provider: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    timeoutMs: request.timeoutMs,
    headers: {
      Authorization: `Bearer ${apiKey}`,
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

  const text = extractGroqText(payload);
  if (!text) {
    throw new ProviderError({
      provider: "groq",
      status: 502,
      retryable: true,
      code: "EMPTY_RESPONSE",
      message: "groq returned empty response",
    });
  }

  return {
    provider: "groq",
    model,
    text,
  };
}

