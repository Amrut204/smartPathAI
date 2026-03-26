import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { MongoClient } from "mongodb";

const IMPORT_SOURCE = "scraped_question_bank_v1";
const DEFAULT_TEST_SIZE = 30;

const SOURCE_FILES = [
  "placement_scraper_output/questions/examveda_questions.jsonl",
  "placement_scraper_output/questions/sanfoundry_questions.jsonl",
  "placement_scraper_output/questions/learntheta_questions.jsonl",
];

const TOPIC_CONFIGS = [
  { name: "HR Interview", patterns: [/hr interview/i, /group discussion/i, /interview questions/i, /behavioral/i] },
  { name: "Competitive English", patterns: [/competitive english/i, /english/i, /grammar/i, /verbal/i, /sentence/i, /synonym/i, /antonym/i, /reading comprehension/i] },
  { name: "Aptitude & Reasoning", patterns: [/aptitude/i, /reasoning/i, /arithmetic/i, /quantitative/i, /probability/i, /ratio/i, /percentage/i, /time and work/i, /profit/i, /loss/i, /number system/i] },
  { name: "SQL & Databases", patterns: [/\bsql\b/i, /database/i, /mysql/i, /oracle/i, /postgres/i, /rdbms/i] },
  { name: "DBMS", patterns: [/\bdbms\b/i, /database management/i] },
  { name: "Operating Systems", patterns: [/operating system/i, /\bos\b/i, /\bunix\b/i, /\blinux\b/i, /process scheduling/i, /deadlock/i] },
  { name: "Computer Networks", patterns: [/network/i, /\bcn\b/i, /protocol/i, /routing/i, /tcp/i, /ip address/i] },
  { name: "OOPs", patterns: [/object oriented/i, /\boops\b/i, /inheritance/i, /polymorphism/i, /encapsulation/i] },
  { name: "Python Programming", patterns: [/\bpython\b/i] },
  { name: "Java Programming", patterns: [/\bjava\b/i, /\bjvm\b/i] },
  { name: "JavaScript", patterns: [/\bjavascript\b/i, /\bjs\b/i, /node\.js/i] },
  { name: "C++ Programming", patterns: [/\bc plus plus\b/i, /\bc\+\+\b/i] },
  { name: "C Programming", patterns: [/\bc programming\b/i, /\bansi c\b/i, /\bc language\b/i] },
  { name: "Data Science & Analytics", patterns: [/data science/i, /analytics/i, /hadoop/i, /big data/i, /business intelligence/i, /\betl\b/i] },
  { name: "AI & Machine Learning", patterns: [/machine learning/i, /artificial intelligence/i, /\bai\b/i, /deep learning/i, /neural network/i] },
  { name: "Data Structures & Algorithms", patterns: [/computer science/i, /data structure/i, /algorithm/i, /array/i, /stack/i, /queue/i, /tree/i, /graph/i, /searching/i, /sorting/i, /software engineering/i, /computer graphics/i] },
  { name: "Electrical Engineering", patterns: [/electrical engineering/i, /power systems/i, /electrical machines/i, /circuit theory/i, /control systems/i, /switchgear/i, /transformer/i] },
  { name: "Electronics & Communication", patterns: [/electronics and communications engineering/i, /electronics/i, /communication systems/i, /digital circuits/i, /microprocessor/i, /microcontroller/i, /signals/i, /vlsi/i, /arduino/i, /wireless/i] },
  { name: "Mechanical Engineering", patterns: [/mechanical engineering/i, /thermodynamics/i, /heat transfer/i, /machine design/i, /manufacturing/i, /fluid mechanics/i, /strength of materials/i, /production engineering/i] },
  { name: "Civil Engineering", patterns: [/civil engineering/i, /surveying/i, /structural/i, /geotechnical/i, /transportation engineering/i, /environmental engineering/i, /concrete/i, /soil mechanics/i] },
];

function parseArgs(argv) {
  const args = {
    dryRun: false,
    purge: false,
    testSize: DEFAULT_TEST_SIZE,
  };

  argv.forEach((arg) => {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--purge") args.purge = true;
    else if (arg.startsWith("--test-size=")) {
      args.testSize = Math.max(15, Math.min(100, Number(arg.split("=")[1]) || DEFAULT_TEST_SIZE));
    }
  });

  return args;
}

function resolveRoot() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDir, "../..");
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeOption(option) {
  return normalizeText(String(option ?? "").replace(/^\(?[A-Ha-h0-9]+[\)\].:\-]\s*/, ""));
}

