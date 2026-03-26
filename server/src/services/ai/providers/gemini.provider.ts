import { postJson } from "./http.js";
import { ProviderError, ProviderRequest, ProviderResponse } from "./provider.types.js";

function extractGeminiText(payload: unknown): string {
  const candidate = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    ?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text ?? "";
  return String(text ?? "").trim();
}

export async function callGemini(
  apiKey: string,
  model: string,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  const payload = await postJson({
    provider: "gemini",
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    timeoutMs: request.timeoutMs,
    headers: {},
    body: {
      contents: [
        {
          role: "user",
          parts: [{ text: request.prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 900,
      },
    },
  });

  const text = extractGeminiText(payload);
  if (!text) {
    throw new ProviderError({
      provider: "gemini",
      status: 502,
      retryable: true,
      code: "EMPTY_RESPONSE",
      message: "gemini returned empty response",
    });
  }

  return {
    provider: "gemini",
    model,
    text,
  };
}
