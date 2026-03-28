import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

import { MongoClient } from "mongodb";

const IMPORT_SOURCE = "open_resource_core_content_v1";

function parseArgs(argv) {
  const args = {
    dryRun: false,
    purge: false,
    input: "",
    subdir: "open_resource_core_content",
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--purge") args.purge = true;
    else if (arg.startsWith("--input=")) args.input = arg.slice("--input=".length);
    else if (arg.startsWith("--subdir=")) args.subdir = arg.slice("--subdir=".length);
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

function normalizePath(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/^material\//i, "").trim();
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "resource";
}

function inferDurationSec(fileSizeBytes) {
  const mb = Number(fileSizeBytes || 0) / (1024 * 1024);
  const rough = Math.round(Math.max(10, Math.min(240, mb * 18 || 30)));
  return rough * 60;
}

function sha256OfFile(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRoot();
  const inputFile = args.input
    ? path.resolve(process.cwd(), args.input)
    : path.join(repoRoot, "open_resource_scraper", "data", "core_content", "import_manifest.jsonl");
  const materialRoot = path.join(repoRoot, "material");

  if (!fs.existsSync(inputFile)) {
    throw new Error(`Input JSONL not found: ${inputFile}`);
  }

  const rows = fs.readFileSync(inputFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.import_ready && row.local_path && fs.existsSync(row.local_path));

  if (rows.length === 0) {
    throw new Error("No importable core-content records found");
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
        db.collection("assets").deleteMany({ import_source: IMPORT_SOURCE }),
      ]);
    }

    await Promise.all([
      db.collection("assets").createIndex({ dedupe_key: 1 }, { unique: true }),
      db.collection("shared_resources").createIndex({ dedupe_key: 1 }, { unique: true }),
      db.collection("tenant_resources").createIndex({ tenant_id: 1, resource_id: 1 }, { unique: true }),
    ]);

    const tenants = await db.collection("tenants").find({}, { projection: { _id: 0, id: 1 } }).toArray();
    const topics = await db.collection("topics").find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray();
    const topicByName = new Map(topics.map((topic) => [normalizeName(topic.name), String(topic.id)]));

    const now = new Date().toISOString();
    let copiedFiles = 0;
    let assetsInserted = 0;
    let sharedInserted = 0;
    let mappingsInserted = 0;

    for (const row of rows) {
      const sourcePath = path.resolve(String(row.local_path));
      const sourceSite = slugify(String(row.source_site ?? "core"));
      const fileName = path.basename(sourcePath);
      const targetRelative = normalizePath(path.join(args.subdir, sourceSite, fileName));
      const targetAbsolute = path.join(materialRoot, targetRelative);

      if (!args.dryRun) {
        fs.mkdirSync(path.dirname(targetAbsolute), { recursive: true });
        if (!fs.existsSync(targetAbsolute)) {
          fs.copyFileSync(sourcePath, targetAbsolute);
          copiedFiles += 1;
        }
      }

      const stats = fs.statSync(sourcePath);
      const topicId = topicByName.get(normalizeName(row.topic_hint)) || null;
      const assetDedupeKey = `local:${targetRelative.toLowerCase()}`;
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
            storage_key: targetRelative,
            public_url: null,
            bucket: null,
            mime_type: "application/pdf",
            size_bytes: stats.size,
            checksum_sha1: String(row.checksum_sha1 ?? ""),
            checksum_sha256: sha256OfFile(sourcePath),
            source_path: targetRelative,
            import_source: IMPORT_SOURCE,
            created_at: now,
            updated_at: now,
          });
        }
        asset = { id: assetId };
        assetsInserted += 1;
      }

      const rawDedupe = [
        String(row.title ?? "").trim().toLowerCase(),
        String(row.checksum_sha1 ?? "").trim().toLowerCase(),
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
            title: String(row.title ?? fileName),
            description: String(row.description ?? ""),
            url: `material/${targetRelative}`,
            resource_type: "pdf",
            thumbnail_url: null,
            duration_sec: inferDurationSec(stats.size),
            topic_id: topicId,
            source_pdf: targetRelative,
            asset_id: String(asset.id),
            source_type: String(row.source_type ?? "open_web"),
            source_url: row.source_url ?? null,
            license_type: String(row.license_type ?? "unknown"),
            license_notes: row.license_notes ?? null,
            review_status: String(row.review_status ?? "approved"),
            quality_label: row.quality_label ?? null,
            primary_branches: Array.isArray(row.primary_branches) ? row.primary_branches : [],
            career_domains: Array.isArray(row.career_domains) ? row.career_domains : [],
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

    console.log("Open resource core content import complete");
    console.log(`Mode: ${args.dryRun ? "DRY_RUN" : "WRITE"}`);
    console.log(`Input records: ${rows.length}`);
    console.log(`Files copied to material/: ${copiedFiles}`);
    console.log(`Assets inserted: ${assetsInserted}`);
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
