import "dotenv/config";

import { AIFailoverService } from "../src/services/ai/failover.service.js";

type ProbeResult = {
  name: string;
  ok: boolean;
  status: number;
  detail: string;
};

function isPlaceholder(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return !normalized || normalized === "placeholder" || normalized.includes("your_") || normalized.includes("<your-");
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } catch (error) {
    const e = error as { name?: string; message?: string };
    if (e?.name === "AbortError") {
      return { status: 408, ok: false, text: "request timed out after 20s" };
    }
    return { status: 503, ok: false, text: e?.message ?? "network error" };
  } finally {
    clearTimeout(timeout);
  }
}

function parseExcerpt(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 140);
}

async function probeGemini(prompt: string): Promise<ProbeResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (isPlaceholder(apiKey)) {
    return { name: "gemini", ok: false, status: 0, detail: "skipped (api key missing)" };
  }

  const model = "gemini-2.0-flash";
  const response = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {},
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 120 },
    },
  );

  if (!response.ok) {
    return { name: "gemini", ok: false, status: response.status, detail: parseExcerpt(response.text) };
  }

  const parsed = JSON.parse(response.text) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return { name: "gemini", ok: true, status: 200, detail: parseExcerpt(String(text)) };
}

async function probeGroq(prompt: string): Promise<ProbeResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (isPlaceholder(apiKey)) {
    return { name: "groq", ok: false, status: 0, detail: "skipped (api key missing)" };
  }

  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const response = await postJson(
    "https://api.groq.com/openai/v1/chat/completions",
    { Authorization: `Bearer ${apiKey}` },
    {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 120,
    },
  );

  if (!response.ok) {
    return { name: "groq", ok: false, status: response.status, detail: parseExcerpt(response.text) };
  }

  const parsed = JSON.parse(response.text) as { choices?: Array<{ message?: { content?: string } }> };
  const text = parsed?.choices?.[0]?.message?.content ?? "";
  return { name: "groq", ok: true, status: 200, detail: parseExcerpt(String(text)) };
}

async function probeOpenRouter(prompt: string): Promise<ProbeResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (isPlaceholder(apiKey)) {
    return { name: "openrouter", ok: false, status: 0, detail: "skipped (api key missing)" };
  }

  const model = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free";
  const response = await postJson(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.APP_URL ?? "http://localhost:5173",
      "X-Title": process.env.APP_NAME ?? "CampusDrive AI",
    },
    {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 120,
    },
  );

  if (!response.ok) {
    return { name: "openrouter", ok: false, status: response.status, detail: parseExcerpt(response.text) };
  }

  const parsed = JSON.parse(response.text) as { choices?: Array<{ message?: { content?: string } }> };
  const text = parsed?.choices?.[0]?.message?.content ?? "";
  return { name: "openrouter", ok: true, status: 200, detail: parseExcerpt(String(text)) };
}

async function probeFailover(prompt: string): Promise<ProbeResult> {
  try {
    const result = await AIFailoverService.generate({
      tenantId: "smoke-test-tenant",
      cleanedMessage: prompt,
      prompt: [
        "Role: You are CampusDrive AI, a helpful academic tutor.",
        "Keep answers short and clear.",
        `USER: ${prompt}`,
        "ASSISTANT:",
      ].join("\n"),
    });

    return {
      name: "failover-service",
      ok: true,
      status: 200,
      detail: `provider=${result.provider}, model=${result.model}, cacheHit=${String(result.cacheHit)}, text=${parseExcerpt(result.response)}`,
    };
  } catch (error) {
    const e = error as { message?: string; statusCode?: number; status?: number };
    return {
      name: "failover-service",
      ok: false,
      status: Number(e.statusCode ?? e.status ?? 500),
      detail: parseExcerpt(String(e.message ?? "unknown error")),
    };
  }
}

async function main() {
  const prompt = "What is 2 + 2? Explain in one short step.";

  const results = await Promise.all([
    probeGemini(prompt),
    probeGroq(prompt),
    probeOpenRouter(prompt),
    probeFailover(prompt),
  ]);

  const summary = results.map((item) => ({
    provider: item.name,
    ok: item.ok,
    status: item.status,
    detail: item.detail,
  }));

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
