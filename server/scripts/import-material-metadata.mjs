import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { MongoClient } from "mongodb";

const IMPORT_SOURCE = "material_analysis_v1";
const VALID_DIFFICULTIES = new Set(["easy", "medium", "hard"]);

const TOPIC_NAME_BY_KEY = {
  aptitude: "Aptitude & Reasoning",
  dsa: "Data Structures & Algorithms",
  sql: "SQL & Databases",
  os: "Operating Systems",
  networking: "Computer Networks",
  dbms: "DBMS",
  oop: "Object Oriented Programming",
  java: "Java",
  python: "Python",
  c_programming: "C Programming",
  data_science: "Data Science",
  interview_prep: "Interview Preparation",
  general: "General",
};

function parseArgs(argv) {
  const args = {
    dryRun: false,
    purge: false,
    tenantSlug: "apex",
    tenantId: "",
    analysisDir: "",
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--purge") args.purge = true;
    else if (arg.startsWith("--tenant-slug=")) args.tenantSlug = arg.slice("--tenant-slug=".length);
    else if (arg.startsWith("--tenant-id=")) args.tenantId = arg.slice("--tenant-id=".length);
    else if (arg.startsWith("--analysis-dir=")) args.analysisDir = arg.slice("--analysis-dir=".length);
  }

  return args;
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function toSlug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function csvSplitLine(line) {
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

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function parseCsv(content) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = csvSplitLine(lines[0]).map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = csvSplitLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j += 1) {
      row[headers[j]] = (values[j] ?? "").trim();
    }
    rows.push(row);
  }

  return rows;
}

function readCsv(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return parseCsv(content);
}

function parseNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getDifficulty(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (VALID_DIFFICULTIES.has(normalized)) return normalized;
  return "easy";
}

function topicNameFromKey(topicKey) {
  if (TOPIC_NAME_BY_KEY[topicKey]) return TOPIC_NAME_BY_KEY[topicKey];
  const raw = String(topicKey ?? "general").replace(/_/g, " ").trim();
  return raw.length > 0 ? raw[0].toUpperCase() + raw.slice(1) : "General";
}

function isLikelyIdTitle(title) {
  const value = String(title ?? "").trim();
  if (!value) return true;
  if (/\d{10,}/.test(value)) return true;
  if (/^[\d\s_-]+$/.test(value)) return true;
  if (/^[a-f0-9-]{24,}$/i.test(value)) return true;
  return false;
}

function baseMockTitle(sourcePdf, companyName, topicKey) {
  const normalizedPath = String(sourcePdf ?? "").toLowerCase().replace(/\\/g, "/");

  if (normalizedPath.includes("aptitude/tcs nqt/verbal/")) return "TCS NQT Verbal Practice Test";
  if (normalizedPath.includes("aptitude/tcs nqt/")) return "TCS NQT Practice Test";
  if (normalizedPath.includes("infosys test series")) return "Infosys Test Series Practice Test";
  if (normalizedPath.includes("amazon sde test series")) return "Amazon SDE Practice Test";
  if (normalizedPath.includes("coding ninjas")) return "Coding Ninjas Practice Test";
  if (normalizedPath.includes("hackerrank coding")) return "HackerRank Coding Practice Test";
  if (normalizedPath.includes("hackerrank sql")) return "HackerRank SQL Practice Test";

  if (companyName) return `${companyName} Practice Test`;

  if (topicKey === "aptitude") return "Aptitude Practice Test";
  if (topicKey === "dsa") return "DSA Practice Test";
  if (topicKey === "sql") return "SQL Practice Test";
  if (topicKey === "python") return "Python Practice Test";
  if (topicKey === "java") return "Java Practice Test";

  return "General Mock Test";
}

function normalizeMockTitle(rawTitle, sourcePdf, companyName, topicKey, counters) {
  const cleaned = String(rawTitle ?? "").trim().replace(/\s+/g, " ");
  if (cleaned && !isLikelyIdTitle(cleaned)) return cleaned;

  const base = baseMockTitle(sourcePdf, companyName, topicKey);
  const next = (counters.get(base) ?? 0) + 1;
  counters.set(base, next);
  return `${base} ${next}`;
}

