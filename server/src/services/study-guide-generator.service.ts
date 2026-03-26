import { createHash } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { getOptionalEnvVar } from "../utils/env.js";
import { estimateTokens } from "./ai/ai-helpers.js";
import { postJson } from "./ai/providers/http.js";
import {
  ProviderError,
  type ProviderName,
  type ProviderResponse,
} from "./ai/providers/provider.types.js";
import { StudyGuideRepository } from "../repositories/study-guide.repository.js";
import type {
  StudyGuideCategory,
  StudyGuideDifficulty,
  StudyGuideDocument,
  StudyGuidePracticeQuestion,
  StudyGuideSection,
} from "../models/StudyGuide.js";
import { logger } from "../utils/logger.js";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const STUDY_GUIDE_TIMEOUT_MS = 60_000;
const STUDY_GUIDE_MAX_TOKENS = 4096;
const STUDY_GUIDE_TEMPERATURE = 0.4;

const DEFAULT_PRIORITY_ORDER: ProviderName[] = ["gemini", "groq", "openrouter"];

const COST_TABLE: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gemini-2.0-flash": { inputPer1M: 0.10, outputPer1M: 0.40 },
  "gemini-1.5-pro": { inputPer1M: 1.25, outputPer1M: 5.00 },
  "llama-3.3-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79 },
  "meta-llama/llama-3.1-8b-instruct:free": { inputPer1M: 0, outputPer1M: 0 },
};

function getAiConfig() {
  return {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
    GROQ_API_KEY: process.env.GROQ_API_KEY ?? "",
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? "",
    PRIORITY_ORDER: (process.env.AI_PROVIDER_ORDER ?? DEFAULT_PRIORITY_ORDER.join(","))
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is ProviderName => s === "gemini" || s === "groq" || s === "openrouter"),
  };
}

function isPlaceholderKey(value: string): boolean {
  const n = value.trim().toLowerCase();
  return !n || n.includes("your_") || n.includes("<your-") || n === "placeholder";
}

function providerModel(provider: ProviderName): string {
  if (provider === "gemini") return "gemini-2.0-flash";
  if (provider === "groq") return process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  return process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free";
}

function getProviderKey(provider: ProviderName): string {
  const cfg = getAiConfig();
  if (provider === "gemini") return cfg.GEMINI_API_KEY;
  if (provider === "groq") return cfg.GROQ_API_KEY;
  return cfg.OPENROUTER_API_KEY;
}

function orderProviders(): ProviderName[] {
  const cfg = getAiConfig();
  if (cfg.PRIORITY_ORDER.length === 0) return DEFAULT_PRIORITY_ORDER;
  const seen = new Set<ProviderName>();
  const ordered: ProviderName[] = [];
  cfg.PRIORITY_ORDER.forEach((p) => { if (!seen.has(p)) { seen.add(p); ordered.push(p); } });
  DEFAULT_PRIORITY_ORDER.forEach((p) => { if (!seen.has(p)) ordered.push(p); });
  return ordered;
}

/* ------------------------------------------------------------------ */
/*  Provider calls (custom config for study guides)                    */
/* ------------------------------------------------------------------ */

async function callGeminiSG(apiKey: string, model: string, prompt: string): Promise<ProviderResponse> {
  const payload = await postJson({
    provider: "gemini",
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    timeoutMs: STUDY_GUIDE_TIMEOUT_MS,
    headers: {},
    body: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: STUDY_GUIDE_TEMPERATURE,
        maxOutputTokens: STUDY_GUIDE_MAX_TOKENS,
      },
    },
  });
  const text = String(
    (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
      ?.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
  ).trim();
  if (!text) throw new ProviderError({ provider: "gemini", status: 502, retryable: true, code: "EMPTY_RESPONSE", message: "gemini returned empty response" });
  return { provider: "gemini", model, text };
}

