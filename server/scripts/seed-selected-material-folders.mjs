import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { MongoClient } from "mongodb";

const IMPORT_SOURCE = "selected_material_folders_v1";
const DEFAULT_TEST_SIZE = 20;

const TARGET_FOLDERS = [
  "Accenture-Placement-Practice-Sheet",
  "Aptitude-For-Placements",
  "CSE-Aptitude-Test-Practice-Hub",
  "Placement-Preparation",
  "Prepare-General-Aptitude",
  "analysis",
  "engineering-aptitude-test-questions",
  "scrapedData",
];

const TOPIC_NAME_BY_KEY = {
  aptitude: "Aptitude & Reasoning",
  dsa: "Data Structures & Algorithms",
  sql: "SQL & Databases",
  dbms: "DBMS",
  os: "Operating Systems",
  cn: "Computer Networks",
  oops: "OOPs",
  python: "Python Programming",
  java: "Java Programming",
  javascript: "JavaScript",
  ai_ml: "AI & Machine Learning",
};

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
      args.testSize = Math.max(10, Number(arg.split("=")[1]) || DEFAULT_TEST_SIZE);
    }
  });

  return args;
}

function resolveMaterialRoot() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(scriptDir, "../../material"),
    path.resolve(process.cwd(), "../material"),
    path.resolve(process.cwd(), "material"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found ?? candidates[0];
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeTitleFromPath(relativePath) {
  const base = path.basename(relativePath, path.extname(relativePath));
  return normalizeText(base.replace(/[_-]+/g, " "));
}

function inferTopicKey(text) {
  const value = String(text ?? "").toLowerCase();
  const checks = [
    ["aptitude", "aptitude"],
    ["quant", "aptitude"],
    ["reasoning", "aptitude"],
    ["profit", "aptitude"],
    ["percentage", "aptitude"],
    ["partnership", "aptitude"],
    ["average", "aptitude"],
    ["number system", "aptitude"],
    ["dsa", "dsa"],
    ["array", "dsa"],
    ["stack", "dsa"],
    ["queue", "dsa"],
    ["tree", "dsa"],
    ["graph", "dsa"],
    ["algorithm", "dsa"],
    ["sql", "sql"],
    ["database", "dbms"],
    ["dbms", "dbms"],
    ["operating system", "os"],
    ["os", "os"],
    ["network", "cn"],
    ["cn", "cn"],
    ["oop", "oops"],
    ["python", "python"],
    ["java", "java"],
    ["javascript", "javascript"],
    ["ai", "ai_ml"],
    ["machine learning", "ai_ml"],
  ];

  for (const [token, key] of checks) {
    if (value.includes(token)) return key;
  }
  return "aptitude";
}

function inferResourceType(extension, folderName) {
  if (extension === ".pdf") return "pdf";
  if (extension === ".md" || extension === ".txt" || (extension === "" && folderName === "Aptitude-For-Placements")) return "notes";
  if (extension === ".csv" || extension === ".json" || extension === ".jsonl") return "dataset";
  return "notes";
}

function shouldIncludeResource(folderName, extension, relativePath) {
  const rel = relativePath.toLowerCase();
  if (rel.includes("/.git/") || rel.includes("/node_modules/") || rel.includes("/__pycache__/")) return false;

  if (folderName === "Accenture-Placement-Practice-Sheet") {
    return [".pdf", ".md", ".txt"].includes(extension);
  }
  if (folderName === "Aptitude-For-Placements") {
    return extension === ".md" || extension === "";
  }
  if (folderName === "CSE-Aptitude-Test-Practice-Hub") {
    return extension === ".md";
  }
  if (folderName === "Placement-Preparation") {
    return extension === ".pdf" || extension === ".md";
  }
  if (folderName === "Prepare-General-Aptitude") {
    return extension === ".pdf" || extension === ".md";
  }
  if (folderName === "analysis") {
    return extension === ".csv" || extension === ".json" || extension === ".md";
  }
  if (folderName === "engineering-aptitude-test-questions") {
    return extension === ".csv" || extension === ".json";
  }
  if (folderName === "scrapedData") {
    return extension === ".jsonl" || extension === ".json" || extension === ".txt";
  }
  return false;
}

function collectResourceFiles(materialRoot) {
  const files = [];

  for (const folderName of TARGET_FOLDERS) {
    const folderPath = path.join(materialRoot, folderName);
    if (!fs.existsSync(folderPath)) continue;

    const stack = [folderPath];
    while (stack.length > 0) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__pycache__") {
            continue;
          }
          stack.push(absolutePath);
          continue;
        }
        if (!entry.isFile()) continue;

        const relativePath = path.relative(materialRoot, absolutePath).replace(/\\/g, "/");
        const extension = path.extname(entry.name).toLowerCase();

        if (!shouldIncludeResource(folderName, extension, relativePath)) continue;

        files.push({
          folderName,
          absolutePath,
          relativePath,
          extension,
          sizeBytes: fs.statSync(absolutePath).size,
        });
      }
    }
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function parseDelimitedLine(line, delimiter) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function readCsvRows(csvPath) {
  const content = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const delimiter = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ";" : ",";
  const headers = parseDelimitedLine(lines[0], delimiter).map((header) => header.toLowerCase().replace(/[\s_-]+/g, ""));

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseDelimitedLine(lines[i], delimiter);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

function normalizeOption(option) {
  return normalizeText(String(option ?? "").replace(/^\(?[A-Ha-h0-9]+[\)\].:\-]\s*/, ""));
}

