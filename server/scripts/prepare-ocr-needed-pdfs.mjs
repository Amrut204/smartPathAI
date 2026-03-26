import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MongoClient } from "mongodb";

function parseArgs(argv) {
  const args = {
    manifestPath: "",
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--manifest=")) args.manifestPath = arg.slice("--manifest=".length);
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
  return fs.readFileSync(manifestPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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

  const summaries = loadManifest(manifestPath);
  const ocrNeeded = summaries.filter((row) => String(row.status ?? "") === "ocr_needed");

  const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";
  const client = new MongoClient(MONGO_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);
    const shared = await db.collection("shared_resources").find(
      { "search_index.status": "ocr_needed" },
      { projection: { _id: 0, id: 1, title: 1, source_pdf: 1, import_source: 1 } },
    ).toArray();
    const legacy = await db.collection("resources").find(
      { "search_index.status": "ocr_needed" },
      { projection: { _id: 0, id: 1, title: 1, source_pdf: 1, import_source: 1, tenant_id: 1 } },
    ).toArray();

    const sharedByPath = new Map(shared.map((row) => [normalizePath(row.source_pdf).toLowerCase(), row]));
    const legacyByPath = new Map(legacy.map((row) => [normalizePath(row.source_pdf).toLowerCase(), row]));

    const outputDir = path.join(rootDir, "analysis_output", "pdf_ocr_queue");
    fs.mkdirSync(outputDir, { recursive: true });

    const queueRows = ocrNeeded.map((summary) => {
      const relativePath = normalizePath(summary.relative_path);
      const absolutePath = path.join(rootDir, "material", relativePath);
      return {
        relative_path: relativePath,
        absolute_path: absolutePath,
        title: String(summary.title ?? ""),
        status: String(summary.status ?? ""),
        source_summary_status: String(summary.status ?? ""),
        shared_resource: sharedByPath.get(relativePath.toLowerCase()) ?? null,
        legacy_resource: legacyByPath.get(relativePath.toLowerCase()) ?? null,
        exists_locally: fs.existsSync(absolutePath),
      };
    });

    const queueManifest = path.join(outputDir, "ocr_needed_manifest.jsonl");
    fs.writeFileSync(queueManifest, queueRows.map((row) => JSON.stringify(row)).join("\n"));

    const queuePaths = path.join(outputDir, "ocr_needed_paths.txt");
    fs.writeFileSync(queuePaths, queueRows.map((row) => row.absolute_path).join("\n"));

    const summaryFile = path.join(outputDir, "ocr_needed_summary.json");
    fs.writeFileSync(summaryFile, JSON.stringify({
      total_ocr_needed: queueRows.length,
      matched_shared_resources: queueRows.filter((row) => row.shared_resource).length,
      matched_legacy_resources: queueRows.filter((row) => row.legacy_resource).length,
      existing_local_files: queueRows.filter((row) => row.exists_locally).length,
      generated_at: new Date().toISOString(),
    }, null, 2));

    const instructionsFile = path.join(outputDir, "README.md");
    fs.writeFileSync(instructionsFile, [
      "# OCR Queue",
      "",
      "This folder contains the PDFs that Gemini marked as `ocr_needed` in `analysis_output/pdf_summaries/manifest.jsonl`.",
      "",
      "Files:",
      "- `ocr_needed_manifest.jsonl`: structured OCR queue with resource matches",
      "- `ocr_needed_paths.txt`: one absolute PDF path per line",
      "- `ocr_needed_summary.json`: queue statistics",
      "",
      "Next step when an OCR engine is available:",
      "1. Run OCR on the PDFs listed in `ocr_needed_paths.txt`.",
      "2. Regenerate their summaries into `analysis_output/pdf_summaries`.",
      "3. Re-run `npm run import:pdf-summary-index`.",
    ].join("\n"));

    console.log("OCR queue prepared");
    console.log(`OCR-needed PDFs: ${queueRows.length}`);
    console.log(`Queue manifest: ${queueManifest}`);
    console.log(`Queue paths: ${queuePaths}`);
    console.log(`Queue summary: ${summaryFile}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
