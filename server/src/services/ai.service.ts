import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { StudentRepository } from "../repositories/student.repository.js";
import {
  INPUT_LIMIT,
  OUTPUT_CHAR_LIMIT,
  buildSystemPrompt,
  detectInjection,
  detectTopic,
  estimateTokens,
  pickModel,
  stripPii,
} from "./ai/ai-helpers.js";
import { getEnvVar } from "../utils/env.js";
import { getMongoDb } from "../utils/mongodb.js";

type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: string;
};

const USER_REQUESTS_PER_MINUTE = 20;
const USER_TOKENS_PER_DAY = 10_000;
const TENANT_TOKENS_PER_DAY = 500_000;
const GLOBAL_CONCURRENT_REQUESTS = 5;

const requestWindow = new Map<string, number[]>();
let activeGlobalRequests = 0;

function extractTextFromGemini(payload: unknown): string {
  const candidate = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    ?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text ?? "";
  return String(text);
}

function isPlaceholderGeminiKey(apiKey: string): boolean {
  const key = apiKey.trim().toLowerCase();
  return (
    !key ||
    key === "placeholder" ||
    key.includes("<your-gemini") ||
    key.includes("placeholder")
  );
}

function buildLocalFallbackResponse(message: string, topic: string): string {
  const common = [
    "Local fallback answer is active because GEMINI is not configured in this environment.",
    "Set GEMINI_API_KEY in server/.env to use Gemini responses.",
  ];

  if (topic === "aptitude") {
    return [
      ...common,
      "Aptitude tip:",
      "1. Translate the question into variables before calculating.",
      "2. Estimate first, then compute exactly to avoid mistakes.",
      `Practice prompt: ${message.slice(0, 120)}`,
    ].join("\n");
  }

  if (topic === "dsa") {
    return [
      ...common,
      "DSA tip:",
      "1. State brute force, then optimize with data structures.",
      "2. Track time and space complexity for each approach.",
      `Focus question: ${message.slice(0, 120)}`,
    ].join("\n");
  }

  if (topic === "interview") {
    return [
      ...common,
      "Interview tip:",
      "1. Use STAR format (Situation, Task, Action, Result).",
      "2. Keep each answer under 90 seconds.",
      `Practice prompt: ${message.slice(0, 120)}`,
    ].join("\n");
  }

  return [
    ...common,
    "Study tip:",
    "1. Break the question into 2-3 subproblems.",
    "2. Solve one example manually, then generalize.",
    `Question: ${message.slice(0, 120)}`,
  ].join("\n");
}

function normalizeGeminiErrorMessage(rawText: string): AppError {
  const fallbackMessage = "Gemini is temporarily unavailable. Please try again shortly.";

  try {
    const parsed = JSON.parse(rawText) as {
      error?: { code?: number; status?: string; message?: string };
    };
    const providerError = parsed.error;
    const providerStatus = String(providerError?.status ?? "");
    const providerMessage = String(providerError?.message ?? "").trim();
    const providerCode = Number(providerError?.code ?? 0);

    if (providerStatus === "RESOURCE_EXHAUSTED" || providerCode === 429) {
      return new AppError(
        "AI_PROVIDER_QUOTA_EXCEEDED",
        "Gemini quota exceeded. Please try again later or update your billing/quota settings.",
        429,
      );
    }

    if (providerStatus === "INVALID_ARGUMENT" && /api key/i.test(providerMessage)) {
      return new AppError(
        "AI_PROVIDER_INVALID_KEY",
        "Gemini API key is invalid. Update GEMINI_API_KEY in server/.env and restart the server.",
        502,
      );
    }

    if (providerMessage) {
      return new AppError("AI_PROVIDER_ERROR", providerMessage, 502);
    }
  } catch {
    // Keep fallback handling below when provider response is not JSON.
  }

  return new AppError("AI_PROVIDER_ERROR", fallbackMessage, 502);
}

async function callGemini(model: string, prompt: string, apiKey: string): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 1500,
        temperature: 0.3,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw normalizeGeminiErrorMessage(text || "");
  }

  const payload = (await response.json()) as unknown;
  const text = extractTextFromGemini(payload);

  if (!text) {
    throw new AppError("AI_EMPTY_RESPONSE", "AI provider returned an empty response", 502);
  }

  return text;
}

async function getUsageToday(tenantId: string, studentId: string) {
  const db = await getMongoDb();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const [userUsage, tenantUsage] = await Promise.all([
    db.collection("ai_conversations").find(
      { tenant_id: tenantId, student_id: studentId, updated_at: { $gte: todayIso } },
      { projection: { token_usage: 1 } },
    ).toArray(),
    db.collection("ai_conversations").find(
      { tenant_id: tenantId, updated_at: { $gte: todayIso } },
      { projection: { token_usage: 1 } },
    ).toArray(),
  ]);

  const sumTokens = (rows: Array<{ token_usage?: unknown }>) =>
    rows.reduce((sum, row) => {
      const usage = (row.token_usage ?? {}) as { totalTokens?: number };
      return sum + Number(usage.totalTokens ?? 0);
    }, 0);

  return {
    userTokensToday: sumTokens(userUsage as unknown as Array<{ token_usage?: unknown }>),
    tenantTokensToday: sumTokens(tenantUsage as unknown as Array<{ token_usage?: unknown }>),
  };
}