function correctIndexFromAnswer(answer, options) {
  if (!options.length) return 0;
  const value = normalizeText(answer).toUpperCase();
  if (/^[A-H]$/.test(value)) {
    const index = value.charCodeAt(0) - 65;
    if (index >= 0 && index < options.length) return index;
  }
  const direct = options.findIndex((option) => option.toLowerCase() === value.toLowerCase());
  if (direct >= 0) return direct;
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= options.length) return numeric - 1;
  return 0;
}

function inferCanonicalTopic(row) {
  const topic = normalizeText(row.topic);
  const subtopic = normalizeText(row.subtopic);
  const question = normalizeText(row.question);
  const track = normalizeText(row.track);
  const haystack = `${topic} ${subtopic} ${question} ${track}`;

  for (const config of TOPIC_CONFIGS) {
    if (config.patterns.some((pattern) => pattern.test(haystack))) {
      return config.name;
    }
  }

  if (/^verbal$/i.test(track)) return "Competitive English";
  if (/^hr interview$/i.test(track)) return "HR Interview";
  if (/^aptitude$/i.test(track)) return "Aptitude & Reasoning";
  if (/^analyst\/data crossover$/i.test(track)) return "Data Science & Analytics";
  if (/^software placement crossover$/i.test(track)) return "Data Structures & Algorithms";
  if (/^technical interview$/i.test(track)) return "Data Structures & Algorithms";

  return null;
}

function isPlacementRelevant(row) {
  const topic = normalizeText(row.topic);
  const subtopic = normalizeText(row.subtopic);
  const question = normalizeText(row.question);
  const track = normalizeText(row.track);
  const haystack = `${topic} ${subtopic} ${question} ${track}`.toLowerCase();

  const denyPatterns = [
    /\bbanking\b/,
    /\bcommerce\b/,
    /\baccount/i,
    /\btax/i,
    /\beconomics?\b/,
    /\bhistory\b/,
    /\bgeography\b/,
    /\bpolity\b/,
    /\bchemistry\b/,
    /\bbiology\b/,
    /\bbotany\b/,
    /\bzoology\b/,
    /\bagriculture\b/,
    /\bnursing\b/,
    /\banatomy\b/,
    /\bphysiology\b/,
    /\bhotel\b/,
    /\btourism\b/,
    /\bpharmacy\b/,
    /\blaw\b/,
    /\bcurrent affairs\b/,
    /\bstate gk\b/,
    /\bgeneral knowledge\b/,
    /\bsociology\b/,
    /\bphilosophy\b/,
    /\bpsychology\b/,
    /\bmanagement\b/,
    /\bgeological engineering\b/,
    /\bmining engineering\b/,
    /\bmetallurgical engineering\b/,
    /\bbiotechnology\b/,
    /\bchemical engineering\b/,
    /\bautomobile engineering\b/,
  ];

  return !denyPatterns.some((pattern) => pattern.test(haystack));
}

function parseDifficulty(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "easy" || normalized === "medium" || normalized === "hard") return normalized;
  return "medium";
}

function pushQuestion(questionPool, row, sourceFile) {
  if (!isPlacementRelevant(row)) {
    questionPool.excluded += 1;
    return;
  }

  const canonicalTopic = inferCanonicalTopic(row);
  if (!canonicalTopic) {
    questionPool.unmapped += 1;
    return;
  }

  const question = normalizeText(row.question);
  if (question.length < 12) return;

  const options = (Array.isArray(row.options) ? row.options : [])
    .map((option) => normalizeOption(option))
    .filter((option) => option.length > 0);
  const uniqueOptions = [...new Map(options.map((option) => [option.toLowerCase(), option])).values()];
  if (uniqueOptions.length < 2 || uniqueOptions.length > 8) return;

  const correctIndex = correctIndexFromAnswer(row.answer, uniqueOptions);
  const explanation = normalizeText(row.explanation);
  const dedupeKey = `${question.toLowerCase()}||${uniqueOptions.map((option) => option.toLowerCase()).join("||")}`;
  if (questionPool.seen.has(dedupeKey)) return;

  questionPool.seen.add(dedupeKey);
  questionPool.items.push({
    text: question,
    options: uniqueOptions,
    correctIndex,
    explanation: explanation || undefined,
    difficulty: parseDifficulty(row.difficulty),
    canonicalTopic,
    sourceSite: normalizeText(row.source_site || path.basename(sourceFile, path.extname(sourceFile))),
    sourceUrl: normalizeText(row.source_url),
  });
}