async function callGroqSG(apiKey: string, model: string, prompt: string): Promise<ProviderResponse> {
  const payload = await postJson({
    provider: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    timeoutMs: STUDY_GUIDE_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${apiKey}` },
    body: {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: STUDY_GUIDE_TEMPERATURE,
      max_tokens: STUDY_GUIDE_MAX_TOKENS,
    },
  });
  const text = String(
    (payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content ?? "",
  ).trim();
  if (!text) throw new ProviderError({ provider: "groq", status: 502, retryable: true, code: "EMPTY_RESPONSE", message: "groq returned empty response" });
  return { provider: "groq", model, text };
}

async function callOpenRouterSG(apiKey: string, model: string, prompt: string): Promise<ProviderResponse> {
  const payload = await postJson({
    provider: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    timeoutMs: STUDY_GUIDE_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.APP_URL ?? "http://localhost:5173",
      "X-Title": process.env.APP_NAME ?? "CampusDrive AI",
    },
    body: {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: STUDY_GUIDE_TEMPERATURE,
      max_tokens: STUDY_GUIDE_MAX_TOKENS,
    },
  });
  const text = String(
    (payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content ?? "",
  ).trim();
  if (!text) throw new ProviderError({ provider: "openrouter", status: 502, retryable: true, code: "EMPTY_RESPONSE", message: "openrouter returned empty response" });
  return { provider: "openrouter", model, text };
}

/* ------------------------------------------------------------------ */
/*  Failover caller                                                    */
/* ------------------------------------------------------------------ */

async function callAiWithFailover(prompt: string): Promise<ProviderResponse> {
  const providers = orderProviders();
  const attempted: Array<{ provider: ProviderName; status: number; message: string }> = [];

  for (const provider of providers) {
    const apiKey = getProviderKey(provider);
    if (isPlaceholderKey(apiKey)) {
      attempted.push({ provider, status: 503, message: `${provider} key not configured` });
      continue;
    }

    const model = providerModel(provider);
    try {
      if (provider === "gemini") return await callGeminiSG(apiKey, model, prompt);
      if (provider === "groq") return await callGroqSG(apiKey, model, prompt);
      return await callOpenRouterSG(apiKey, model, prompt);
    } catch (error) {
      const pe = error instanceof ProviderError
        ? error
        : new ProviderError({ provider, status: 500, retryable: true, message: String((error as Error).message ?? `${provider} failed`) });
      attempted.push({ provider, status: pe.status, message: pe.message });
      if (pe.retryable) continue;
      throw new AppError("AI_PROVIDER_ERROR", `${provider} failed: ${pe.message}`, pe.status >= 400 && pe.status <= 599 ? pe.status : 502);
    }
  }

  throw new AppError(
    "AI_ALL_PROVIDERS_UNAVAILABLE",
    `All AI providers unavailable. Attempts: ${attempted.map((a) => `${a.provider}:${a.status}`).join(", ")}`,
    503,
  );
}

/* ------------------------------------------------------------------ */
/*  Prompt building                                                    */
/* ------------------------------------------------------------------ */

function buildPrompt(input: {
  topicName: string;
  category: StudyGuideCategory;
  subcategory: string;
  difficulty: StudyGuideDifficulty;
  companyContext?: string;
}): string {
  const difficultyLabel: Record<StudyGuideDifficulty, string> = {
    beginner: "Beginner-friendly with fundamentals",
    intermediate: "Intermediate with moderate depth",
    advanced: "Advanced with in-depth coverage",
  };

  const companyLine = input.companyContext
    ? `\nCompany context: ${input.companyContext}. Tailor examples and question patterns to this company's assessment style.`
    : "";

  return `You are an expert educator specialising in campus placement preparation for Indian engineering students. Create a comprehensive, original study guide.

Topic: ${input.topicName}
Subject area: ${input.category} > ${input.subcategory}
Difficulty: ${difficultyLabel[input.difficulty]}${companyLine}

Structure your response using these exact markdown headings:

## Overview
- What this topic is and why it matters for placements
- Which companies commonly test this (TCS, Infosys, Wipro, etc.)
- Prerequisites students should know

## Key Concepts
- Core theory, definitions, and formulas
- Important terminology
- Visual descriptions of diagrams where relevant

## Detailed Explanation
- Step-by-step walkthroughs of the core ideas
- Worked examples with clear reasoning
- Tables or comparisons where useful
- Code examples with comments (for technical topics)

## Problem-Solving Techniques
- Common problem patterns and recognition tips
- Shortcuts and time-saving tricks
- Common mistakes to avoid

## Practice Problems
Provide exactly 5 practice problems. For each:
- State the problem clearly
- Provide a detailed solution with step-by-step explanation
- Range difficulty from easy to hard

## Placement Tips
- Company-specific tips for this topic
- Last-minute revision advice
- How to handle this in an interview setting

## Quick Revision Notes
- Bullet-point summary of key formulas and rules
- One-line reminders of important concepts

Requirements:
- Use markdown formatting (bold, lists, code blocks, tables)
- Write in clear Indian English
- Focus on practical placement preparation, not academic theory
- All content must be original
- Target length: 1500-2500 words`;
}

/* ------------------------------------------------------------------ */
/*  Response parsing                                                   */
/* ------------------------------------------------------------------ */

function parseGuideResponse(raw: string): {
  sections: StudyGuideSection[];
  keyConcepts: string[];
  practiceQuestions: StudyGuidePracticeQuestion[];
  placementTips: string[];
  summary: string;
} {
  const sections: StudyGuideSection[] = [];
  const lines = raw.split("\n");
  let currentHeading = "";
  let currentContent: string[] = [];
  let order = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (currentHeading) {
        sections.push({ heading: currentHeading, content: currentContent.join("\n").trim(), order: order++ });
      }
      currentHeading = headingMatch[1].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentHeading) {
    sections.push({ heading: currentHeading, content: currentContent.join("\n").trim(), order: order++ });
  }

  // If no headings found, treat entire content as one section
  if (sections.length === 0) {
    sections.push({ heading: "Study Guide", content: raw.trim(), order: 0 });
  }

  // Extract key concepts from Key Concepts section
  const conceptSection = sections.find((s) => /key concepts/i.test(s.heading));
  const keyConcepts: string[] = [];
  if (conceptSection) {
    const bulletLines = conceptSection.content.split("\n").filter((l) => /^\s*[-*]\s+\*\*(.+?)\*\*/.test(l) || /^\s*[-*]\s+(.+)/.test(l));
    for (const bl of bulletLines.slice(0, 15)) {
      const boldMatch = bl.match(/\*\*(.+?)\*\*/);
      if (boldMatch) { keyConcepts.push(boldMatch[1].trim()); continue; }
      const plainMatch = bl.match(/^\s*[-*]\s+(.+)/);
      if (plainMatch) keyConcepts.push(plainMatch[1].trim().slice(0, 80));
    }
  }

  // Extract practice questions
  const practiceSection = sections.find((s) => /practice problems/i.test(s.heading));
  const practiceQuestions: StudyGuidePracticeQuestion[] = [];
  if (practiceSection) {
    const qBlocks = practiceSection.content.split(/\n(?=\s*(?:\*\*(?:Problem|Question|Q)\s*\d|###?\s*(?:Problem|Question|Q)\s*\d|\d+[\.\)]\s))/i);
    for (const block of qBlocks) {
      if (!block.trim()) continue;
      const blockLines = block.trim().split("\n");
      const questionLines: string[] = [];
      const answerLines: string[] = [];
      let inAnswer = false;
      for (const bl of blockLines) {
        if (/\*\*(?:solution|answer|explanation)\*\*/i.test(bl) || /^(?:solution|answer|explanation)\s*:/i.test(bl)) {
          inAnswer = true;
          continue;
        }
        if (inAnswer) answerLines.push(bl); else questionLines.push(bl);
      }
      if (questionLines.length > 0) {
        practiceQuestions.push({
          question: questionLines.join("\n").trim(),
          answer: answerLines.join("\n").trim() || "See detailed explanation above.",
          explanation: answerLines.join("\n").trim(),
        });
      }
    }
  }

  // Extract placement tips
  const tipsSection = sections.find((s) => /placement tips/i.test(s.heading));
  const placementTips: string[] = [];
  if (tipsSection) {
    const tipLines = tipsSection.content.split("\n").filter((l) => /^\s*[-*]\s+(.+)/.test(l) || /^\s*\d+[\.\)]\s+(.+)/.test(l));
    for (const tl of tipLines.slice(0, 10)) {
      const m = tl.match(/^\s*(?:[-*]|\d+[\.\)])\s+(.+)/);
      if (m) placementTips.push(m[1].trim());
    }
  }

  // Build summary from overview section
  const overviewSection = sections.find((s) => /overview/i.test(s.heading));
  const summary = overviewSection
    ? overviewSection.content.split("\n").filter((l) => l.trim()).slice(0, 3).join(" ").slice(0, 300)
    : sections[0].content.slice(0, 300);

  return { sections, keyConcepts, practiceQuestions, placementTips, summary };
}

/* ------------------------------------------------------------------ */
/*  Slug generation                                                    */
/* ------------------------------------------------------------------ */

function toSlug(topicName: string, category: string): string {
  const base = `${topicName}-${category}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return base || "study-guide";
}

/* ------------------------------------------------------------------ */
/*  Quality scoring                                                    */
/* ------------------------------------------------------------------ */

function autoQualityScore(input: {
  sections: StudyGuideSection[];
  wordCount: number;
  keyConcepts: string[];
  practiceQuestions: StudyGuidePracticeQuestion[];
  placementTips: string[];
}): number {
  let score = 0;
  // Section count (max 30)
  score += Math.min(30, input.sections.length * 5);
  // Word count (max 25)
  if (input.wordCount >= 500) score += 10;
  if (input.wordCount >= 1000) score += 10;
  if (input.wordCount >= 1500) score += 5;
  // Practice questions (max 20)
  score += Math.min(20, input.practiceQuestions.length * 4);
  // Key concepts (max 15)
  score += Math.min(15, input.keyConcepts.length * 3);
  // Placement tips (max 10)
  score += Math.min(10, input.placementTips.length * 2);
  return Math.min(100, score);
}

/* ------------------------------------------------------------------ */
/*  Cost estimation                                                    */
/* ------------------------------------------------------------------ */

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const entry = COST_TABLE[model];
  if (!entry) return 0;
  return (inputTokens * entry.inputPer1M + outputTokens * entry.outputPer1M) / 1_000_000;
}

/* ------------------------------------------------------------------ */
/*  Public service                                                     */
/* ------------------------------------------------------------------ */

export const StudyGuideGeneratorService = {
  async generateGuide(input: {
    tenantId: string | null;
    topicName: string;
    category: StudyGuideCategory;
    subcategory: string;
    difficulty: StudyGuideDifficulty;
    companyContext?: string;
    createdBy: string;
  }): Promise<StudyGuideDocument> {
    const prompt = buildPrompt({
      topicName: input.topicName,
      category: input.category,
      subcategory: input.subcategory,
      difficulty: input.difficulty,
      companyContext: input.companyContext,
    });

    const promptHash = createHash("sha256").update(prompt).digest("hex").slice(0, 16);

    logger.info("Generating study guide", {
      context: {
        topic: input.topicName,
        category: input.category,
        difficulty: input.difficulty,
        subcategory: input.subcategory,
      },
    });

    const aiResult = await callAiWithFailover(prompt);

    const inputTokens = estimateTokens(prompt);
    const outputTokens = estimateTokens(aiResult.text);
    const costUsd = estimateCostUsd(aiResult.model, inputTokens, outputTokens);

    const parsed = parseGuideResponse(aiResult.text);

    const wordCount = aiResult.text.split(/\s+/).filter(Boolean).length;
    const readMinutes = Math.max(1, Math.ceil(wordCount / 250));
    const qualityScore = autoQualityScore({
      sections: parsed.sections,
      wordCount,
      keyConcepts: parsed.keyConcepts,
      practiceQuestions: parsed.practiceQuestions,
      placementTips: parsed.placementTips,
    });

    const slug = toSlug(input.topicName, input.category);
    const title = `${input.topicName} - Placement Study Guide`;

    const guide = await StudyGuideRepository.createGuide({
      tenantId: input.tenantId,
      topicName: input.topicName,
      title,
      slug,
      category: input.category,
      subcategory: input.subcategory,
      difficulty: input.difficulty,
      summary: parsed.summary,
      markdownContent: aiResult.text,
      sections: parsed.sections,
      keyConcepts: parsed.keyConcepts,
      practiceQuestions: parsed.practiceQuestions,
      placementTips: parsed.placementTips,
      estimatedReadMinutes: readMinutes,
      wordCount,
      aiProvider: aiResult.provider,
      aiModel: aiResult.model,
      generationPromptHash: promptHash,
      generationCostEstimateUsd: costUsd,
      createdBy: input.createdBy,
    });

    // Log cost async (don't block response)
    void StudyGuideRepository.logCost({
      tenant_id: input.tenantId,
      guide_id: guide.id,
      provider: aiResult.provider,
      model: aiResult.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: costUsd,
    }).catch((err) => logger.error("Failed to log study guide cost", {
      context: {
        guideId: guide.id,
        error: err instanceof Error ? err.message : String(err),
      },
    }));

    logger.info("Study guide generated", {
      context: {
        guideId: guide.id,
        topic: input.topicName,
        provider: aiResult.provider,
        model: aiResult.model,
        wordCount,
        qualityScore,
        costUsd: Number(costUsd.toFixed(6)),
      },
    });

    return guide;
  },

  async batchGenerate(input: {
    tenantId: string | null;
    topics: Array<{ topicName: string; category: StudyGuideCategory; subcategory: string }>;
    difficulty: StudyGuideDifficulty;
    createdBy: string;
    delayMs?: number;
  }): Promise<{
    generated: string[];
    failed: Array<{ topicName: string; error: string }>;
    totalCostUsd: number;
  }> {
    const delay = input.delayMs ?? 2000;
    const generated: string[] = [];
    const failed: Array<{ topicName: string; error: string }> = [];
    let totalCostUsd = 0;

    for (let i = 0; i < input.topics.length; i++) {
      const topic = input.topics[i];
      try {
        const guide = await this.generateGuide({
          tenantId: input.tenantId,
          topicName: topic.topicName,
          category: topic.category,
          subcategory: topic.subcategory,
          difficulty: input.difficulty,
          createdBy: input.createdBy,
        });
        generated.push(guide.id);
        totalCostUsd += guide.generation_cost_estimate_usd;
        logger.info(`Batch progress: ${i + 1}/${input.topics.length} - ${topic.topicName}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ topicName: topic.topicName, error: message });
        logger.error(`Batch generation failed for ${topic.topicName}`, {
          context: {
            topic: topic.topicName,
            error: message,
          },
        });
      }

      // Rate limit delay (skip after last item)
      if (i < input.topics.length - 1 && delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return { generated, failed, totalCostUsd };
  },
};
