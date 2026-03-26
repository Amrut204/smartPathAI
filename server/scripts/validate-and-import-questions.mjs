import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATION_DIR = path.join(__dirname, "question_generation");
const RAW_DIR = path.join(GENERATION_DIR, "raw");
const TOPICS_PATH = path.join(GENERATION_DIR, "topics.json");
const REPORT_PATH = path.join(GENERATION_DIR, "validation_report.json");
const COLLECTION = "question_bank_items";

function parseArgs(argv) {
  const args = {
    dryRun: false,
    provider: null,
    reportOnly: false,
    input: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") args.dryRun = true;
    else if (value === "--report-only") args.reportOnly = true;
    else if (value === "--provider") args.provider = argv[index + 1] ?? null;
    else if (value.startsWith("--provider=")) args.provider = value.split("=")[1];
    else if (value === "--input") args.input = argv[index + 1] ?? null;
    else if (value.startsWith("--input=")) args.input = value.split("=")[1];
  }

  return args;
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeQuestionRecord(record, topicMeta) {
  return {
    topic: topicMeta.topic,
    subject: topicMeta.subject,
    category: topicMeta.category,
    difficulty: String(record.difficulty ?? topicMeta.difficulty ?? "medium").toLowerCase(),
    questionText: String(record.questionText ?? record.question ?? "").trim(),
    options: Array.isArray(record.options)
      ? record.options.map((option) => String(option).trim())
      : Object.values(record.options ?? {}).map((option) => String(option).trim()),
    correctAnswer: String(record.correctAnswer ?? record.correct ?? "").trim().toUpperCase(),
    explanation: String(record.explanation ?? record.solution ?? "").trim(),
    estimatedTime: Number(record.estimatedTime ?? record.timeAllocation ?? 60),
    subtopic: String(record.subtopic ?? "").trim() || null,
    tags: Array.isArray(record.tags)
      ? record.tags.map((value) => String(value).trim()).filter(Boolean)
      : Array.isArray(record.conceptsTested)
        ? record.conceptsTested.map((value) => String(value).trim()).filter(Boolean)
        : [],
    providerModel: topicMeta.model,
    llmSource: topicMeta.provider,
    generatedAt: topicMeta.generatedAt,
    generationCost: Number(topicMeta.cost?.inr ?? 0),
  };
}

function validateQuestion(question) {
  const errors = [];
  if (!question.questionText) errors.push("missing_questionText");
  if (!Array.isArray(question.options) || question.options.length !== 4) errors.push("invalid_options_count");
  if (!["A", "B", "C", "D"].includes(question.correctAnswer)) errors.push("invalid_correctAnswer");
  if (!question.explanation) errors.push("missing_explanation");
  if (new Set(question.options).size !== 4) errors.push("duplicate_options");
  if (!question.topic) errors.push("missing_topic");
  if (!question.subject) errors.push("missing_subject");
  if (!question.category) errors.push("missing_category");
  return errors;
}

function scoreQuality(question) {
  let score = 50;
  if (question.explanation.length >= 80) score += 15;
  if (question.tags.length >= 2) score += 10;
  if (question.subtopic) score += 10;
  if (question.estimatedTime >= 45 && question.estimatedTime <= 90) score += 10;
  if (question.questionText.length >= 40) score += 5;
  return Math.min(100, score);
}

async function getRawFiles(providerFilter) {
  const providers = await fs.readdir(RAW_DIR, { withFileTypes: true });
  const files = [];
  for (const provider of providers) {
    if (!provider.isDirectory()) continue;
    if (providerFilter && provider.name !== providerFilter) continue;
    const providerDir = path.join(RAW_DIR, provider.name);
    const entries = await fs.readdir(providerDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(path.join(providerDir, entry.name));
      }
    }
  }
  return files.sort();
}

