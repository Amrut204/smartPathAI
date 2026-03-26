import { AppError } from "../../middleware/error-handler.js";
import { detectTopic } from "./ai-helpers.js";
import { AICacheService } from "./cache.service.js";
import { callGroq } from "./providers/groq.provider.js";
import { ProviderError } from "./providers/provider.types.js";

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_CACHE_TTL_SEC = 21_600;

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "YOUR_GROQ_API_KEY_HERE";

function parseNumberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const AI_TIMEOUT_MS = parseNumberEnv(process.env.AI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
const AI_CACHE_TTL_SEC = parseNumberEnv(process.env.AI_CACHE_TTL_SEC, DEFAULT_CACHE_TTL_SEC);

function isPlaceholderKey(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized.includes("your_") || normalized.includes("<your-") || normalized === "placeholder";
}

function buildFallbackResponse(message: string, topic: string): string {
  const intro = [
    "Local fallback answer is active because Groq is not currently available.",
    "Set GROQ_API_KEY in server/.env to enable the deployed AI assistant.",
  ];

  if (topic === "dsa") {
    return [
      ...intro,
      "1. Start with brute-force and mention time complexity.",
      "2. Identify data structures to optimize.",
      "3. Validate with a small dry run.",
      `Question: ${message.slice(0, 120)}`,
    ].join("\n");
  }

  if (topic === "aptitude") {
    return [
      ...intro,
      "1. Convert words to equations.",
      "2. Compute carefully and verify units.",
      "3. Check answer choices by approximation.",
      `Question: ${message.slice(0, 120)}`,
    ].join("\n");
  }

  return [
    ...intro,
    "1. Break the problem into smaller steps.",
    "2. Solve one small example first.",
    "3. Generalize the final method.",
    `Question: ${message.slice(0, 120)}`,
  ].join("\n");
}

function providerModel(): string {
  return process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
}

function normalizeProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const generic = error as { message?: string };
  return new ProviderError({
    provider: "groq",
    status: 500,
    retryable: true,
    message: generic?.message ?? "groq failed",
  });
}

export const AIFailoverService = {
  async generate(input: {
    tenantId: string;
    cleanedMessage: string;
    prompt: string;
  }) {
    const topic = detectTopic(input.cleanedMessage);
    const cacheKey = AICacheService.buildKey({
      tenantId: input.tenantId,
      prompt: input.prompt,
      topic,
    });

    const cached = await AICacheService.get(cacheKey);
    if (cached) {
      return {
        response: cached.response,
        provider: cached.provider,
        model: cached.model,
        topic,
        cacheHit: true,
      };
    }

    if (isPlaceholderKey(GROQ_API_KEY)) {
      if (process.env.NODE_ENV !== "production") {
        return {
          response: buildFallbackResponse(input.cleanedMessage, topic),
          provider: "local-fallback",
          model: "local-fallback",
          topic,
          cacheHit: false,
        };
      }

      throw new AppError(
        "AI_PROVIDER_ERROR",
        "Groq AI is not configured for this deployment.",
        503,
      );
    }

    const model = providerModel();
    try {
      const result = await callGroq(GROQ_API_KEY, model, {
        prompt: input.prompt,
        timeoutMs: AI_TIMEOUT_MS,
      });
      await AICacheService.set(cacheKey, {
        response: result.text,
        provider: result.provider,
        model: result.model,
      }, AI_CACHE_TTL_SEC);

      return {
        response: result.text,
        provider: result.provider,
        model: result.model,
        topic,
        cacheHit: false,
      };
    } catch (error) {
      const providerError = normalizeProviderError(error);
      const safeMessage = providerError.code === "RATE_LIMIT"
        ? "Groq AI rate limit reached. Please try again later."
        : "Groq AI is temporarily unavailable. Please try again shortly.";

      throw new AppError(
        "AI_PROVIDER_ERROR",
        safeMessage,
        providerError.status >= 400 && providerError.status <= 599 ? providerError.status : 502,
      );
    }
  },
};
