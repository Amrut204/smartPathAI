import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";

import { MongoClient } from "mongodb";

const IMPORT_SOURCE = "scrapedpdfs_shared_v1";

function parseArgs(argv) {
  const args = {
    dryRun: false,
    purge: false,
    folder: "",
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--purge") args.purge = true;
    else if (arg.startsWith("--folder=")) args.folder = arg.slice("--folder=".length);
  }
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

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function toTitle(fileName) {
  const base = path.basename(fileName, ".pdf");
  return base
    .replace(/^aptitude_/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
}

function inferTopicName(fileName) {
  const value = fileName.toLowerCase();
  if (/sql|dbms|database/.test(value)) return "SQL & Databases";
  if (/os|operating/.test(value)) return "Operating Systems";
  if (/network|cn/.test(value)) return "Computer Networks";
  if (/dsa|algorithm|array|graph|tree/.test(value)) return "Data Structures & Algorithms";
  return "Aptitude & Reasoning";
}

function inferDurationSec(fileSizeBytes) {
  const mb = fileSizeBytes / (1024 * 1024);
  const rough = Math.round(Math.max(10, Math.min(240, mb * 20)));
  return rough * 60;
}

function normalizePath(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/^material\//i, "").trim();
}

function makeSharedDedupeKey(fileName, topicId) {
  const raw = `${fileName.toLowerCase()}|${String(topicId ?? "")}`;
  return createHash("sha1").update(raw).digest("hex");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const materialRoot = resolveMaterialRoot();
  const targetFolder = args.folder
    ? path.resolve(process.cwd(), args.folder)
    : path.join(materialRoot, "scrapedpdfs");

  if (!fs.existsSync(targetFolder) || !fs.statSync(targetFolder).isDirectory()) {
    throw new Error(`scrapedpdfs folder not found: ${targetFolder}`);
  }

  const files = fs.readdirSync(targetFolder)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .map((name) => ({
      name,
      absolute: path.join(targetFolder, name),
      size: fs.statSync(path.join(targetFolder, name)).size,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";

  const client = new MongoClient(MONGO_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);
    const tenants = await db.collection("tenants").find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray();
    if (tenants.length === 0) throw new Error("No tenants found");

    const topics = await db.collection("topics").find(
      { $or: [{ tenant_id: null }, { tenant_id: { $in: tenants.map((tenant) => String(tenant.id)) } }] },
      { projection: { _id: 0, id: 1, name: 1 } },
    ).toArray();
    const topicByName = new Map(topics.map((topic) => [normalizeName(topic.name), String(topic.id)]));

    if (args.purge && !args.dryRun) {
      await Promise.all([
        db.collection("tenant_resources").deleteMany({ import_source: IMPORT_SOURCE }),
        db.collection("shared_resources").deleteMany({ import_source: IMPORT_SOURCE }),
        db.collection("assets").deleteMany({ import_source: IMPORT_SOURCE }),
      ]);
    }

    await Promise.all([
      db.collection("assets").createIndex({ dedupe_key: 1 }, { unique: true }),
      db.collection("shared_resources").createIndex({ dedupe_key: 1 }, { unique: true }),
      db.collection("tenant_resources").createIndex({ tenant_id: 1, resource_id: 1 }, { unique: true }),
    ]);

    const now = new Date().toISOString();
    let assetsInserted = 0;
    let sharedInserted = 0;
    let mappingInserted = 0;
    let skippedExisting = 0;

    for (const file of files) {
      const relativePath = normalizePath(`scrapedpdfs/${file.name}`);
      const topicName = inferTopicName(file.name);
      const topicId = topicByName.get(normalizeName(topicName))
        || topicByName.get(normalizeName("Aptitude & Reasoning"))
        || null;

      const assetDedupeKey = `local:${relativePath.toLowerCase()}`;
      let asset = await db.collection("assets").findOne(
        { dedupe_key: assetDedupeKey },
        { projection: { _id: 0, id: 1 } },
      );
      if (!asset) {
        const assetId = randomUUID();
        if (!args.dryRun) {
          await db.collection("assets").insertOne({
            id: assetId,
            dedupe_key: assetDedupeKey,
            storage_provider: "local",
            storage_key: relativePath,
            public_url: null,
            bucket: null,
            mime_type: "application/pdf",
            size_bytes: Number(file.size),
            source_path: relativePath,
            import_source: IMPORT_SOURCE,
            created_at: now,
            updated_at: now,
          });
        }
        asset = { id: assetId };
        assetsInserted += 1;
      }

      const sharedDedupeKey = makeSharedDedupeKey(file.name, topicId);
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
            title: toTitle(file.name),
            description: `Imported from scrapedpdfs (${file.name}).`,
            url: `material/${relativePath}`,
            resource_type: "pdf",
            thumbnail_url: null,
            duration_sec: inferDurationSec(file.size),
            topic_id: topicId,
            source_pdf: relativePath,
            asset_id: String(asset.id),
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
        if (existingMap) {
          skippedExisting += 1;
          continue;
        }
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
        mappingInserted += 1;
      }
    }

    console.log("Scraped PDF resource import complete");
    console.log(`Mode: ${args.dryRun ? "DRY_RUN" : "WRITE"}`);
    console.log(`Folder: ${targetFolder}`);
    console.log(`PDF files discovered: ${files.length}`);
    console.log(`Tenants: ${tenants.length}`);
    console.log(`Assets inserted: ${assetsInserted}`);
    console.log(`Shared resources inserted: ${sharedInserted}`);
    console.log(`Tenant mappings inserted: ${mappingInserted}`);
    console.log(`Skipped existing: ${skippedExisting}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