function collectQuestions(rootDir) {
  const pool = {
    items: [],
    seen: new Set(),
    excluded: 0,
    unmapped: 0,
  };

  for (const relativeSource of SOURCE_FILES) {
    const absolutePath = path.join(rootDir, relativeSource);
    if (!fs.existsSync(absolutePath)) continue;

    const lines = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        pushQuestion(pool, row, relativeSource);
      } catch {
        // skip invalid JSONL
      }
    }
  }

  return pool;
}

function chunk(items, size) {
  const out = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function titleFor(topicName, difficulty, index) {
  const difficultyLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  return `${topicName} Practice Set ${String(index).padStart(2, "0")} (${difficultyLabel})`;
}

async function ensureTopics(db, topicNames) {
  const existing = await db.collection("topics").find(
    { $or: [{ tenant_id: null }, { tenant_id: { $exists: false } }] },
    { projection: { _id: 0, id: 1, name: 1 } },
  ).toArray();

  const byName = new Map(existing.map((topic) => [String(topic.name).toLowerCase(), String(topic.id)]));
  const now = new Date().toISOString();
  const toInsert = [];

  topicNames.forEach((topicName) => {
    const key = topicName.toLowerCase();
    if (!byName.has(key)) {
      const id = randomUUID();
      byName.set(key, id);
      toInsert.push({
        id,
        tenant_id: null,
        name: topicName,
        created_at: now,
        updated_at: now,
        import_source: IMPORT_SOURCE,
      });
    }
  });

  if (toInsert.length > 0) {
    await db.collection("topics").insertMany(toInsert, { ordered: false });
  }

  return byName;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = resolveRoot();

  const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";
  const client = new MongoClient(MONGO_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);
    const pool = collectQuestions(rootDir);
    const topicNames = [...new Set(pool.items.map((item) => item.canonicalTopic))].sort((a, b) => a.localeCompare(b));
    const topicIdByName = await ensureTopics(db, topicNames);

    const byTopicDifficulty = new Map();
    pool.items.forEach((item) => {
      const key = `${item.canonicalTopic}||${item.difficulty}`;
      if (!byTopicDifficulty.has(key)) byTopicDifficulty.set(key, []);
      byTopicDifficulty.get(key).push(item);
    });

    const testDocs = [];
    const baseTime = Date.now();
    let testCounter = 0;

    [...byTopicDifficulty.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([key, questions]) => {
        const [topicName, difficulty] = key.split("||");
        const topicId = topicIdByName.get(topicName.toLowerCase()) ?? null;
        const chunks = chunk(questions, args.testSize);
        chunks.forEach((questionsChunk, index) => {
          testCounter += 1;
          const createdAt = new Date(baseTime - testCounter * 1000).toISOString();
          testDocs.push({
            id: randomUUID(),
            tenant_id: null,
            created_by: null,
            title: titleFor(topicName, difficulty, index + 1),
            topic_id: topicId,
            company_id: null,
            duration_sec: Math.max(1200, questionsChunk.length * 75),
            difficulty,
            is_active: true,
            questions: questionsChunk.map((question) => ({
              text: question.text,
              options: question.options,
              correctIndex: question.correctIndex,
              explanation: question.explanation,
            })),
            created_at: createdAt,
            updated_at: createdAt,
            import_source: IMPORT_SOURCE,
            source_count: questionsChunk.length,
          });
        });
      });

    if (args.purge && !args.dryRun) {
      await db.collection("mock_tests").deleteMany({ import_source: IMPORT_SOURCE });
    }

    if (!args.dryRun && testDocs.length > 0) {
      await db.collection("mock_tests").insertMany(testDocs, { ordered: false });
    }

    const topicStats = [...byTopicDifficulty.entries()]
      .reduce((acc, [key, questions]) => {
        const [topicName] = key.split("||");
        acc.set(topicName, (acc.get(topicName) || 0) + questions.length);
        return acc;
      }, new Map());

    console.log("Scraped question bank import complete");
    console.log(`Mode: ${args.dryRun ? "DRY_RUN" : "WRITE"}`);
    console.log(`Import source: ${IMPORT_SOURCE}`);
    console.log(`Usable unique questions: ${pool.items.length}`);
    console.log(`Excluded off-scope questions: ${pool.excluded}`);
    console.log(`Unmapped questions: ${pool.unmapped}`);
    console.log(`Mock tests created: ${testDocs.length}`);
    console.log(`Topic count: ${topicNames.length}`);
    [...topicStats.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([topicName, count]) => {
        console.log(`  ${topicName}: ${count} questions`);
      });
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
