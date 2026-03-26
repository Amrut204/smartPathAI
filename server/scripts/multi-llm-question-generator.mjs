import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import axios from "axios";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

import { promptTemplates } from "./question_generation/prompt-templates.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATION_DIR = path.join(__dirname, "question_generation");
const RAW_DIR = path.join(GENERATION_DIR, "raw");
const STATE_PATH = path.join(GENERATION_DIR, "state.json");
const TOPICS_PATH = path.join(GENERATION_DIR, "topics.json");
const REPORT_PATH = path.join(GENERATION_DIR, "generation-report.json");

const INR_PER_USD = 83;
const MAX_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 120000;

const colors = {
  reset: "\u001b[0m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  magenta: "\u001b[35m",
};

function log(message, color = "cyan") {
  const stamp = new Date().toISOString();
  const prefix = colors[color] ?? "";
  console.log(`${prefix}[${stamp}]${colors.reset} ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    provider: null,
    topic: null,
    resume: false,
    dryRun: false,
    offline: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--resume") args.resume = true;
    else if (value === "--dry-run") args.dryRun = true;
    else if (value === "--offline") args.offline = true;
    else if (value === "--provider") args.provider = argv[index + 1] ?? null;
    else if (value.startsWith("--provider=")) args.provider = value.split("=")[1];
    else if (value === "--topic") args.topic = argv[index + 1] ?? null;
    else if (value.startsWith("--topic=")) args.topic = value.split("=")[1];
  }

  return args;
}

const topicKeywordMap = {
  "Time & Distance": ["time", "distance", "speed", "train", "km", "m/s"],
  "Permutations & Combinations": ["permutation", "combination", "arrange", "select", "committee"],
  "Probability": ["probability", "chance", "dice", "card", "coin"],
  "Data Structures - Trees": ["tree", "binary tree", "bst", "traversal", "node"],
  "Algorithms - Dynamic Programming": ["dynamic programming", "memoization", "dp", "optimal substructure", "tabulation"],
  "Profit & Loss": ["profit", "loss", "discount", "marked price", "selling price", "cost price"],
  "Simple Interest & Compound Interest": ["simple interest", "compound interest", "principal", "rate", "amount"],
  "Blood Relations": ["blood", "brother", "sister", "mother", "father", "uncle", "aunt"],
  "Seating Arrangement": ["seating", "arrangement", "circular", "row", "sits", "left of", "right of"],
  "Puzzles": ["puzzle", "arrangement", "scheduling", "logic", "who among"],
  "DBMS - SQL Queries": ["sql", "select", "join", "group by", "dbms", "database", "query"],
  "Operating Systems - Process Management": ["process", "thread", "scheduler", "cpu", "deadlock", "os"],
  "Computer Networks - TCP/IP": ["tcp", "ip", "network", "packet", "subnet", "router", "http"],
  "Data Structures - Graphs": ["graph", "vertex", "edge", "bfs", "dfs", "shortest path"],
  "Number Series": ["series", "number", "sequence", "pattern", "next term"],
  "C Pointers": ["pointer", "address", "dereference", "malloc", "c language"],
  "Java OOP Concepts": ["java", "class", "object", "inheritance", "polymorphism", "encapsulation"],
  "Python Data Structures": ["python", "list", "tuple", "dictionary", "set"],
  "Data Structures - Arrays": ["array", "index", "contiguous", "subarray"],
  "Data Structures - Linked Lists": ["linked list", "node", "pointer", "singly linked", "doubly linked"],
  Percentage: ["percentage", "percent", "%", "increase", "decrease"],
  "Ratio & Proportion": ["ratio", "proportion", "share", "mixture"],
  Averages: ["average", "mean", "sum", "scores"],
  "Coding-Decoding": ["coding", "decoding", "code language", "letter pattern"],
  Syllogisms: ["syllogism", "all", "some", "none", "conclusion"],
};

const categoryKeywordMap = {
  quantitative: ["percentage", "ratio", "profit", "loss", "distance", "speed", "interest", "average", "probability", "permutation", "combination"],
  logical: ["blood", "relation", "series", "coding", "decoding", "syllogism", "arrangement", "puzzle", "direction"],
  "data-structures": ["array", "linked list", "tree", "graph", "stack", "queue", "node"],
  algorithms: ["algorithm", "dynamic programming", "greedy", "recursion", "complexity"],
  dbms: ["sql", "dbms", "database", "normalization", "join"],
  "operating-systems": ["process", "thread", "deadlock", "scheduler", "paging", "os"],
  networks: ["network", "tcp", "ip", "subnet", "protocol", "router"],
  programming: ["c", "java", "python", "pointer", "compiler", "oop", "function", "program"],
};

function normalizeText(value) {
  return String(value ?? "").toLowerCase();
}

function extractKeywords(topicConfig) {
  return [
    ...new Set([
      ...(topicKeywordMap[topicConfig.topic] ?? []),
      ...(categoryKeywordMap[topicConfig.category] ?? []),
      ...normalizeText(topicConfig.topic)
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 2 && !["and", "the", "for"].includes(token)),
    ]),
  ];
}

function inferDifficultyFromTitle(title) {
  const value = normalizeText(title);
  if (value.includes("(easy)") || value.includes(" easy")) return "easy";
  if (value.includes("(hard)") || value.includes(" hard")) return "hard";
  return "medium";
}

function estimateTimeFromQuestion(questionText) {
  const words = normalizeText(questionText).split(/\s+/).filter(Boolean).length;
  if (words <= 14) return 45;
  if (words <= 28) return 60;
  return 75;
}

async function loadOfflineQuestionPool() {
  const mongoUri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017";
  const dbName = process.env.MONGODB_DB_NAME ?? "campusdrive_dev";
  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    const docs = await client
      .db(dbName)
      .collection("mock_tests")
      .find(
        { import_source: { $in: ["scraped_question_bank_v1", "selected_material_folders_v1", "legacy_or_manual"] } },
        {
          projection: {
            _id: 0,
            title: 1,
            description: 1,
            difficulty: 1,
            import_source: 1,
            questions: 1,
          },
        },
      )
      .toArray();

    return docs.flatMap((doc) =>
      (doc.questions ?? []).map((question, index) => ({
        sourceId: `${doc.title}#${index}`,
        sourceTitle: doc.title,
        sourceDescription: doc.description ?? "",
        sourceDifficulty: doc.difficulty ?? inferDifficultyFromTitle(doc.title),
        importSource: doc.import_source ?? "legacy_or_manual",
        questionText: String(question.text ?? "").trim(),
        options: Array.isArray(question.options) ? question.options.map((option) => String(option).trim()) : [],
        correctAnswer: ["A", "B", "C", "D"][Number(question.correctIndex ?? 0)] ?? "A",
        explanation: String(question.explanation ?? "").trim(),
      })),
    );
  } finally {
    await client.close();
  }
}

