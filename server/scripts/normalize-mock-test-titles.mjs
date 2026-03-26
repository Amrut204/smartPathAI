import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MongoClient } from "mongodb";

const IMPORT_SOURCE = "material_analysis_v1";

function parseArgs(argv) {
  const args = {
    dryRun: false,
    tenantSlug: "apex",
    tenantId: "",
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--tenant-slug=")) args.tenantSlug = arg.slice("--tenant-slug=".length);
    else if (arg.startsWith("--tenant-id=")) args.tenantId = arg.slice("--tenant-id=".length);
  }
  return args;
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isLikelyIdTitle(title) {
  const value = String(title ?? "").trim();
  if (!value) return true;
  if (/\d{10,}/.test(value)) return true;
  if (/^[\d\s_-]+$/.test(value)) return true;
  if (/^[a-f0-9-]{24,}$/i.test(value)) return true;
  return false;
}

function inferTopicKeyFromName(topicName) {
  const normalized = normalizeName(topicName);
  if (normalized.includes("aptitude")) return "aptitude";
  if (normalized.includes("data structures") || normalized.includes("algorithm")) return "dsa";
  if (normalized.includes("sql")) return "sql";
  if (normalized.includes("python")) return "python";
  if (normalized.includes("java")) return "java";
  if (normalized.includes("network")) return "networking";
  if (normalized.includes("operating")) return "os";
  if (normalized.includes("dbms")) return "dbms";
  return "general";
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

async function resolveTenant(db, args) {
  if (args.tenantId) {
    const byId = await db.collection("tenants").findOne({ id: args.tenantId }, { projection: { _id: 0, id: 1, slug: 1 } });
    if (byId) return byId;
  }
  if (args.tenantSlug) {
    const bySlug = await db.collection("tenants").findOne({ slug: args.tenantSlug }, { projection: { _id: 0, id: 1, slug: 1 } });
    if (bySlug) return bySlug;
  }
  return db.collection("tenants").findOne({}, { projection: { _id: 0, id: 1, slug: 1 } });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";

  const client = new MongoClient(MONGO_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);
    const tenant = await resolveTenant(db, args);
    if (!tenant) {
      throw new Error("No tenant found.");
    }
    const tenantId = String(tenant.id);

    const [companies, topics, tests] = await Promise.all([
      db.collection("companies").find(
        { tenant_id: tenantId },
        { projection: { _id: 0, id: 1, name: 1 } },
      ).toArray(),
      db.collection("topics").find(
        { $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
        { projection: { _id: 0, id: 1, name: 1 } },
      ).toArray(),
      db.collection("mock_tests").find(
        { tenant_id: tenantId, import_source: IMPORT_SOURCE },
        { projection: { _id: 0, id: 1, title: 1, source_pdf: 1, company_id: 1, topic_id: 1 } },
      ).sort({ source_pdf: 1 }).toArray(),
    ]);

    const companyMap = new Map(companies.map((company) => [String(company.id), String(company.name)]));
    const topicMap = new Map(topics.map((topic) => [String(topic.id), String(topic.name)]));

    const counters = new Map();
    const rows = [];
    let changed = 0;

    for (const test of tests) {
      const oldTitle = String(test.title ?? "").trim();
      const sourcePdf = String(test.source_pdf ?? "");
      const companyName = test.company_id ? (companyMap.get(String(test.company_id)) ?? "") : "";
      const topicName = test.topic_id ? (topicMap.get(String(test.topic_id)) ?? "") : "";
      const topicKey = inferTopicKeyFromName(topicName);
      const newTitle = normalizeMockTitle(oldTitle, sourcePdf, companyName, topicKey, counters);

      const needsUpdate = newTitle !== oldTitle;
      rows.push({
        id: String(test.id),
        sourcePdf,
        oldTitle,
        newTitle,
        changed: needsUpdate,
      });

      if (needsUpdate && !args.dryRun) {
        await db.collection("mock_tests").updateOne(
          { id: String(test.id), tenant_id: tenantId },
          { $set: { title: newTitle, updated_at: new Date().toISOString() } },
        );
      }
      if (needsUpdate) changed += 1;
    }

    const report = {
      generatedAt: new Date().toISOString(),
      mode: args.dryRun ? "dry_run" : "write",
      tenantId,
      totalTestsScanned: tests.length,
      changedTitles: changed,
      rows,
    };

    const reportPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../material/analysis/mock_test_title_normalization_report.json",
    );
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

    console.log("Mock test title normalization complete");
    console.log(`Mode: ${args.dryRun ? "DRY RUN" : "WRITE"}`);
    console.log(`Tenant: ${tenantId}`);
    console.log(`Tests scanned: ${tests.length}`);
    console.log(`Titles changed: ${changed}`);
    console.log(`Report: ${reportPath}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("Normalization failed:", error);
  process.exitCode = 1;
});
