import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const IMPORT_SOURCE = "fewmore_local_v1";

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    purge: argv.includes("--purge"),
  };
}

function resolveMaterialRoot() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(scriptDir, "../../material"),
    path.resolve(process.cwd(), "../material"),
    path.resolve(process.cwd(), "material"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePath(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/^material\//i, "").trim();
}

function humanizeBaseName(fileName) {
  return path.basename(fileName, ".pdf")
    .replace(/pdfcoffee\.com_/i, "")
    .replace(/-ZmlD$/i, "")
    .replace(/-skillvertex-\d+$/i, "")
    .replace(/\s*\(\d+\)$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value) {
  return value.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function inferTopicName(fileName) {
  const value = fileName.toLowerCase();
  if (/verbal|english|grammar|composition|wren|martin/.test(value)) return "Competitive English";
  if (/sql|dbms|database/.test(value)) return "SQL & Databases";
  if (/oop/.test(value)) return "OOPs";
  if (/tcs|infosys|nqt|mathematical ability|logical reasoning|reasoning|puzzle|aptitude|mathematics|quantitative/.test(value)) {
    return "Aptitude & Reasoning";
  }
  return "Aptitude & Reasoning";
}

function inferDescription(fileName, topicName) {
  const value = fileName.toLowerCase();
  const company = /infosys/.test(value) ? "Infosys" : /tcs|nqt/.test(value) ? "TCS NQT" : null;
  if (company && topicName === "Competitive English") {
    return `${company} verbal and English preparation material imported from fewmore.`;
  }
  if (company) {
    return `${company} placement paper and aptitude preparation material imported from fewmore.`;
  }
  if (topicName === "Competitive English") {
    return "English grammar and verbal preparation material imported from fewmore.";
  }
  return "Aptitude and reasoning preparation material imported from fewmore.";
}

function inferDurationSec(fileSizeBytes) {
  const mb = fileSizeBytes / (1024 * 1024);
  return Math.round(Math.max(15, Math.min(900, mb * 12))) * 60;
}

function makeSharedDedupeKey(title, topicId, fileHash) {
  return createHash("sha1").update(`${normalizeName(title)}|${String(topicId ?? "")}|${fileHash}`).digest("hex");
}

const args = parseArgs(process.argv.slice(2));
const materialRoot = resolveMaterialRoot();
const targetFolder = path.join(materialRoot, "fewmore");
if (!fs.existsSync(targetFolder)) throw new Error(`Folder not found: ${targetFolder}`);

const files = fs.readdirSync(targetFolder)
  .filter((name) => name.toLowerCase().endsWith(".pdf"))
  .map((name) => {
    const absolute = path.join(targetFolder, name);
    const buffer = fs.readFileSync(absolute);
    return {
      name,
      absolute,
      size: fs.statSync(absolute).size,
      hash: createHash("sha1").update(buffer).digest("hex"),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const uniqueFiles = [];
const seenHashes = new Set();
for (const file of files) {
  if (seenHashes.has(file.hash)) continue;
  seenHashes.add(file.hash);
  uniqueFiles.push(file);
}

const client = new MongoClient(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017");
await client.connect();
try {
  const db = client.db(process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev");
  const tenants = await db.collection("tenants").find({}, { projection: { _id: 0, id: 1 } }).toArray();
  const topics = await db.collection("topics").find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray();
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

  let assetsInserted = 0;
  let sharedInserted = 0;
  let mappingsInserted = 0;
  let skippedExisting = 0;
  const now = new Date().toISOString();

  for (const file of uniqueFiles) {
    const relativePath = normalizePath(`fewmore/${file.name}`);
    const cleanBase = humanizeBaseName(file.name);
    const title = titleCase(cleanBase);
    const topicName = inferTopicName(file.name);
    const topicId = topicByName.get(normalizeName(topicName)) || null;
    const description = inferDescription(file.name, topicName);

    const assetDedupeKey = `local:${relativePath.toLowerCase()}`;
    let asset = await db.collection("assets").findOne({ dedupe_key: assetDedupeKey }, { projection: { _id: 0, id: 1 } });
    if (!asset) {
      const id = randomUUID();
      if (!args.dryRun) {
        await db.collection("assets").insertOne({
          id,
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
      asset = { id };
      assetsInserted += 1;
    }

    const sharedDedupeKey = makeSharedDedupeKey(title, topicId, file.hash);
    let shared = await db.collection("shared_resources").findOne({ dedupe_key: sharedDedupeKey }, { projection: { _id: 0, id: 1 } });
    if (!shared) {
      const id = randomUUID();
      if (!args.dryRun) {
        await db.collection("shared_resources").insertOne({
          id,
          dedupe_key: sharedDedupeKey,
          title,
          description,
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
      shared = { id };
      sharedInserted += 1;
    }

    for (const tenant of tenants) {
      const tenantId = String(tenant.id);
      const existing = await db.collection("tenant_resources").findOne({ tenant_id: tenantId, resource_id: String(shared.id) }, { projection: { _id: 1 } });
      if (existing) {
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
      mappingsInserted += 1;
    }
  }

  console.log(JSON.stringify({
    mode: args.dryRun ? "DRY_RUN" : "WRITE",
    folder: targetFolder,
    files_discovered: files.length,
    unique_files: uniqueFiles.length,
    assets_inserted: assetsInserted,
    shared_resources_inserted: sharedInserted,
    tenant_mappings_inserted: mappingsInserted,
    skipped_existing: skippedExisting,
  }, null, 2));
} finally {
  await client.close();
}