function scoreOfflineCandidate(candidate, topicConfig, keywords) {
  const haystack = normalizeText([
    candidate.sourceTitle,
    candidate.sourceDescription,
    candidate.questionText,
    candidate.explanation,
  ].join(" "));

  let score = 0;
  for (const keyword of keywords) {
    if (haystack.includes(keyword)) score += 8;
  }
  if (normalizeText(candidate.sourceDifficulty) === normalizeText(topicConfig.difficulty)) score += 4;
  if (normalizeText(topicConfig.subject) === "technical" && haystack.match(/\b(sql|java|python|pointer|graph|tree|network|process)\b/)) score += 6;
  if (normalizeText(topicConfig.subject) === "aptitude" && haystack.match(/\b(profit|loss|ratio|percentage|distance|series|arrangement|syllogism)\b/)) score += 6;
  if (candidate.options.length === 4) score += 5;
  if (candidate.explanation && !/no explanation|let'?s discuss/i.test(candidate.explanation)) score += 5;
  return score;
}

function buildOfflineQuestion(candidate, topicConfig, providerName) {
  const base = {
    questionText: candidate.questionText,
    options: candidate.options,
    correctAnswer: candidate.correctAnswer,
    explanation:
      candidate.explanation && !/no explanation|let'?s discuss/i.test(candidate.explanation)
        ? candidate.explanation
        : `This question is mapped to ${topicConfig.topic}. The correct answer is ${candidate.correctAnswer} based on the original source question.`,
    estimatedTime: estimateTimeFromQuestion(candidate.questionText),
    subtopic: topicConfig.topic,
    tags: [...new Set([topicConfig.category, topicConfig.subject, ...extractKeywords(topicConfig).slice(0, 3)])],
  };

  if (providerName === "gemini") {
    return {
      ...base,
      alternativeMethods: "Offline mode reused an existing validated question from the local question pool.",
      commonMistakes: "Students may choose an incorrect option if they skip the key concept or rush the calculation.",
    };
  }
  if (providerName === "llama") {
    return {
      ...base,
      codeSnippet: null,
      language: null,
    };
  }
  if (providerName === "mistral") {
    return {
      ...base,
      pattern: topicConfig.category,
    };
  }
  return base;
}

async function buildOfflinePayload(providerName, providerConfig, topicConfig, offlinePool) {
  const keywords = extractKeywords(topicConfig);
  const ranked = offlinePool
    .map((candidate) => ({ candidate, score: scoreOfflineCandidate(candidate, topicConfig, keywords) }))
    .filter(({ candidate, score }) => candidate.questionText && candidate.options.length === 4 && score > 0)
    .sort((a, b) => b.score - a.score);

  const seen = new Set();
  const selected = [];
  for (const { candidate } of ranked) {
    const key = normalizeText(candidate.questionText);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(buildOfflineQuestion(candidate, topicConfig, providerName));
    if (selected.length >= topicConfig.count) break;
  }

  if (selected.length < topicConfig.count) {
    const fallback = offlinePool.filter((candidate) => candidate.questionText && candidate.options.length === 4);
    for (const candidate of fallback) {
      const key = normalizeText(candidate.questionText);
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(buildOfflineQuestion(candidate, topicConfig, providerName));
      if (selected.length >= topicConfig.count) break;
    }
  }

  return {
    provider: providerName,
    model: `${providerConfig.model}-offline`,
    topic: topicConfig.topic,
    subject: topicConfig.subject,
    category: topicConfig.category,
    difficulty: topicConfig.difficulty,
    promptStyle: providerConfig.promptStyle,
    generatedAt: new Date().toISOString(),
    elapsedMs: 0,
    count: selected.length,
    cost: { inputTokens: 0, outputTokens: 0, usd: 0, inr: 0 },
    prompt: promptTemplates[providerConfig.promptStyle](topicConfig.topic, topicConfig.difficulty, topicConfig.count),
    rawText: JSON.stringify({ questions: selected }),
    parsed: { questions: selected },
    providerPayload: { mode: "offline", source: "existing_mock_tests", questionCount: selected.length },
    offlineSource: true,
  };
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function getApiKey(providerName, providerConfig) {
  const envFallbacks = {
    claude: ["ANTHROPIC_API_KEY"],
    gpt4: ["OPENAI_API_KEY"],
    gemini: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
    llama: ["TOGETHER_API_KEY"],
    mistral: ["TOGETHER_API_KEY"],
  };
  const candidates = [providerConfig.apiKeyEnv, ...(envFallbacks[providerName] ?? [])].filter(Boolean);
  for (const name of candidates) {
    if (process.env[name]) return process.env[name];
  }
  return null;
}

function topicFileName(topic) {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function stripCodeFences(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function extractJsonPayload(text) {
  const cleaned = stripCodeFences(text);
  const objectStart = cleaned.indexOf("{");
  const objectEnd = cleaned.lastIndexOf("}");
  const arrayStart = cleaned.indexOf("[");
  const arrayEnd = cleaned.lastIndexOf("]");

  if (objectStart >= 0 && objectEnd > objectStart) return cleaned.slice(objectStart, objectEnd + 1);
  if (arrayStart >= 0 && arrayEnd > arrayStart) return `{"questions": ${cleaned.slice(arrayStart, arrayEnd + 1)}}`;
  return cleaned;
}

function estimateCostINR(providerConfig, inputChars, outputChars) {
  const inputTokens = Math.ceil(inputChars / 4);
  const outputTokens = Math.ceil(outputChars / 4);
  const usd =
    (inputTokens / 1000000) * Number(providerConfig.costPer1MInputTokens ?? 0) +
    (outputTokens / 1000000) * Number(providerConfig.costPer1MOutputTokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    usd,
    inr: Number((usd * INR_PER_USD).toFixed(4)),
  };
}

function initializeState(config) {
  const state = {
    version: config.version ?? "1.0",
    lastRun: null,
    totalGenerated: 0,
    totalCost: 0,
    providers: {},
  };

  for (const [providerName, providerConfig] of Object.entries(config.providers ?? {})) {
    state.providers[providerName] = { topics: {} };
    for (const topicConfig of providerConfig.topics ?? []) {
      state.providers[providerName].topics[topicConfig.topic] = {
        status: "pending",
        attempts: 0,
        lastAttempt: null,
        generatedCount: 0,
        cost: 0,
        outputFile: null,
      };
    }
  }

  return state;
}

function mergeState(baseState, config) {
  const merged = {
    ...initializeState(config),
    ...baseState,
    providers: {},
  };

  const templateState = initializeState(config);
  for (const [providerName, providerConfig] of Object.entries(config.providers ?? {})) {
    const existingTopics = baseState.providers?.[providerName]?.topics ?? {};
    const providerTopics = {};
    for (const topicConfig of providerConfig.topics ?? []) {
      providerTopics[topicConfig.topic] = {
        ...templateState.providers[providerName].topics[topicConfig.topic],
        ...(existingTopics[topicConfig.topic] ?? {}),
      };
    }
    merged.providers[providerName] = { topics: providerTopics };
  }

  return merged;
}

async function saveState(state) {
  state.lastRun = new Date().toISOString();
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

async function saveReport(report) {
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
}

async function ensureLayout(config) {
  await ensureDir(GENERATION_DIR);
  await ensureDir(RAW_DIR);
  for (const providerName of Object.keys(config.providers ?? {})) {
    await ensureDir(path.join(RAW_DIR, providerName));
  }
}

async function callClaude(prompt, providerConfig, apiKey) {
  const response = await axios.post(
    providerConfig.endpoint,
    {
      model: providerConfig.model,
      max_tokens: 8000,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }],
    },
    {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
    },
  );
  const content = response.data?.content?.map((entry) => entry?.text ?? "").join("\n") ?? "";
  return { rawText: content, providerPayload: response.data };
}

async function callGPT4(prompt, providerConfig, apiKey) {
  const response = await axios.post(
    providerConfig.endpoint,
    {
      model: providerConfig.model,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return only valid JSON." },
        { role: "user", content: prompt },
      ],
    },
    {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
    },
  );
  const content = response.data?.choices?.[0]?.message?.content ?? "";
  return { rawText: content, providerPayload: response.data };
}

async function callGemini(prompt, providerConfig, apiKey) {
  const candidateModels = [
    providerConfig.model,
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
  ].filter(Boolean);

  let lastError = null;

  for (const model of candidateModels) {
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            responseMimeType: "application/json",
          },
        },
        {
          timeout: REQUEST_TIMEOUT_MS,
          headers: { "content-type": "application/json" },
        },
      );
      const content = response.data?.candidates?.[0]?.content?.parts?.map((part) => part?.text ?? "").join("\n") ?? "";
      return { rawText: content, providerPayload: response.data, resolvedModel: model };
    } catch (error) {
      lastError = error;
      if (error?.response?.status !== 404) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Gemini request failed");
}