function placeholderQuestions(title, sourcePdf) {
  return [
    {
      text: `Placeholder question for "${title}" from ${sourcePdf}.`,
      options: [
        "Question extraction pending",
        "Run OCR first",
        "Use AI extraction pipeline",
        "Skip this test for now",
      ],
      correctIndex: 0,
      explanation: "Auto-generated placeholder. Replace with real questions from the source PDF.",
    },
  ];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const analysisDir = args.analysisDir
    ? path.resolve(process.cwd(), args.analysisDir)
    : path.resolve(scriptDir, "../../material/analysis");

  const resourcesPath = path.join(analysisDir, "resources_seed_metadata.csv");
  const vaultPath = path.join(analysisDir, "vault_seed_metadata.csv");
  const mockPath = path.join(analysisDir, "mock_tests_seed_metadata.csv");

  if (!fs.existsSync(resourcesPath) || !fs.existsSync(vaultPath) || !fs.existsSync(mockPath)) {
    throw new Error(`Missing CSV files in ${analysisDir}. Run PDF analysis first.`);
  }

  const resourceRows = readCsv(resourcesPath);
  const vaultRows = readCsv(vaultPath);
  const mockRows = readCsv(mockPath);

  const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";

  const client = new MongoClient(MONGO_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);

    let tenant = null;
    if (args.tenantId) {
      tenant = await db.collection("tenants").findOne({ id: args.tenantId }, { projection: { _id: 0, id: 1, slug: 1 } });
    } else if (args.tenantSlug) {
      tenant = await db.collection("tenants").findOne({ slug: args.tenantSlug }, { projection: { _id: 0, id: 1, slug: 1 } });
    }

    if (!tenant) {
      tenant = await db.collection("tenants").findOne({}, { projection: { _id: 0, id: 1, slug: 1 } });
    }
    if (!tenant) {
      throw new Error("No tenant found. Seed tenant data before importing material.");
    }

    const tenantId = String(tenant.id);
    const now = new Date().toISOString();

    const createdByUser = await db.collection("users").findOne(
      { tenant_id: tenantId, role: { $in: ["tpo", "admin"] } },
      { projection: { _id: 0, id: 1 } },
    );
    const createdBy = createdByUser ? String(createdByUser.id) : null;

    if (args.purge && !args.dryRun) {
      await Promise.all([
        db.collection("resources").deleteMany({ tenant_id: tenantId, import_source: IMPORT_SOURCE }),
        db.collection("vault_items").deleteMany({ tenant_id: tenantId, import_source: IMPORT_SOURCE }),
        db.collection("mock_tests").deleteMany({ tenant_id: tenantId, import_source: IMPORT_SOURCE }),
      ]);
    }

    const topicKeys = new Set();
    resourceRows.forEach((row) => topicKeys.add(row.topic_key || "general"));
    vaultRows.forEach((row) => topicKeys.add(row.topic_key || "general"));
    mockRows.forEach((row) => topicKeys.add(row.topic_key || "general"));

    const existingTopics = await db.collection("topics").find(
      { $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
      { projection: { _id: 0, id: 1, name: 1 } },
    ).toArray();

    const topicIdByKey = {};
    const topicByName = new Map(existingTopics.map((topic) => [normalizeName(topic.name), String(topic.id)]));
    const newTopics = [];
    for (const key of topicKeys) {
      const name = topicNameFromKey(key);
      const normalized = normalizeName(name);
      let topicId = topicByName.get(normalized);
      if (!topicId) {
        topicId = randomUUID();
        topicByName.set(normalized, topicId);
        newTopics.push({
          id: topicId,
          tenant_id: null,
          name,
          created_at: now,
          import_source: IMPORT_SOURCE,
        });
      }
      topicIdByKey[key] = topicId;
    }

    const companyNames = new Set();
    vaultRows.forEach((row) => {
      if ((row.company_name ?? "").trim()) companyNames.add(row.company_name.trim());
    });
    mockRows.forEach((row) => {
      if ((row.company_name ?? "").trim()) companyNames.add(row.company_name.trim());
    });

    const existingCompanies = await db.collection("companies").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, id: 1, name: 1 } },
    ).toArray();
    const companyIdByName = new Map(existingCompanies.map((company) => [normalizeName(company.name), String(company.id)]));

    const newCompanies = [];
    for (const name of companyNames) {
      const normalized = normalizeName(name);
      if (companyIdByName.has(normalized)) continue;

      let slug = toSlug(name);
      if (!slug) slug = `company-${randomUUID().slice(0, 8)}`;

      const id = randomUUID();
      companyIdByName.set(normalized, id);
      newCompanies.push({
        id,
        tenant_id: tenantId,
        name,
        slug,
        logo_url: null,
        created_at: now,
        import_source: IMPORT_SOURCE,
      });
    }

    const [existingResources, existingVault, existingMock] = await Promise.all([
      db.collection("resources").find(
        { tenant_id: tenantId, source_pdf: { $exists: true } },
        { projection: { _id: 0, source_pdf: 1 } },
      ).toArray(),
      db.collection("vault_items").find(
        { tenant_id: tenantId, source_pdf: { $exists: true } },
        { projection: { _id: 0, company_id: 1, source_pdf: 1, type: 1 } },
      ).toArray(),
      db.collection("mock_tests").find(
        { tenant_id: tenantId, source_pdf: { $exists: true } },
        { projection: { _id: 0, source_pdf: 1 } },
      ).toArray(),
    ]);

    const existingResourcePaths = new Set(existingResources.map((row) => String(row.source_pdf)));
    const existingVaultKeys = new Set(
      existingVault.map((row) => `${String(row.company_id)}|${String(row.source_pdf)}|${String(row.type ?? "")}`),
    );
    const existingMockPaths = new Set(existingMock.map((row) => String(row.source_pdf)));

    const resourcesToInsert = [];
    for (const row of resourceRows) {
      const sourcePdf = String(row.source_pdf ?? "");
      if (!sourcePdf || existingResourcePaths.has(sourcePdf)) continue;

      resourcesToInsert.push({
        id: randomUUID(),
        tenant_id: tenantId,
        title: String(row.title ?? "").trim() || `Resource from ${sourcePdf}`,
        description: String(row.description ?? "").trim(),
        url: String(row.url ?? "").trim() || `material/${sourcePdf}`,
        resource_type: String(row.resource_type ?? "pdf").trim() || "pdf",
        thumbnail_url: String(row.thumbnail_url ?? "").trim() || null,
        duration_sec: parseNumber(row.duration_sec, 1200),
        topic_id: topicIdByKey[row.topic_key || "general"] ?? null,
        is_active: String(row.is_active ?? "1") !== "0",
        source_pdf: sourcePdf,
        extractability: String(row.extractability ?? ""),
        pages: parseNumber(row.pages, 0),
        size_mb: parseNumber(row.size_mb, 0),
        import_source: IMPORT_SOURCE,
        created_at: now,
        updated_at: now,
      });
      existingResourcePaths.add(sourcePdf);
    }

    const vaultToInsert = [];
    for (const row of vaultRows) {
      const sourcePdf = String(row.source_pdf ?? "");
      const companyName = String(row.company_name ?? "").trim();
      if (!sourcePdf || !companyName) continue;

      const companyId = companyIdByName.get(normalizeName(companyName));
      if (!companyId) continue;

      const type = String(row.type ?? "notes").trim() || "notes";
      const dedupeKey = `${companyId}|${sourcePdf}|${type}`;
      if (existingVaultKeys.has(dedupeKey)) continue;

      vaultToInsert.push({
        id: randomUUID(),
        tenant_id: tenantId,
        company_id: companyId,
        type,
        title: String(row.title ?? "").trim() || `Vault item from ${sourcePdf}`,
        content: String(row.content ?? "").trim() || `Source: material/${sourcePdf}`,
        author: String(row.author ?? "").trim() || "Anonymous",
        difficulty: getDifficulty(row.difficulty),
        topic_id: topicIdByKey[row.topic_key || "general"] ?? null,
        source_pdf: sourcePdf,
        extractability: String(row.extractability ?? ""),
        pages: parseNumber(row.pages, 0),
        size_mb: parseNumber(row.size_mb, 0),
        import_source: IMPORT_SOURCE,
        created_at: now,
      });
      existingVaultKeys.add(dedupeKey);
    }

    const mockToInsert = [];
    const mockTitleCounters = new Map();
    for (const row of mockRows) {
      const sourcePdf = String(row.source_pdf ?? "");
      if (!sourcePdf || existingMockPaths.has(sourcePdf)) continue;

      const companyName = String(row.company_name ?? "").trim();
      const companyId = companyName ? (companyIdByName.get(normalizeName(companyName)) ?? null) : null;
      const topicKey = row.topic_key || "general";
      const title = normalizeMockTitle(row.title, sourcePdf, companyName, topicKey, mockTitleCounters);

      mockToInsert.push({
        id: randomUUID(),
        tenant_id: tenantId,
        created_by: createdBy,
        title,
        topic_id: topicIdByKey[topicKey] ?? null,
        company_id: companyId,
        duration_sec: parseNumber(row.duration_sec, 1800),
        difficulty: getDifficulty(row.difficulty),
        questions: placeholderQuestions(title, sourcePdf),
        is_active: String(row.is_active ?? "1") !== "0",
        source_pdf: sourcePdf,
        extractability: String(row.extractability ?? ""),
        pages: parseNumber(row.pages, 0),
        size_mb: parseNumber(row.size_mb, 0),
        import_source: IMPORT_SOURCE,
        created_at: now,
        updated_at: now,
      });
      existingMockPaths.add(sourcePdf);
    }

    if (!args.dryRun) {
      if (newTopics.length > 0) await db.collection("topics").insertMany(newTopics);
      if (newCompanies.length > 0) await db.collection("companies").insertMany(newCompanies);
      if (resourcesToInsert.length > 0) await db.collection("resources").insertMany(resourcesToInsert);
      if (vaultToInsert.length > 0) await db.collection("vault_items").insertMany(vaultToInsert);
      if (mockToInsert.length > 0) await db.collection("mock_tests").insertMany(mockToInsert);
    }

    console.log("Material metadata import complete");
    console.log(`Mode: ${args.dryRun ? "DRY RUN" : "WRITE"}`);
    console.log(`DB: ${DB_NAME}`);
    console.log(`Tenant: ${tenantId}`);
    console.log(`Topics created: ${newTopics.length}`);
    console.log(`Companies created: ${newCompanies.length}`);
    console.log(`Resources inserted: ${resourcesToInsert.length}`);
    console.log(`Vault items inserted: ${vaultToInsert.length}`);
    console.log(`Mock tests inserted: ${mockToInsert.length}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("Import failed:", error);
  process.exitCode = 1;
});