async function getInputFiles(inputPath) {
  const stat = await fs.stat(inputPath);
  if (stat.isFile()) {
    return [inputPath];
  }

  const entries = await fs.readdir(inputPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && [".json", ".jsonl"].includes(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(inputPath, entry.name))
    .sort();
}

async function ensureIndexes(collection) {
  await collection.createIndex({ topic: 1, difficulty: 1 });
  await collection.createIndex({ subject: 1, category: 1 });
  await collection.createIndex({ llm_source: 1, status: 1 });
  await collection.createIndex({ questionHash: 1 }, { unique: true });
}

function hashKey(question) {
  return [
    question.topic.toLowerCase(),
    question.difficulty.toLowerCase(),
    question.questionText.toLowerCase(),
    question.options.map((option) => option.toLowerCase()).join("|"),
  ].join("||");
}

function normalizeSimilarityText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(left, right) {
  const leftTokens = new Set(normalizeSimilarityText(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeSimilarityText(right).split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function inferQuestionArray(items) {
  return items.every(
    (item) =>
      item
      && typeof item === "object"
      && (
        "questionText" in item
        || "question" in item
        || ("options" in item && "correctAnswer" in item)
      ),
  );
}

function extractQuestionSetsFromMasterJson(node, context = {}, sets = []) {
  if (Array.isArray(node)) {
    if (node.length > 0 && inferQuestionArray(node)) {
      sets.push({
        provider: String(context.provider ?? "master_import"),
        model: String(context.model ?? "manual_master_json"),
        topic: String(context.topic ?? "Imported Questions"),
        subject: String(context.subject ?? "aptitude"),
        category: String(context.category ?? "general"),
        difficulty: String(context.difficulty ?? "medium"),
        generatedAt: context.generatedAt ?? new Date().toISOString(),
        cost: context.cost ?? { inr: 0 },
        questions: node,
      });
      return sets;
    }

    node.forEach((item) => extractQuestionSetsFromMasterJson(item, context, sets));
    return sets;
  }

  if (!node || typeof node !== "object") {
    return sets;
  }

  const record = node;
  const nextContext = {
    provider: record.provider ?? record.llmSource ?? record.source ?? context.provider,
    model: record.model ?? record.providerModel ?? context.model,
    topic: record.topic ?? record.name ?? context.topic,
    subject: record.subject ?? context.subject,
    category: record.category ?? context.category,
    difficulty: record.difficulty ?? context.difficulty,
    generatedAt: record.generatedAt ?? context.generatedAt,
    cost: record.cost ?? context.cost,
  };

  if (Array.isArray(record.questions) && inferQuestionArray(record.questions)) {
    sets.push({
      provider: String(nextContext.provider ?? "master_import"),
      model: String(nextContext.model ?? "manual_master_json"),
      topic: String(nextContext.topic ?? "Imported Questions"),
      subject: String(nextContext.subject ?? "aptitude"),
      category: String(nextContext.category ?? "general"),
      difficulty: String(nextContext.difficulty ?? "medium"),
      generatedAt: nextContext.generatedAt ?? new Date().toISOString(),
      cost: nextContext.cost ?? { inr: 0 },
      questions: record.questions,
    });
  }

  if (Array.isArray(record.items) && inferQuestionArray(record.items)) {
    sets.push({
      provider: String(nextContext.provider ?? "master_import"),
      model: String(nextContext.model ?? "manual_master_json"),
      topic: String(nextContext.topic ?? "Imported Questions"),
      subject: String(nextContext.subject ?? "aptitude"),
      category: String(nextContext.category ?? "general"),
      difficulty: String(nextContext.difficulty ?? "medium"),
      generatedAt: nextContext.generatedAt ?? new Date().toISOString(),
      cost: nextContext.cost ?? { inr: 0 },
      questions: record.items,
    });
  }

  Object.entries(record).forEach(([key, value]) => {
    if (["questions", "items"].includes(key)) return;
    extractQuestionSetsFromMasterJson(value, nextContext, sets);
  });

  return sets;
}

async function generateDbReport(db) {
  const collection = db.collection(COLLECTION);
  const items = await collection.find({}, {
    projection: {
      _id: 0,
      llm_source: 1,
      topic: 1,
      difficulty: 1,
      generation_cost_inr: 1,
      validated: 1,
      is_duplicate: 1,
      status: 1,
    },
  }).toArray();

  const report = {
    totalInBank: items.length,
    validated: items.filter((item) => item.validated).length,
    duplicates: items.filter((item) => item.is_duplicate).length,
    byProvider: {},
    byTopic: {},
    byDifficulty: {},
    costSummaryINR: Number(items.reduce((sum, item) => sum + Number(item.generation_cost_inr ?? 0), 0).toFixed(4)),
  };

  for (const item of items) {
    const provider = String(item.llm_source ?? "unknown");
    const topic = String(item.topic ?? "unknown");
    const difficulty = String(item.difficulty ?? "unknown");
    report.byProvider[provider] = (report.byProvider[provider] ?? 0) + 1;
    report.byTopic[topic] = (report.byTopic[topic] ?? 0) + 1;
    report.byDifficulty[difficulty] = (report.byDifficulty[difficulty] ?? 0) + 1;
  }

  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await readJson(TOPICS_PATH, { providers: {} });
  const mongoUri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017";
  const dbName = process.env.MONGODB_DB_NAME ?? "campusdrive_dev";

  const client = new MongoClient(mongoUri);
  await client.connect();

  try {
    const db = client.db(dbName);
    const collection = db.collection(COLLECTION);
    await ensureIndexes(collection);

    if (args.reportOnly) {
      const report = await generateDbReport(db);
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const files = args.input ? await getInputFiles(path.resolve(args.input)) : await getRawFiles(args.provider);
    const report = {
      generatedFiles: files.length,
      totalGenerated: 0,
      validCount: 0,
      rejectedCount: 0,
      duplicateCount: 0,
      duplicateTypes: {
        exact: 0,
        fuzzy: 0,
      },
      importedCount: 0,
      errors: [],
      byProvider: {},
      byTopic: {},
      byDifficulty: {},
      costSummaryINR: 0,
    };

    const normalizedQuestions = [];
    const topicMetaMap = new Map();
    for (const [providerName, providerConfig] of Object.entries(config.providers ?? {})) {
      for (const topicConfig of providerConfig.topics ?? []) {
        topicMetaMap.set(`${providerName}::${topicConfig.topic}`, {
          provider: providerName,
          model: providerConfig.model,
          topic: topicConfig.topic,
          subject: topicConfig.subject,
          category: topicConfig.category,
          difficulty: topicConfig.difficulty,
        });
      }
    }

    for (const filePath of files) {
      const raw = await readJson(filePath, null);
      if (!raw) {
        report.errors.push({ filePath, error: "malformed_json_file" });
        continue;
      }

      const batches = args.input
        ? extractQuestionSetsFromMasterJson(raw)
        : [{
            provider: String(raw.provider ?? path.basename(path.dirname(filePath))),
            model: String(raw.model ?? path.basename(path.dirname(filePath))),
            topic: String(raw.topic ?? raw.parsed?.topic ?? raw.parsed?.metadata?.topic ?? ""),
            generatedAt: raw.generatedAt ?? new Date().toISOString(),
            cost: raw.cost ?? { inr: 0 },
            questions: Array.isArray(raw.parsed?.questions)
              ? raw.parsed.questions
              : Array.isArray(raw.questions)
                ? raw.questions
                : [],
          }];

      for (const batch of batches) {
        const provider = String(batch.provider ?? "master_import");
        const topic = String(batch.topic ?? "");
        const topicMeta = {
          ...(topicMetaMap.get(`${provider}::${topic}`) ?? {}),
          provider,
          model: String(batch.model ?? topicMetaMap.get(`${provider}::${topic}`)?.model ?? provider),
          topic: topic || String(batch.topic ?? "Imported Questions"),
          subject: String(batch.subject ?? topicMetaMap.get(`${provider}::${topic}`)?.subject ?? "aptitude"),
          category: String(batch.category ?? topicMetaMap.get(`${provider}::${topic}`)?.category ?? "general"),
          difficulty: String(batch.difficulty ?? topicMetaMap.get(`${provider}::${topic}`)?.difficulty ?? "medium"),
          generatedAt: batch.generatedAt ?? new Date().toISOString(),
          cost: batch.cost ?? { inr: 0 },
        };

        const questions = Array.isArray(batch.questions) ? batch.questions : [];
        report.totalGenerated += questions.length;

        for (const item of questions) {
          const normalized = normalizeQuestionRecord(item, topicMeta);
          const validationErrors = validateQuestion(normalized);
          if (validationErrors.length > 0) {
            report.rejectedCount += 1;
            report.errors.push({
              filePath,
              provider,
              topic: normalized.topic,
              question: normalized.questionText.slice(0, 120),
              validationErrors,
            });
            continue;
          }

          normalized.id = randomUUID();
          normalized.qualityScore = scoreQuality(normalized);
          normalized.validationErrors = [];
          normalized.validated = true;
          normalized.status = "draft";
          normalized.isDuplicate = false;
          normalized.duplicateOf = null;
          normalized.duplicateType = null;
          normalized.duplicateSimilarity = null;
          normalized.questionHash = hashKey(normalized);
          normalized.similarityText = normalizeSimilarityText(normalized.questionText);
          normalizedQuestions.push(normalized);
        }
      }
    }

    const existingRows = await collection.find(
      {},
      { projection: { _id: 0, id: 1, topic: 1, questionHash: 1, question_text: 1 } },
    ).toArray();
    const existingHashes = new Map(existingRows.map((row) => [String(row.questionHash), String(row.id)]));
    const existingByTopic = new Map();
    existingRows.forEach((row) => {
      const topicKey = String(row.topic ?? "unknown").toLowerCase();
      if (!existingByTopic.has(topicKey)) existingByTopic.set(topicKey, []);
      existingByTopic.get(topicKey).push({
        id: String(row.id),
        similarityText: normalizeSimilarityText(row.question_text),
      });
    });

    const seenHashes = new Map();
    const seenByTopic = new Map();

    for (const current of normalizedQuestions) {
      const topicKey = current.topic.toLowerCase();
      const exactDuplicateId = existingHashes.get(current.questionHash) ?? seenHashes.get(current.questionHash);
      if (exactDuplicateId) {
        current.isDuplicate = true;
        current.duplicateOf = exactDuplicateId;
        current.duplicateType = "exact";
        current.duplicateSimilarity = 1;
        report.duplicateCount += 1;
        report.duplicateTypes.exact += 1;
        continue;
      }

      const sameTopicCandidates = [
        ...(existingByTopic.get(topicKey) ?? []),
        ...(seenByTopic.get(topicKey) ?? []),
      ];
      const fuzzyMatch = sameTopicCandidates.find(
        (candidate) => tokenSimilarity(current.similarityText, candidate.similarityText) >= 0.9,
      );

      if (fuzzyMatch) {
        current.isDuplicate = true;
        current.duplicateOf = fuzzyMatch.id;
        current.duplicateType = "fuzzy";
        current.duplicateSimilarity = Number(tokenSimilarity(current.similarityText, fuzzyMatch.similarityText).toFixed(3));
        report.duplicateCount += 1;
        report.duplicateTypes.fuzzy += 1;
        continue;
      }

      seenHashes.set(current.questionHash, current.id);
      if (!seenByTopic.has(topicKey)) seenByTopic.set(topicKey, []);
      seenByTopic.get(topicKey).push({
        id: current.id,
        similarityText: current.similarityText,
      });
    }

    const timestamp = new Date().toISOString();
    const importable = normalizedQuestions.map((question) => ({
      id: question.id,
      question_text: question.questionText,
      options: question.options,
      correct_answer: question.correctAnswer,
      explanation: question.explanation,
      topic: question.topic,
      subject: question.subject,
      category: question.category,
      difficulty: question.difficulty,
      subtopic: question.subtopic,
      tags: question.tags,
      llm_source: question.llmSource,
      provider_model: question.providerModel,
      generated_at: question.generatedAt,
      generation_cost_inr: question.generationCost,
      estimated_time: question.estimatedTime,
      usage_count: 0,
      quality_score: question.qualityScore,
      status: question.status,
      validated: question.validated,
      validation_errors: question.validationErrors,
      is_duplicate: question.isDuplicate,
      duplicate_of: question.duplicateOf,
      duplicate_type: question.duplicateType,
      duplicate_similarity: question.duplicateSimilarity,
      flagged_for_mocks: false,
      review_notes: null,
      reviewed_by: null,
      reviewed_at: null,
      questionHash: question.questionHash,
      created_at: timestamp,
      updated_at: timestamp,
    }));

    report.validCount = importable.length;
    report.costSummaryINR = Number(importable.reduce((sum, item) => sum + Number(item.generation_cost_inr ?? 0), 0).toFixed(4));

    for (const item of importable) {
      report.byProvider[item.llm_source] = (report.byProvider[item.llm_source] ?? 0) + 1;
      report.byTopic[item.topic] = (report.byTopic[item.topic] ?? 0) + 1;
      report.byDifficulty[item.difficulty] = (report.byDifficulty[item.difficulty] ?? 0) + 1;
    }

    if (!args.dryRun && importable.length > 0) {
      const operations = importable.map((item) => ({
        updateOne: {
          filter: { questionHash: item.questionHash },
          update: { $setOnInsert: item },
          upsert: true,
        },
      }));
      const result = await collection.bulkWrite(operations, { ordered: false });
      report.importedCount = Number(result.upsertedCount ?? 0);
    }

    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