async function callTogether(prompt, providerConfig, apiKey) {
  const response = await axios.post(
    providerConfig.endpoint,
    {
      model: providerConfig.model,
      temperature: 0.7,
      messages: [
        { role: "system", content: "Return only valid JSON." },
        { role: "user", content: prompt },
      ],
    },
    {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
    },
  );
  const content = response.data?.choices?.[0]?.message?.content ?? "";
  return { rawText: content, providerPayload: response.data };
}

const providerCallers = {
  claude: callClaude,
  gpt4: callGPT4,
  gemini: callGemini,
  llama: callTogether,
  mistral: callTogether,
};

function isRetryable(error) {
  const status = error?.response?.status;
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  return Boolean(error?.code && ["ECONNRESET", "ETIMEDOUT", "ECONNABORTED"].includes(error.code));
}

function validateRawPayload(parsed) {
  return parsed && typeof parsed === "object" && Array.isArray(parsed.questions) && parsed.questions.length > 0;
}

async function generateTopic({ providerName, providerConfig, topicConfig, state, args, report }) {
  const topicState = state.providers[providerName].topics[topicConfig.topic];
  const outputFile = path.join(RAW_DIR, providerName, `${topicFileName(topicConfig.topic)}.json`);

  if (args.resume && topicState.status === "completed" && topicState.outputFile) {
    log(`Skipping completed topic ${providerName} :: ${topicConfig.topic}`, "yellow");
    return;
  }

  const apiKey = getApiKey(providerName, providerConfig);
  if (!apiKey && !args.dryRun) {
    topicState.status = "failed";
    topicState.lastAttempt = new Date().toISOString();
    topicState.error = `Missing API key for ${providerName}`;
    report.failures.push({ provider: providerName, topic: topicConfig.topic, reason: topicState.error });
    await saveState(state);
    log(`Missing API key for ${providerName}; marked ${topicConfig.topic} failed`, "red");
    return;
  }

  const template = promptTemplates[providerConfig.promptStyle];
  if (!template) throw new Error(`Prompt template not found for ${providerConfig.promptStyle}`);

  const prompt = template(topicConfig.topic, topicConfig.difficulty, topicConfig.count);

  if (args.dryRun) {
    topicState.outputFile = outputFile;
    log(`[DRY RUN] ${providerName} :: ${topicConfig.topic} -> ${outputFile}`, "magenta");
    return;
  }

  topicState.status = "in_progress";
  await saveState(state);

  for (let attempt = topicState.attempts + 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    topicState.attempts = attempt;
    topicState.lastAttempt = new Date().toISOString();
    await saveState(state);
    log(`Generating ${providerName} :: ${topicConfig.topic} (attempt ${attempt}/${MAX_ATTEMPTS})`, "cyan");

    try {
      const caller = providerCallers[providerName];
      const startedAt = Date.now();
      const { rawText, providerPayload, resolvedModel } = await caller(prompt, providerConfig, apiKey);
      const parsed = JSON.parse(extractJsonPayload(rawText));
      if (!validateRawPayload(parsed)) {
        throw new Error("Provider response missing questions array");
      }

      const cost = estimateCostINR(providerConfig, prompt.length, rawText.length);
      const record = {
        provider: providerName,
        model: resolvedModel ?? providerConfig.model,
        topic: topicConfig.topic,
        subject: topicConfig.subject,
        category: topicConfig.category,
        difficulty: topicConfig.difficulty,
        promptStyle: providerConfig.promptStyle,
        generatedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        count: parsed.questions.length,
        cost,
        prompt,
        rawText,
        parsed,
        providerPayload,
      };

      await fs.writeFile(outputFile, JSON.stringify(record, null, 2));

      topicState.status = "completed";
      topicState.generatedCount = parsed.questions.length;
      topicState.cost = cost.inr;
      topicState.outputFile = outputFile;
      topicState.error = null;
      state.totalGenerated += parsed.questions.length;
      state.totalCost = Number((state.totalCost + cost.inr).toFixed(4));
      report.completed.push({ provider: providerName, topic: topicConfig.topic, count: parsed.questions.length, costINR: cost.inr, outputFile });
      await saveState(state);
      log(`Completed ${providerName} :: ${topicConfig.topic} -> ${parsed.questions.length} questions, Rs ${cost.inr}`, "green");
      return;
    } catch (error) {
      const retryable = isRetryable(error);
      topicState.error = error instanceof Error ? error.message : String(error);
      if (attempt >= MAX_ATTEMPTS || !retryable) {
        topicState.status = "failed";
        report.failures.push({ provider: providerName, topic: topicConfig.topic, reason: topicState.error, retryable });
        await saveState(state);
        log(`Failed ${providerName} :: ${topicConfig.topic} -> ${topicState.error}`, "red");
        return;
      }
      log(`Retrying ${providerName} :: ${topicConfig.topic} after transient failure: ${topicState.error}`, "yellow");
      await sleep(DEFAULT_DELAY_MS * attempt);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await readJson(TOPICS_PATH, null);
  if (!config) throw new Error(`Missing topics config at ${TOPICS_PATH}`);

  await ensureLayout(config);
  const existingState = await readJson(STATE_PATH, null);
  const state = mergeState(existingState ?? {}, config);
  await saveState(state);

  const report = {
    startedAt: new Date().toISOString(),
    completed: [],
    failures: [],
    filters: args,
  };
  const offlinePool = args.offline ? await loadOfflineQuestionPool() : null;

  for (const [providerName, providerConfig] of Object.entries(config.providers ?? {})) {
    if (args.provider && providerName !== args.provider) continue;

    for (const topicConfig of providerConfig.topics ?? []) {
      if (args.topic && topicConfig.topic !== args.topic) continue;

      if (args.offline && !args.dryRun) {
        const topicState = state.providers[providerName].topics[topicConfig.topic];
        const outputFile = path.join(RAW_DIR, providerName, `${topicFileName(topicConfig.topic)}.json`);
        const payload = await buildOfflinePayload(providerName, providerConfig, topicConfig, offlinePool ?? []);
        await fs.writeFile(outputFile, JSON.stringify(payload, null, 2));
        topicState.status = "completed";
        topicState.generatedCount = payload.count;
        topicState.cost = 0;
        topicState.outputFile = outputFile;
        topicState.attempts = 1;
        topicState.lastAttempt = new Date().toISOString();
        topicState.error = null;
        state.totalGenerated += payload.count;
        report.completed.push({ provider: providerName, topic: topicConfig.topic, count: payload.count, costINR: 0, outputFile, mode: "offline" });
        await saveState(state);
        log(`Offline-completed ${providerName} :: ${topicConfig.topic} -> ${payload.count} questions`, "green");
      } else {
        await generateTopic({ providerName, providerConfig, topicConfig, state, args, report });
      }
      if (!args.dryRun) await sleep(DEFAULT_DELAY_MS);
    }
  }

  report.finishedAt = new Date().toISOString();
  report.totalGenerated = state.totalGenerated;
  report.totalCost = state.totalCost;
  await saveReport(report);
  log(`Generation run finished. Total generated: ${state.totalGenerated}, total cost: Rs ${state.totalCost}`, "magenta");
}

main().catch((error) => {
  log(error instanceof Error ? error.stack ?? error.message : String(error), "red");
  process.exitCode = 1;
});
