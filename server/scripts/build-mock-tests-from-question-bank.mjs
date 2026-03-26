import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const COLLECTION = "question_bank_items";
const IMPORT_SOURCE = "ai_generated_question_bank";

const templates = {
  tcs: {
    key: "tcs",
    title: "TCS Pattern",
    description: "30 questions focused on quantitative and logical reasoning, aligned with common TCS campus hiring flow.",
    durationSec: 50 * 60,
    sections: [
      { subject: "aptitude", categories: ["quantitative"], count: 15, difficulties: ["medium"] },
      { subject: "aptitude", categories: ["logical"], count: 15, difficulties: ["medium"] }
    ]
  },
  infosys: {
    key: "infosys",
    title: "Infosys Pattern",
    description: "40 questions combining technical reasoning, aptitude, and logical thinking.",
    durationSec: 60 * 60,
    sections: [
      { subject: "technical", categories: ["dbms", "operating-systems", "networks", "programming", "data-structures", "algorithms"], count: 15, difficulties: ["easy", "medium", "hard"] },
      { subject: "aptitude", categories: ["quantitative"], count: 10, difficulties: ["easy", "medium"] },
      { subject: "aptitude", categories: ["logical"], count: 15, difficulties: ["medium", "hard"] }
    ]
  },
  wipro: {
    key: "wipro",
    title: "Wipro Pattern",
    description: "60 mixed questions covering quantitative aptitude, logical reasoning, and technical problem solving.",
    durationSec: 90 * 60,
    sections: [
      { subject: "aptitude", categories: ["quantitative"], count: 20, difficulties: ["medium", "hard"] },
      { subject: "aptitude", categories: ["logical"], count: 20, difficulties: ["medium", "hard"] },
      { subject: "technical", categories: ["programming", "data-structures", "algorithms", "dbms", "operating-systems", "networks"], count: 20, difficulties: ["medium", "hard"] }
    ]
  },
  general_aptitude: {
    key: "general_aptitude",
    title: "General Aptitude",
    description: "50-question mixed aptitude set covering quantitative and logical reasoning.",
    durationSec: 60 * 60,
    sections: [
      { subject: "aptitude", categories: ["quantitative"], count: 25, difficulties: ["easy", "medium", "hard"] },
      { subject: "aptitude", categories: ["logical"], count: 25, difficulties: ["easy", "medium", "hard"] }
    ]
  },
  technical_deep_dive: {
    key: "technical_deep_dive",
    title: "Technical Deep Dive",
    description: "40-question technical challenge focused on programming and data structures.",
    durationSec: 60 * 60,
    sections: [
      { subject: "technical", categories: ["programming"], count: 15, difficulties: ["medium", "hard"] },
      { subject: "technical", categories: ["data-structures"], count: 15, difficulties: ["medium", "hard"] },
      { subject: "technical", categories: ["algorithms"], count: 10, difficulties: ["medium", "hard"] }
    ]
  }
};

function parseArgs(argv) {
  const args = { template: null, count: 5, list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--list") args.list = true;
    else if (value === "--template") args.template = argv[index + 1] ?? null;
    else if (value.startsWith("--template=")) args.template = value.split("=")[1];
    else if (value === "--count") args.count = Number(argv[index + 1] ?? 5) || 5;
    else if (value.startsWith("--count=")) args.count = Number(value.split("=")[1]) || 5;
  }
  args.count = Math.max(1, Math.min(25, args.count));
  return args;
}

function shuffle(items) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function difficultyRank(value) {
  return { easy: 1, medium: 2, hard: 3 }[value] ?? 2;
}

function normalizeQuestionForMock(item) {
  const correctIndex = { A: 0, B: 1, C: 2, D: 3 }[String(item.correct_answer ?? "A")] ?? 0;
  return {
    text: String(item.question_text),
    options: Array.isArray(item.options) ? item.options.map((value) => String(value)) : [],
    correctIndex,
    explanation: String(item.explanation ?? ""),
  };
}

