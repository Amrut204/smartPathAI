import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

import { MongoClient } from "mongodb";

const IMPORT_SOURCE = "external_resource_metadata_v1";

function parseArgs(argv) {
  const args = {
    dryRun: false,
    purge: false,
    input: "",
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--purge") args.purge = true;
    else if (arg.startsWith("--input=")) args.input = arg.slice("--input=".length);
  }
  return args;
}

function resolveRepoRoot() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDir, "../..");
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function inferTopicName(row) {
  const text = `${row.title ?? ""} ${row.detail_url ?? ""} ${row.source_site ?? ""}`.toLowerCase();
  if (/sql|database|dbms/.test(text)) return "SQL & Databases";
  if (/network|communication|protocol/.test(text)) return "Computer Networks";
  if (/algorithm|computer|programming|embedded|verification/.test(text)) return "Data Structures & Algorithms";
  if (/statistics|probability|algebra|calculus|math/.test(text)) return "Aptitude & Reasoning";
  return "Core Engineering";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRoot();
  const defaultInput = [
    path.join(repoRoot, "docs", "pending_open_metadata_only_2026-03-08.jsonl"),
    path.join(repoRoot, "docs", "pending_question_source_metadata_only_2026-03-08.jsonl"),
  ];
  const inputFiles = args.input ? [path.resolve(process.cwd(), args.input)] : defaultInput;

  const rows = inputFiles.flatMap((inputFile) => {
    if (!fs.existsSync(inputFile)) return [];
    return fs.readFileSync(inputFile, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((row) => !row.local_path);
  });

  if (rows.length === 0) {
    throw new Error("No external metadata records found in input files");
  }

  const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";
  const client = new MongoClient(MONGO_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);

    if (args.purge && !args.dryRun) {
      await Promise.all([
        db.collection("tenant_resources").deleteMany({ import_source: IMPORT_SOURCE }),
        db.collection("shared_resources").deleteMany({ import_source: IMPORT_SOURCE }),
      ]);
    }

    await Promise.all([
      db.collection("shared_resources").createIndex({ dedupe_key: 1 }, { unique: true }),
      db.collection("tenant_resources").createIndex({ tenant_id: 1, resource_id: 1 }, { unique: true }),
    ]);

    const tenants = await db.collection("tenants").find({}, { projection: { _id: 0, id: 1 } }).toArray();
    const topics = await db.collection("topics").find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray();
    const topicByName = new Map(topics.map((topic) => [normalizeName(topic.name), String(topic.id)]));

    const now = new Date().toISOString();
    let sharedInserted = 0;
    let mappingsInserted = 0;

    for (const row of rows) {
      const externalUrl = String(row.download_url ?? row.detail_url ?? "").trim();
      if (!/^https?:\/\//i.test(externalUrl)) continue;

      const topicName = inferTopicName(row);
      const topicId = topicByName.get(normalizeName(topicName)) || null;
      const rawDedupe = [
        String(row.title ?? "").trim().toLowerCase(),
        externalUrl.toLowerCase(),
        String(topicId ?? ""),
      ].join("|");
      const sharedDedupeKey = createHash("sha1").update(rawDedupe).digest("hex");

      let shared = await db.collection("shared_resources").findOne(
        { dedupe_key: sharedDedupeKey },
        { projection: { _id: 0, id: 1 } },
      );
      if (!shared) {
        const sharedId = randomUUID();
        if (!args.dryRun) {
          await db.collection("shared_resources").insertOne({
            id: sharedId,
            dedupe_key: sharedDedupeKey,
            title: String(row.title ?? externalUrl),
            description: `External resource from ${String(row.source_site ?? "external source")}`,
            url: externalUrl,
            resource_type: "external_link",
            thumbnail_url: null,
            duration_sec: 0,
            topic_id: topicId,
            source_pdf: null,
            asset_id: null,
            is_active: true,
            import_source: IMPORT_SOURCE,
            created_at: now,
            updated_at: now,
          });
        }
        shared = { id: sharedId };
        sharedInserted += 1;
      }

      for (const tenant of tenants) {
        const tenantId = String(tenant.id);
        const existingMap = await db.collection("tenant_resources").findOne(
          { tenant_id: tenantId, resource_id: String(shared.id) },
          { projection: { _id: 1 } },
        );
        if (existingMap) continue;
        if (!args.dryRun) {
          await db.collection("tenant_resources").insertOne({
            id: randomUUID(),
            tenant_id: tenantId,
            resource_id: String(shared.id),
            is_active: true,
            import_source: IMPORT_SOURCE,
            created_at: now,
            updated_at: now,
          });
        }
        mappingsInserted += 1;
      }
    }

    console.log("External resource metadata import complete");
    console.log(`Mode: ${args.dryRun ? "DRY_RUN" : "WRITE"}`);
    console.log(`Input records: ${rows.length}`);
    console.log(`Shared resources inserted: ${sharedInserted}`);
    console.log(`Tenant mappings inserted: ${mappingsInserted}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
