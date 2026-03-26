/**
 * Batch Study Guide Generator
 *
 * Reads topics from study_guide_topics, generates study guides via AI providers,
 * and stores results in study_guides collection.
 *
 * Usage:
 *   node --env-file=.env scripts/generate-study-guides.mjs
 *   node --env-file=.env scripts/generate-study-guides.mjs --category=aptitude
 *   node --env-file=.env scripts/generate-study-guides.mjs --limit=5 --difficulty=intermediate
 *   node --env-file=.env scripts/generate-study-guides.mjs --skip-existing --delay-ms=3000
 *   node --env-file=.env scripts/generate-study-guides.mjs --dry-run
 */
import "dotenv/config";
import { randomUUID, createHash } from "node:crypto";
import { MongoClient } from "mongodb";

// ─── Config ────────────────────────────────────────────────────────

const TIMEOUT_MS = 60_000;
const MAX_TOKENS = 4096;
const TEMPERATURE = 0.4;

const DEFAULT_PROVIDERS = ["gemini", "groq", "openrouter"];

const COST_TABLE = {
  "gemini-2.0-flash": { inputPer1M: 0.10, outputPer1M: 0.40 },
  "gemini-1.5-pro": { inputPer1M: 1.25, outputPer1M: 5.00 },
  "llama-3.3-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79 },
  "meta-llama/llama-3.1-8b-instruct:free": { inputPer1M: 0, outputPer1M: 0 },
};

// ─── CLI flags ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipExisting = args.includes("--skip-existing");

function getFlag(name) {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : null;
}

const categoryFilter = getFlag("category");
const difficultyFilter = getFlag("difficulty") || "intermediate";
const limitNum = Number(getFlag("limit")) || 999;
const delayMs = Number(getFlag("delay-ms")) || 2000;
const priorityMax = Number(getFlag("max-priority")) || 3;

// ─── AI Provider calls ────────────────────────────────────────────

function isPlaceholder(key) {
  const n = (key || "").trim().toLowerCase();
  return !n || n.includes("your_") || n.includes("<your-") || n === "placeholder";
}

async function postJson(url, headers, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 300)}`);
    return JSON.parse(raw);
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(apiKey, prompt) {
  const model = "gemini-2.0-flash";
  const payload = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {},
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: TEMPERATURE, maxOutputTokens: MAX_TOKENS },
    },
    TIMEOUT_MS,
  );
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!text) throw new Error("Gemini returned empty response");
  return { provider: "gemini", model, text: text.trim() };
}

async function callGroq(apiKey, prompt) {
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const payload = await postJson(
    "https://api.groq.com/openai/v1/chat/completions",
    { Authorization: `Bearer ${apiKey}` },
    { model, messages: [{ role: "user", content: prompt }], temperature: TEMPERATURE, max_tokens: MAX_TOKENS },
    TIMEOUT_MS,
  );
  const text = payload?.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("Groq returned empty response");
  return { provider: "groq", model, text: text.trim() };
}

async function callOpenRouter(apiKey, prompt) {
  const model = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free";
  const payload = await postJson(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.APP_URL || "http://localhost:5173",
      "X-Title": "CampusDrive AI",
    },
    { model, messages: [{ role: "user", content: prompt }], temperature: TEMPERATURE, max_tokens: MAX_TOKENS },
    TIMEOUT_MS,
  );
  const text = payload?.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("OpenRouter returned empty response");
  return { provider: "openrouter", model, text: text.trim() };
}

async function callAiWithFailover(prompt) {
  const order = (process.env.AI_PROVIDER_ORDER || DEFAULT_PROVIDERS.join(","))
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

  const keys = {
    gemini: process.env.GEMINI_API_KEY || "",
    groq: process.env.GROQ_API_KEY || "",
    openrouter: process.env.OPENROUTER_API_KEY || "",
  };

  const errors = [];

  for (const provider of order) {
    const key = keys[provider];
    if (!key || isPlaceholder(key)) {
      errors.push(`${provider}: key not configured`);
      continue;
    }

    try {
      if (provider === "gemini") return await callGemini(key, prompt);
      if (provider === "groq") return await callGroq(key, prompt);
      if (provider === "openrouter") return await callOpenRouter(key, prompt);
    } catch (err) {
      errors.push(`${provider}: ${err.message}`);
      // If rate limited, back off briefly
      if (err.message.includes("429")) {
        console.log(`  Rate limited on ${provider}, waiting 10s...`);
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  }

  throw new Error(`All providers failed: ${errors.join("; ")}`);
}

// ─── Prompt & parsing ─────────────────────────────────────────────

function buildPrompt(topicName, category, subcategory, difficulty) {
  const diffDesc = {
    beginner: "Beginner-friendly with fundamentals",
    intermediate: "Intermediate with moderate depth",
    advanced: "Advanced with in-depth coverage",
  };

  return `You are an expert educator specialising in campus placement preparation for Indian engineering students. Create a comprehensive, original study guide.