async function selectQuestions(collection, section, usedIds, desiredCount) {
  const query = {
    validated: true,
    status: { $in: ["reviewed", "approved"] },
    is_duplicate: { $ne: true },
    subject: section.subject,
    category: { $in: section.categories },
    difficulty: { $in: section.difficulties },
    id: { $nin: [...usedIds] },
  };

  const candidates = await collection.find(query, {
    projection: {
      _id: 0,
      id: 1,
      topic: 1,
      subtopic: 1,
      question_text: 1,
      options: 1,
      correct_answer: 1,
      explanation: 1,
      usage_count: 1,
      difficulty: 1,
      tags: 1,
    },
  }).toArray();

  const bySubtopic = new Map();
  for (const candidate of candidates) {
    const key = String(candidate.subtopic ?? candidate.topic ?? "general").toLowerCase();
    if (!bySubtopic.has(key)) bySubtopic.set(key, []);
    bySubtopic.get(key).push(candidate);
  }

  const selected = [];
  const buckets = shuffle([...bySubtopic.values()]).map((bucket) =>
    shuffle(bucket).sort((a, b) => {
      const usageDelta = Number(a.usage_count ?? 0) - Number(b.usage_count ?? 0);
      if (usageDelta !== 0) return usageDelta;
      return difficultyRank(String(a.difficulty)) - difficultyRank(String(b.difficulty));
    })
  );

  while (selected.length < desiredCount && buckets.some((bucket) => bucket.length > 0)) {
    for (const bucket of buckets) {
      if (selected.length >= desiredCount) break;
      const next = bucket.shift();
      if (!next) continue;
      if (usedIds.has(String(next.id))) continue;
      usedIds.add(String(next.id));
      selected.push(next);
    }
  }

  if (selected.length < desiredCount) {
    const fallback = shuffle(candidates).filter((candidate) => !usedIds.has(String(candidate.id)));
    for (const candidate of fallback) {
      if (selected.length >= desiredCount) break;
      usedIds.add(String(candidate.id));
      selected.push(candidate);
    }
  }

  return selected.slice(0, desiredCount);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    console.log(Object.keys(templates).join("\n"));
    return;
  }

  const mongoUri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017";
  const dbName = process.env.MONGODB_DB_NAME ?? "campusdrive_dev";
  const client = new MongoClient(mongoUri);
  await client.connect();

  try {
    const db = client.db(dbName);
    const questionBank = db.collection(COLLECTION);
    const mockTests = db.collection("mock_tests");
    const templateKeys = args.template ? [args.template] : Object.keys(templates);
    const now = new Date().toISOString();
    const created = [];
    const usedQuestionIds = new Set();

    for (const templateKey of templateKeys) {
      const template = templates[templateKey];
      if (!template) throw new Error(`Unknown template: ${templateKey}`);

      for (let variant = 1; variant <= args.count; variant += 1) {
        const selected = [];
        for (const section of template.sections) {
          const sectionQuestions = await selectQuestions(questionBank, section, usedQuestionIds, section.count);
          selected.push(...sectionQuestions);
        }

        const doc = {
          id: randomUUID(),
          tenant_id: null,
          created_by: null,
          title: `${template.title} Variant ${String(variant).padStart(2, "0")}`,
          description: template.description,
          topic_id: null,
          company_id: null,
          duration_sec: template.durationSec,
          difficulty: "medium",
          is_active: true,
          questions: selected.map(normalizeQuestionForMock),
          question_bank_refs: selected.map((item) => String(item.id)),
          created_at: now,
          updated_at: now,
          import_source: IMPORT_SOURCE,
          template_key: template.key,
        };

        await mockTests.updateOne(
          { import_source: IMPORT_SOURCE, template_key: template.key, title: doc.title },
          { $set: doc },
          { upsert: true },
        );

        if (selected.length > 0) {
          await questionBank.updateMany(
            { id: { $in: selected.map((item) => String(item.id)) } },
            { $inc: { usage_count: 1 }, $set: { updated_at: now } },
          );
        }

        created.push({ template: template.key, title: doc.title, questionCount: selected.length });
      }
    }

    const unusedCount = await questionBank.countDocuments({
      validated: true,
      status: { $in: ["reviewed", "approved"] },
      is_duplicate: { $ne: true },
      usage_count: 0,
    });

    console.log(JSON.stringify({ createdCount: created.length, created, unusedQuestions: unusedCount }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