function correctIndexFromAnswer(answer, options) {
  if (!options.length) return 0;
  const value = normalizeText(answer).toUpperCase();
  if (/^[A-H]$/.test(value)) {
    const idx = value.charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length) return idx;
  }
  const exact = options.findIndex((option) => option.toLowerCase() === value.toLowerCase());
  if (exact >= 0) return exact;
  const numberValue = Number(value);
  if (Number.isInteger(numberValue) && numberValue >= 1 && numberValue <= options.length) return numberValue - 1;
  return 0;
}

function pushQuestion(questionPool, rawQuestion) {
  const question = normalizeText(rawQuestion.question);
  if (question.length < 12) return;

  const options = (rawQuestion.options || [])
    .map((option) => normalizeOption(option))
    .filter((option) => option.length > 0);
  const uniqueOptions = [...new Map(options.map((option) => [option.toLowerCase(), option])).values()];

  if (uniqueOptions.length < 2 || uniqueOptions.length > 8) return;

  const correctIndex = correctIndexFromAnswer(rawQuestion.answer, uniqueOptions);
  const topicKey = inferTopicKey(`${rawQuestion.topic ?? ""} ${question}`);
  const key = `${question.toLowerCase()}||${uniqueOptions.map((option) => option.toLowerCase()).join("||")}`;
  if (questionPool.seen.has(key)) return;

  questionPool.seen.add(key);
  questionPool.items.push({
    text: question,
    options: uniqueOptions,
    correctIndex,
    explanation: normalizeText(rawQuestion.explanation ?? ""),
    topicKey,
    source: rawQuestion.source,
  });
}

function collectEngineeringCsvQuestions(materialRoot, questionPool) {
  const datasetDir = path.join(materialRoot, "engineering-aptitude-test-questions");
  if (!fs.existsSync(datasetDir)) return 0;

  const csvFiles = fs.readdirSync(datasetDir)
    .filter((name) => name.toLowerCase().endsWith(".csv"))
    .map((name) => path.join(datasetDir, name));

  let imported = 0;
  csvFiles.forEach((csvPath) => {
    const rows = readCsvRows(csvPath);
    rows.forEach((row) => {
      const options = [
        row.optiona,
        row.optionb,
        row.optionc,
        row.optiond,
        row.optione,
      ].filter(Boolean);
      const before = questionPool.items.length;
      pushQuestion(questionPool, {
        question: row.question,
        options,
        answer: row.answer,
        source: path.relative(materialRoot, csvPath).replace(/\\/g, "/"),
      });
      if (questionPool.items.length > before) imported += 1;
    });
  });

  return imported;
}