Topic: ${topicName}
Subject area: ${category} > ${subcategory}
Difficulty: ${diffDesc[difficulty] || difficulty}

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

function parseSections(raw) {
  const sections = [];
  const lines = raw.split("\n");
  let heading = "";
  let content = [];
  let order = 0;

  for (const line of lines) {
    const m = line.match(/^##\s+(.+)/);
    if (m) {
      if (heading) sections.push({ heading, content: content.join("\n").trim(), order: order++ });
      heading = m[1].trim();
      content = [];
    } else {
      content.push(line);
    }
  }
  if (heading) sections.push({ heading, content: content.join("\n").trim(), order: order++ });
  if (sections.length === 0) sections.push({ heading: "Study Guide", content: raw.trim(), order: 0 });
  return sections;
}

function extractKeyConcepts(sections) {
  const sec = sections.find((s) => /key concepts/i.test(s.heading));
  if (!sec) return [];
  return sec.content.split("\n")
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .slice(0, 15)
    .map((l) => {
      const bold = l.match(/\*\*(.+?)\*\*/);
      if (bold) return bold[1].trim();
      return l.replace(/^\s*[-*]\s+/, "").trim().slice(0, 80);
    })
    .filter(Boolean);
}

function extractPracticeQuestions(sections) {
  const sec = sections.find((s) => /practice problems/i.test(s.heading));
  if (!sec) return [];
  const blocks = sec.content.split(/\n(?=\s*(?:\*\*(?:Problem|Question|Q)\s*\d|###?\s*(?:Problem|Question|Q)\s*\d|\d+[\.\)]\s))/i);
  const questions = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.trim().split("\n");
    const qLines = [];
    const aLines = [];
    let inAnswer = false;
    for (const l of lines) {
      if (/\*\*(?:solution|answer|explanation)\*\*/i.test(l) || /^(?:solution|answer|explanation)\s*:/i.test(l)) {
        inAnswer = true; continue;
      }
      if (inAnswer) aLines.push(l); else qLines.push(l);
    }
    if (qLines.length > 0) {
      questions.push({
        question: qLines.join("\n").trim(),
        answer: aLines.join("\n").trim() || "See solution above.",
        explanation: aLines.join("\n").trim(),
      });
    }
  }
  return questions;
}

function extractPlacementTips(sections) {
  const sec = sections.find((s) => /placement tips/i.test(s.heading));
  if (!sec) return [];
  return sec.content.split("\n")
    .filter((l) => /^\s*[-*]\s+/.test(l) || /^\s*\d+[\.\)]\s+/.test(l))
    .slice(0, 10)
    .map((l) => l.replace(/^\s*(?:[-*]|\d+[\.\)])\s+/, "").trim())
    .filter(Boolean);
}

function toSlug(name, category) {
  return `${name}-${category}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "study-guide";
}

async function ensureUniqueSlug(collection, baseSlug) {
  const normalizedBase = (baseSlug || "study-guide").trim() || "study-guide";
  let candidate = normalizedBase;
  let suffix = 2;

  while (true) {
    const exists = await collection.findOne(
      { slug: candidate },
      { projection: { _id: 1 } },
    );

    if (!exists) {
      return candidate;
    }

    candidate = `${normalizedBase}-${suffix}`;
    suffix += 1;
  }
}

function estimateTokens(text) { return Math.max(1, Math.ceil(text.length / 4)); }

function estimateCost(model, inputTokens, outputTokens) {
  const e = COST_TABLE[model];
  if (!e) return 0;
  return (inputTokens * e.inputPer1M + outputTokens * e.outputPer1M) / 1_000_000;
}

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error("ERROR: MONGODB_URI not set"); process.exit(1); }

  const client = new MongoClient(uri);
  await client.connect();
  const dbName = process.env.MONGODB_DB_NAME || "campusdrive_dev";
  const db = client.db(dbName);

  try {
    // Load topics
    const topicFilter = {};
    if (categoryFilter) topicFilter.category = categoryFilter;
    if (priorityMax < 3) topicFilter.priority = { $lte: priorityMax };

    let topics = await db.collection("study_guide_topics")
      .find(topicFilter)
      .sort({ priority: 1, category: 1 })
      .toArray();

    if (skipExisting) {
      const existingSlugs = new Set(
        (await db.collection("study_guides").find({}, { projection: { slug: 1 } }).toArray()).map((d) => d.slug),
      );
      const before = topics.length;
      topics = topics.filter((t) => !existingSlugs.has(toSlug(t.name, t.category)));
      console.log(`Skipping ${before - topics.length} already-generated topics.`);
    }

    topics = topics.slice(0, limitNum);

    console.log(`\n=== Study Guide Batch Generator ===`);
    console.log(`Topics to generate: ${topics.length}`);
    console.log(`Difficulty: ${difficultyFilter}`);
    console.log(`Delay between calls: ${delayMs}ms`);

    if (dryRun) {
      console.log("\n[DRY RUN] Would generate:");
      for (const t of topics) {
        console.log(`  [P${t.priority}] ${t.category} > ${t.subcategory} > ${t.name}`);
      }
      return;
    }

    let generated = 0;
    let failed = 0;
    let totalCostUsd = 0;
    const failures = [];

    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];
      const progress = `[${i + 1}/${topics.length}]`;

      try {
        const prompt = buildPrompt(topic.name, topic.category, topic.subcategory, difficultyFilter);
        const promptHash = createHash("sha256").update(prompt).digest("hex").slice(0, 16);

        console.log(`${progress} Generating: ${topic.name}...`);

        const result = await callAiWithFailover(prompt);

        const inputTokens = estimateTokens(prompt);
        const outputTokens = estimateTokens(result.text);
        const costUsd = estimateCost(result.model, inputTokens, outputTokens);

        const sections = parseSections(result.text);
        const keyConcepts = extractKeyConcepts(sections);
        const practiceQuestions = extractPracticeQuestions(sections);
        const placementTips = extractPlacementTips(sections);
        const wordCount = result.text.split(/\s+/).filter(Boolean).length;
        const readMinutes = Math.max(1, Math.ceil(wordCount / 250));
        const slug = await ensureUniqueSlug(db.collection("study_guides"), toSlug(topic.name, topic.category));
        const overviewSection = sections.find((s) => /overview/i.test(s.heading));
        const summary = overviewSection
          ? overviewSection.content.split("\n").filter((l) => l.trim()).slice(0, 3).join(" ").slice(0, 300)
          : sections[0].content.slice(0, 300);

        const now = new Date().toISOString();
        const guideId = randomUUID();

        await db.collection("study_guides").insertOne({
          id: guideId,
          tenant_id: null,
          topic_name: topic.name,
          title: `${topic.name} - Placement Study Guide`,
          slug,
          category: topic.category,
          subcategory: topic.subcategory,
          difficulty: difficultyFilter,
          status: "review",
          summary,
          markdown_content: result.text,
          sections,
          key_concepts: keyConcepts,
          practice_questions: practiceQuestions,
          placement_tips: placementTips,
          estimated_read_minutes: readMinutes,
          word_count: wordCount,
          version: 1,
          ai_provider: result.provider,
          ai_model: result.model,
          generation_prompt_hash: promptHash,
          generation_cost_estimate_usd: costUsd,
          quality_score: null,
          review_notes: null,
          reviewed_by: null,
          reviewed_at: null,
          created_by: "batch-script",
          created_at: now,
          updated_at: now,
          published_at: null,
        });

        // Log cost
        await db.collection("study_guide_cost_log").insertOne({
          id: randomUUID(),
          tenant_id: null,
          guide_id: guideId,
          provider: result.provider,
          model: result.model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost_usd: costUsd,
          created_at: now,
        });

        generated++;
        totalCostUsd += costUsd;
        console.log(`  ✓ Done (${wordCount} words, ${sections.length} sections, ${result.provider}, $${costUsd.toFixed(5)})`);
      } catch (err) {
        failed++;
        failures.push({ name: topic.name, error: err.message });
        console.error(`  ✗ FAILED: ${err.message}`);
      }

      // Delay before next
      if (i < topics.length - 1 && delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    // Ensure indexes
    await db.collection("study_guides").createIndex({ slug: 1 }, { unique: true }).catch(() => {});
    await db.collection("study_guides").createIndex({ category: 1, status: 1, created_at: -1 }).catch(() => {});

    // Summary
    console.log(`\n=== Generation Complete ===`);
    console.log(`Generated: ${generated}/${topics.length}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total cost: $${totalCostUsd.toFixed(4)} (~₹${(totalCostUsd * 84).toFixed(2)})`);
    if (generated > 0) {
      console.log(`Average cost/guide: $${(totalCostUsd / generated).toFixed(5)}`);
    }
    if (failures.length > 0) {
      console.log("\nFailures:");
      for (const f of failures) {
        console.log(`  - ${f.name}: ${f.error.slice(0, 100)}`);
      }
    }
    console.log();
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