function applyRequestRateLimit(userId: string) {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  const list = (requestWindow.get(userId) ?? []).filter((time) => time >= oneMinuteAgo);
  list.push(now);
  requestWindow.set(userId, list);

  if (list.length > USER_REQUESTS_PER_MINUTE) {
    throw new AppError("AI_RATE_LIMIT_USER_REQUESTS", "Too many AI requests. Try again in a minute.", 429);
  }
}

async function assertTenantAiEnabled(tenantId: string) {
  const db = await getMongoDb();
  const data = await db.collection("tenants").findOne(
    { id: tenantId },
    { projection: { config: 1 } },
  );

  if (!data) {
    throw new AppError("TENANT_NOT_FOUND", "Tenant not found", 404);
  }

  const config = (data.config ?? {}) as { ai_enabled?: boolean };
  if (config.ai_enabled === false) {
    throw new AppError("AI_DISABLED", "AI assistant is disabled for this tenant", 403);
  }
}

export const AIService = {
  async chat(input: {
    tenantId: string;
    userId: string;
    message: string;
    conversationId?: string;
  }) {
    if (!input.message.trim()) {
      throw new AppError("AI_EMPTY_INPUT", "Message is required", 400);
    }
    if (input.message.length > INPUT_LIMIT) {
      throw new AppError("AI_INPUT_TOO_LONG", `Message must be <= ${INPUT_LIMIT} characters`, 400);
    }
    if (detectInjection(input.message)) {
      throw new AppError("AI_PROMPT_INJECTION_DETECTED", "Potential prompt injection detected", 400);
    }

    await assertTenantAiEnabled(input.tenantId);
    applyRequestRateLimit(input.userId);

    const student = await StudentRepository.getStudentByUserId(input.tenantId, input.userId);
    const db = await getMongoDb();
    const cleanedMessage = stripPii(input.message);
    const selectedModel = pickModel(cleanedMessage);
    const geminiApiKey = getEnvVar("GEMINI_API_KEY");
    const useLocalFallback =
      process.env.NODE_ENV !== "production" && isPlaceholderGeminiKey(geminiApiKey);
    const model = useLocalFallback ? "local-fallback" : selectedModel;
    const topic = detectTopic(cleanedMessage);

    if (process.env.NODE_ENV === "production" && isPlaceholderGeminiKey(geminiApiKey)) {
      throw new AppError("AI_NOT_CONFIGURED", "Gemini API key is not configured", 503);
    }

    const { userTokensToday, tenantTokensToday } = await getUsageToday(input.tenantId, String(student.id));
    const estimatedPromptTokens = estimateTokens(cleanedMessage);
    if (userTokensToday + estimatedPromptTokens > USER_TOKENS_PER_DAY) {
      throw new AppError("AI_RATE_LIMIT_USER_TOKENS", "Daily AI token limit reached for this user", 429);
    }
    if (tenantTokensToday + estimatedPromptTokens > TENANT_TOKENS_PER_DAY) {
      throw new AppError("AI_RATE_LIMIT_TENANT_TOKENS", "Daily AI token limit reached for this tenant", 429);
    }
    if (activeGlobalRequests >= GLOBAL_CONCURRENT_REQUESTS) {
      throw new AppError("AI_RATE_LIMIT_GLOBAL", "AI is busy right now. Try again shortly.", 429);
    }

    let previousMessages: AiMessage[] = [];
    let existingConversation:
      | {
          id: string;
          messages: unknown;
          token_usage: unknown;
        }
      | null = null;

    if (input.conversationId) {
      const data = await db.collection("ai_conversations").findOne(
        { tenant_id: input.tenantId, student_id: String(student.id), id: input.conversationId },
        { projection: { _id: 0, id: 1, messages: 1, token_usage: 1 } },
      );

      if (!data) {
        throw new AppError("AI_CONVERSATION_NOT_FOUND", "Conversation not found", 404);
      }

      existingConversation = {
        id: String(data.id),
        messages: data.messages,
        token_usage: data.token_usage,
      };
      previousMessages = ((data.messages ?? []) as AiMessage[]).slice(-10);
    }

    const prompt = [
      buildSystemPrompt(),
      "Conversation Context:",
      ...previousMessages.map((message) => `${message.role.toUpperCase()}: ${message.content}`),
      `USER: ${cleanedMessage}`,
      "ASSISTANT:",
    ].join("\n");

    activeGlobalRequests += 1;
    let rawAnswer = "";
    try {
      rawAnswer = useLocalFallback
        ? buildLocalFallbackResponse(cleanedMessage, topic)
        : await callGemini(selectedModel, prompt, geminiApiKey);
    } finally {
      activeGlobalRequests = Math.max(0, activeGlobalRequests - 1);
    }

    const safeAnswer = `${rawAnswer.slice(0, OUTPUT_CHAR_LIMIT)}\n\nNote: Verify critical details with official sources.`;
    const promptTokens = estimateTokens(prompt);
    const completionTokens = estimateTokens(safeAnswer);
    const totalTokens = promptTokens + completionTokens;
    const now = new Date().toISOString();

    const userMessage: AiMessage = {
      role: "user",
      content: cleanedMessage,
      timestamp: now,
    };
    const assistantMessage: AiMessage = {
      role: "assistant",
      content: safeAnswer,
      timestamp: now,
    };

    const nextMessages = [...previousMessages, userMessage, assistantMessage];
    let conversationId = input.conversationId ?? "";

    if (existingConversation) {
      const previousUsage = (existingConversation.token_usage ?? {}) as {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
      };

      await db.collection("ai_conversations").updateOne(
        { tenant_id: input.tenantId, id: existingConversation.id },
        {
          $set: {
            messages: nextMessages,
            model,
            topic,
            token_usage: {
              promptTokens: Number(previousUsage.promptTokens ?? 0) + promptTokens,
              completionTokens: Number(previousUsage.completionTokens ?? 0) + completionTokens,
              totalTokens: Number(previousUsage.totalTokens ?? 0) + totalTokens,
            },
            updated_at: now,
          },
        },
      );

      conversationId = existingConversation.id;
    } else {
      conversationId = randomUUID();

      await db.collection("ai_conversations").insertOne({
        id: conversationId,
        tenant_id: input.tenantId,
        student_id: String(student.id),
        messages: [userMessage, assistantMessage],
        model,
        topic,
        token_usage: {
          promptTokens,
          completionTokens,
          totalTokens,
        },
        created_at: now,
        updated_at: now,
      });
    }

    return {
      conversationId,
      model,
      topic,
      response: safeAnswer,
      tokenUsage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
    };
  },

  async listConversations(tenantId: string, userId: string) {
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    const db = await getMongoDb();

    const data = await db.collection("ai_conversations").find(
      { tenant_id: tenantId, student_id: String(student.id) },
      { projection: { _id: 0, id: 1, topic: 1, model: 1, token_usage: 1, updated_at: 1, messages: 1 } },
    ).sort({ updated_at: -1 }).toArray();

    return data.map((item) => {
      const messages = (item.messages ?? []) as AiMessage[];
      const last = messages[messages.length - 1];
      return {
        id: String(item.id),
        topic: item.topic ? String(item.topic) : "general",
        model: item.model ? String(item.model) : "unknown",
        updatedAt: String(item.updated_at),
        preview: last?.content ? String(last.content).slice(0, 120) : "",
        tokenUsage: (item.token_usage ?? {}) as Record<string, unknown>,
      };
    });
  },

  async getConversation(tenantId: string, userId: string, conversationId: string) {
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    const db = await getMongoDb();

    const data = await db.collection("ai_conversations").findOne(
      { tenant_id: tenantId, student_id: String(student.id), id: conversationId },
      { projection: { _id: 0, id: 1, topic: 1, model: 1, token_usage: 1, messages: 1, created_at: 1, updated_at: 1 } },
    );

    if (!data) {
      throw new AppError("AI_CONVERSATION_NOT_FOUND", "Conversation not found", 404);
    }

    return {
      id: String(data.id),
      topic: data.topic ? String(data.topic) : "general",
      model: data.model ? String(data.model) : "unknown",
      tokenUsage: (data.token_usage ?? {}) as Record<string, unknown>,
      messages: (data.messages ?? []) as AiMessage[],
      createdAt: String(data.created_at),
      updatedAt: String(data.updated_at),
    };
  },

  async getUsage(tenantId: string, userId: string, role: "student" | "tpo" | "admin") {
    const db = await getMongoDb();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    const tenantRows = await db.collection("ai_conversations").find(
      { tenant_id: tenantId, updated_at: { $gte: todayIso } },
      { projection: { token_usage: 1 } },
    ).toArray();

    const tenantTokensToday = tenantRows.reduce((sum, row) => {
      const usage = (row.token_usage ?? {}) as { totalTokens?: number };
      return sum + Number(usage.totalTokens ?? 0);
    }, 0);

    let userTokensToday = 0;
    if (role === "student") {
      const student = await StudentRepository.getStudentByUserId(tenantId, userId);
      const usage = await getUsageToday(tenantId, String(student.id));
      userTokensToday = usage.userTokensToday;
    }

    return {
      userTokensToday,
      userTokenLimit: USER_TOKENS_PER_DAY,
      tenantTokensToday,
      tenantTokenLimit: TENANT_TOKENS_PER_DAY,
      requestsPerMinuteLimit: USER_REQUESTS_PER_MINUTE,
      globalConcurrentLimit: GLOBAL_CONCURRENT_REQUESTS,
    };
  },
};
