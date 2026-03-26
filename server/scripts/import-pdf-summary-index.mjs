import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MongoClient } from "mongodb";

const IMPORT_SOURCE = "pdf_summary_index_v1";

function parseArgs(argv) {
  const args = {
    dryRun: false,
    manifestPath: "",
  };

  argv.forEach((arg) => {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--manifest=")) args.manifestPath = arg.slice("--manifest=".length);
  });

  return args;
}

function resolveRoot() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDir, "../..");
}

function normalizePath(value) {
  return String(value ?? "").replace(/\\/g, "/").trim();
}

function loadManifest(manifestPath) {
  const lines = fs.readFileSync(manifestPath, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

function buildSearchIndex(summary) {
  return {
    import_source: IMPORT_SOURCE,
    imported_at: new Date().toISOString(),
    status: String(summary.status ?? "unknown"),
    page_count: typeof summary.page_count === "number" ? summary.page_count : null,
    title: String(summary.title ?? "").trim(),
    summary_short: String(summary.summary_short ?? "").trim(),
    summary_detailed: String(summary.summary_detailed ?? "").trim(),
    key_topics: Array.isArray(summary.key_topics) ? summary.key_topics.map((value) => String(value)) : [],
    keywords: Array.isArray(summary.keywords) ? summary.keywords.map((value) => String(value)) : [],
    branch_relevance: Array.isArray(summary.branch_relevance) ? summary.branch_relevance.map((value) => String(value)) : [],
    career_tracks: Array.isArray(summary.career_tracks) ? summary.career_tracks.map((value) => String(value)) : [],
    difficulty: String(summary.difficulty ?? "unknown"),
    resource_type_hint: String(summary.resource_type ?? "unknown"),
    search_text: String(summary.search_text ?? "").trim(),
    important_points: Array.isArray(summary.important_points) ? summary.important_points.map((value) => String(value)) : [],
    prerequisites: Array.isArray(summary.prerequisites) ? summary.prerequisites.map((value) => String(value)) : [],
    recommended_for: Array.isArray(summary.recommended_for) ? summary.recommended_for.map((value) => String(value)) : [],
  };
}

async function updateCollection(collection, relativePath, searchIndex, dryRun) {
  const sourcePdf = normalizePath(relativePath);
  const urlPath = `material/${sourcePdf}`;

  const filter = {
    $or: [
      { source_pdf: sourcePdf },
      { url: urlPath },
    ],
  };

  if (dryRun) {
    return collection.countDocuments(filter);
  }

  const result = await collection.updateMany(
    filter,
    {
      $set: {
        search_index: searchIndex,
        updated_at: new Date().toISOString(),
      },
    },
  );

  return result.modifiedCount;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = resolveRoot();
  const manifestPath = args.manifestPath
    ? path.resolve(process.cwd(), args.manifestPath)
    : path.join(rootDir, "analysis_output", "pdf_summaries", "manifest.jsonl");

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const summaries = loadManifest(manifestPath)
    .filter((item) => normalizePath(item.relative_path).toLowerCase().endsWith(".pdf"));

  const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";
  const client = new MongoClient(MONGO_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);
    let processed = 0;
    let sharedUpdated = 0;
    let legacyUpdated = 0;
    let missing = 0;
    let ocrNeeded = 0;
    let failed = 0;

    for (const summary of summaries) {
      processed += 1;
      const status = String(summary.status ?? "");
      if (status === "ocr_needed") ocrNeeded += 1;
      if (status === "failed") failed += 1;

      const relativePath = normalizePath(summary.relative_path);
      if (!relativePath) {
        missing += 1;
        continue;
      }

      const searchIndex = buildSearchIndex(summary);
      const [sharedCount, legacyCount] = await Promise.all([
        updateCollection(db.collection("shared_resources"), relativePath, searchIndex, args.dryRun),
        updateCollection(db.collection("resources"), relativePath, searchIndex, args.dryRun),
      ]);

      sharedUpdated += Number(sharedCount ?? 0);
      legacyUpdated += Number(legacyCount ?? 0);
      if (!sharedCount && !legacyCount) missing += 1;
    }

    console.log("PDF summary index import complete");
    console.log(`Mode: ${args.dryRun ? "DRY_RUN" : "WRITE"}`);
    console.log(`Manifest: ${manifestPath}`);
    console.log(`Summaries processed: ${processed}`);
    console.log(`Shared resources matched: ${sharedUpdated}`);
    console.log(`Legacy resources matched: ${legacyUpdated}`);
    console.log(`OCR needed summaries: ${ocrNeeded}`);
    console.log(`Failed summaries: ${failed}`);
    console.log(`Unmatched summaries: ${missing}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