function collectScrapedJsonlQuestions(materialRoot, questionPool) {
  const candidates = [
    path.join(materialRoot, "scrapedData", "parsed_mocks.jsonl"),
    path.join(materialRoot, "scrapedData", "scripts", "parsed_mocks.jsonl"),
  ];

  let imported = 0;
  candidates.forEach((jsonlPath) => {
    if (!fs.existsSync(jsonlPath)) return;
    const lines = fs.readFileSync(jsonlPath, "utf8").split(/\r?\n/).filter(Boolean);
    lines.forEach((line) => {
      try {
        const parsed = JSON.parse(line);
        const before = questionPool.items.length;
        pushQuestion(questionPool, {
          question: parsed.question ?? parsed.text,
          options: Array.isArray(parsed.options) ? parsed.options : [],
          answer: parsed.correct_answer,
          explanation: parsed.explanation,
          topic: parsed.topic,
          source: path.relative(materialRoot, jsonlPath).replace(/\\/g, "/"),
        });
        if (questionPool.items.length > before) imported += 1;
      } catch {
        // skip invalid JSONL lines
      }
    });
  });

  return imported;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const materialRoot = resolveMaterialRoot();
  const now = new Date().toISOString();

  const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";

  const client = new MongoClient(MONGO_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);
    const tenants = await db.collection("tenants").find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray();
    if (tenants.length === 0) {
      throw new Error("No tenants found. Run base seed first.");
    }

    const topics = await db.collection("topics").find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray();
    const topicIdByName = new Map(topics.map((topic) => [String(topic.name).toLowerCase(), String(topic.id)]));

    const resourceFiles = collectResourceFiles(materialRoot);
    const resourcesByTenant = [];

    for (const tenant of tenants) {
      resourceFiles.forEach((file) => {
        const topicKey = inferTopicKey(file.relativePath);
        const topicName = TOPIC_NAME_BY_KEY[topicKey] ?? TOPIC_NAME_BY_KEY.aptitude;
        const topicId = topicIdByName.get(topicName.toLowerCase()) ?? null;
        const durationSec = Math.max(300, Math.min(14_400, Math.ceil(file.sizeBytes / 9000) * 60));
        const title = normalizeTitleFromPath(file.relativePath);
        const resourceType = inferResourceType(file.extension, file.folderName);

        resourcesByTenant.push({
          id: randomUUID(),
          tenant_id: String(tenant.id),
          topic_id: topicId,
          title: title || `${file.folderName} Resource`,
          description: `Imported from ${file.folderName} (${file.relativePath}).`,
          url: `material/${file.relativePath}`,
          resource_type: resourceType,
          source_pdf: file.extension === ".pdf" ? file.relativePath : null,
          thumbnail_url: null,
          duration_sec: durationSec,
          is_active: true,
          created_at: now,
          updated_at: now,
          import_source: IMPORT_SOURCE,
        });
      });
    }

    const questionPool = { items: [], seen: new Set() };
    const csvQuestionCount = collectEngineeringCsvQuestions(materialRoot, questionPool);
    const jsonlQuestionCount = collectScrapedJsonlQuestions(materialRoot, questionPool);

    const mockTestsByTenant = [];
    const questionsByTopic = new Map();
    questionPool.items.forEach((question) => {
      if (!questionsByTopic.has(question.topicKey)) questionsByTopic.set(question.topicKey, []);
      questionsByTopic.get(question.topicKey).push(question);
    });

    for (const tenant of tenants) {
      const createdBy = await db.collection("users").findOne(
        { tenant_id: String(tenant.id), role: { $in: ["tpo", "admin"] } },
        { projection: { _id: 0, id: 1 } },
      );

      for (const [topicKey, questions] of questionsByTopic.entries()) {
        const topicName = TOPIC_NAME_BY_KEY[topicKey] ?? TOPIC_NAME_BY_KEY.aptitude;
        const topicId = topicIdByName.get(topicName.toLowerCase()) ?? null;
        const chunks = chunk(questions, args.testSize);
        chunks.forEach((questionsChunk, index) => {
          const chunkNumber = index + 1;
          const difficulty = chunkNumber % 3 === 0 ? "hard" : chunkNumber % 2 === 0 ? "medium" : "easy";
          mockTestsByTenant.push({
            id: randomUUID(),
            tenant_id: String(tenant.id),
            created_by: createdBy ? String(createdBy.id) : null,
            title: `${topicName} Imported Test ${chunkNumber}`,
            topic_id: topicId,
            company_id: null,
            duration_sec: Math.max(1200, questionsChunk.length * 90),
            difficulty,
            is_active: true,
            questions: questionsChunk.map((question) => ({
              text: question.text,
              options: question.options,
              correctIndex: question.correctIndex,
              explanation: question.explanation || undefined,
            })),
            created_at: now,
            updated_at: now,
            import_source: IMPORT_SOURCE,
          });
        });
      }
    }

    if (args.purge && !args.dryRun) {
      await Promise.all([
        db.collection("resources").deleteMany({ import_source: IMPORT_SOURCE }),
        db.collection("mock_tests").deleteMany({ import_source: IMPORT_SOURCE }),
      ]);
    }

    if (!args.dryRun) {
      if (resourcesByTenant.length > 0) {
        await db.collection("resources").insertMany(resourcesByTenant, { ordered: false });
      }
      if (mockTestsByTenant.length > 0) {
        await db.collection("mock_tests").insertMany(mockTestsByTenant, { ordered: false });
      }
    }

    const folderStats = TARGET_FOLDERS.map((folderName) => ({
      folderName,
      resourceCount: resourceFiles.filter((file) => file.folderName === folderName).length,
    }));

    console.log("Selected folder seeding complete");
    console.log(`Mode: ${args.dryRun ? "DRY_RUN" : "WRITE"}`);
    console.log(`Import source: ${IMPORT_SOURCE}`);
    console.log(`Material root: ${materialRoot}`);
    console.log(`Tenants: ${tenants.length}`);
    folderStats.forEach((stat) => {
      console.log(`  ${stat.folderName}: resources=${stat.resourceCount}`);
    });
    console.log(`Engineering CSV questions ingested: ${csvQuestionCount}`);
    console.log(`Scraped JSONL questions ingested: ${jsonlQuestionCount}`);
    console.log(`Unique usable questions: ${questionPool.items.length}`);
    console.log(`Resources to insert: ${resourcesByTenant.length}`);
    console.log(`Mock tests to insert: ${mockTestsByTenant.length}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
