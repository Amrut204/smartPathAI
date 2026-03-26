import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

import { MongoClient } from "mongodb";

const IMPORT_SOURCE = "pdf_summary_manifest_v1";
const SEARCH_INDEX_IMPORT_SOURCE = "pdf_summary_index_v1";

function parseArgs(argv) {
  const args = {
    dryRun: false,
    manifestPath: "",
    purge: false,
  };

  argv.forEach((arg) => {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--purge") args.purge = true;
    else if (arg.startsWith("--manifest=")) args.manifestPath = arg.slice("--manifest=".length);
  });

  return args;
}

function resolveRoot() {
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

function loadManifest(manifestPath) {
  return fs.readFileSync(manifestPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => normalizePath(row.relative_path).toLowerCase().endsWith(".pdf"));
}

function inferTopicName(summary) {
  const text = [
    summary.title,
    summary.summary_short,
    summary.summary_detailed,
    ...(Array.isArray(summary.key_topics) ? summary.key_topics : []),
    ...(Array.isArray(summary.keywords) ? summary.keywords : []),
    ...(Array.isArray(summary.career_tracks) ? summary.career_tracks : []),
    ...(Array.isArray(summary.branch_relevance) ? summary.branch_relevance : []),
  ].join(" ").toLowerCase();

  if (/sql|joins|database|rdbms/.test(text)) return "SQL & Databases";
  if (/\bdbms\b|normalization|transaction/.test(text)) return "DBMS";
  if (/operating system|deadlock|scheduling|paging|\bos\b/.test(text)) return "Operating Systems";
  if (/network|routing|tcp|udp|osi|http|web/.test(text)) return "Computer Networks";
  if (/object oriented|oops|inheritance|polymorphism|encapsulation/.test(text)) return "OOPs";
  if (/\bpython\b/.test(text)) return "Python Programming";
  if (/\bjava\b/.test(text)) return "Java Programming";
  if (/javascript|node\.js|\bjs\b/.test(text)) return "JavaScript";
  if (/c\+\+|c plus plus/.test(text)) return "C++ Programming";
  if (/\bc programming\b|\bc language\b|\bansi c\b/.test(text)) return "C Programming";
  if (/data science|analytics|hadoop|excel|statistics|power bi|tableau/.test(text)) return "Data Science & Analytics";
  if (/artificial intelligence|machine learning|deep learning|neural network|\bai\b/.test(text)) return "AI & Machine Learning";
  if (/civil engineering|surveying|structural|geotechnical|construction|concrete|soil mechanics/.test(text)) return "Civil Engineering";
  if (/mechanical engineering|thermodynamics|heat transfer|manufacturing|fluid mechanics|machine design/.test(text)) return "Mechanical Engineering";
  if (/electrical engineering|power systems|electrical machines|circuit theory|transformer|switchgear/.test(text)) return "Electrical Engineering";
  if (/electronics|communication systems|digital circuits|microprocessor|microcontroller|vlsi|signals|arduino|wireless/.test(text)) return "Electronics & Communication";
  if (/competitive english|grammar|verbal|reading comprehension|synonym|antonym|sentence correction/.test(text)) return "Competitive English";
  if (/hr interview|behavioral|group discussion|resume questions/.test(text)) return "HR Interview";
  if (/aptitude|quantitative|reasoning|probability|ratio|percentage|profit|loss|number system/.test(text)) return "Aptitude & Reasoning";
  if (/software placement crossover|technical interview|coding interview|data structure|algorithm|hashing|interview cake|computer science/.test(text)) return "Data Structures & Algorithms";
  return "Aptitude & Reasoning";
}

function inferDurationSec(summary, stats) {
  const pages = Number(summary.page_count ?? 0);
  if (pages > 0) {
    return Math.max(600, Math.min(14400, pages * 75));
  }
  const mb = Number(stats?.size ?? 0) / (1024 * 1024);
  const rough = Math.round(Math.max(10, Math.min(240, mb * 18 || 30)));
  return rough * 60;
}

function buildSearchIndex(summary) {
  return {
    import_source: SEARCH_INDEX_IMPORT_SOURCE,
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

async function ensureTopics(db, topicNames) {
  const topics = await db.collection("topics").find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray();
  const map = new Map(topics.map((topic) => [normalizeName(topic.name), String(topic.id)]));
  const now = new Date().toISOString();
  const inserts = [];

  for (const topicName of topicNames) {
    const key = normalizeName(topicName);
    if (map.has(key)) continue;
    const id = randomUUID();
    map.set(key, id);
    inserts.push({
      id,
      tenant_id: null,
      name: topicName,
      created_at: now,
      updated_at: now,
      import_source: IMPORT_SOURCE,
    });
  }

  if (inserts.length > 0) {
    await db.collection("topics").insertMany(inserts, { ordered: false });
  }

  return map;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = resolveRoot();
  const materialRoot = path.join(rootDir, "material");
  const manifestPath = args.manifestPath
    ? path.resolve(process.cwd(), args.manifestPath)
    : path.join(rootDir, "analysis_output", "pdf_summaries", "manifest.jsonl");

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const summaries = loadManifest(manifestPath);
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

    const [shared, legacy, tenants] = await Promise.all([
      db.collection("shared_resources").find({}, { projection: { _id: 0, source_pdf: 1, url: 1 } }).toArray(),
      db.collection("resources").find({}, { projection: { _id: 0, source_pdf: 1, url: 1 } }).toArray(),
      db.collection("tenants").find({}, { projection: { _id: 0, id: 1 } }).toArray(),
    ]);

    const existingPaths = new Set();
    for (const row of [...shared, ...legacy]) {
      if (row.source_pdf) existingPaths.add(normalizePath(row.source_pdf).toLowerCase());
      if (row.url && String(row.url).startsWith("material/")) {
        existingPaths.add(normalizePath(String(row.url).slice("material/".length)).toLowerCase());
      }
    }

    const unmatched = summaries.filter((summary) => {
      const relative = normalizePath(summary.relative_path).toLowerCase();
      return relative && !existingPaths.has(relative);
    }).filter((summary) => fs.existsSync(path.join(materialRoot, normalizePath(summary.relative_path))));

    const topicNames = [...new Set(unmatched.map((summary) => inferTopicName(summary)))];
    const topicByName = await ensureTopics(db, topicNames);

    const now = new Date().toISOString();
    let assetsInserted = 0;
    let sharedInserted = 0;
    let mappingsInserted = 0;

    for (const summary of unmatched) {
      const relativePath = normalizePath(summary.relative_path);
      const absolutePath = path.join(materialRoot, relativePath);
      const stats = fs.statSync(absolutePath);
      const topicId = topicByName.get(normalizeName(inferTopicName(summary))) ?? null;
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
            size_bytes: stats.size,
            source_path: relativePath,
            import_source: IMPORT_SOURCE,
            created_at: now,
            updated_at: now,
          });
        }
        asset = { id: assetId };
        assetsInserted += 1;
      }

      const rawDedupe = [
        String(summary.title ?? path.basename(relativePath)).trim().toLowerCase(),
        relativePath.toLowerCase(),
        String(topicId ?? ""),
      ].join("|");
      const sharedDedupeKey = createHash("sha1").update(rawDedupe).digest("hex");

      let sharedDoc = await db.collection("shared_resources").findOne(
        { dedupe_key: sharedDedupeKey },
        { projection: { _id: 0, id: 1 } },
      );

      if (!sharedDoc) {
        const sharedId = randomUUID();
        if (!args.dryRun) {
          await db.collection("shared_resources").insertOne({
            id: sharedId,
            dedupe_key: sharedDedupeKey,
            title: String(summary.title ?? path.basename(relativePath, path.extname(relativePath))),
            description: String(summary.summary_short ?? summary.summary_detailed ?? ""),
            url: `material/${relativePath}`,
            resource_type: "pdf",
            thumbnail_url: null,
            duration_sec: inferDurationSec(summary, stats),
            topic_id: topicId,
            source_pdf: relativePath,
            asset_id: String(asset.id),
            search_index: buildSearchIndex(summary),
            is_active: true,
            import_source: IMPORT_SOURCE,
            created_at: now,
            updated_at: now,
          });
        }
        sharedDoc = { id: sharedId };
        sharedInserted += 1;
      }

      for (const tenant of tenants) {
        const tenantId = String(tenant.id);
        const existingMap = await db.collection("tenant_resources").findOne(
          { tenant_id: tenantId, resource_id: String(sharedDoc.id) },
          { projection: { _id: 1 } },
        );
        if (existingMap) continue;
        if (!args.dryRun) {
          await db.collection("tenant_resources").insertOne({
            id: randomUUID(),
            tenant_id: tenantId,
            resource_id: String(sharedDoc.id),
            is_active: true,
            import_source: IMPORT_SOURCE,
            created_at: now,
            updated_at: now,
          });
        }
        mappingsInserted += 1;
      }
    }

    const byStatus = unmatched.reduce((acc, summary) => {
      const key = String(summary.status ?? "unknown");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    console.log("Unmatched PDF summary import complete");
    console.log(`Mode: ${args.dryRun ? "DRY_RUN" : "WRITE"}`);
    console.log(`Manifest summaries: ${summaries.length}`);
    console.log(`Unmatched local PDFs imported: ${unmatched.length}`);
    console.log(`Assets inserted: ${assetsInserted}`);
    console.log(`Shared resources inserted: ${sharedInserted}`);
    console.log(`Tenant mappings inserted: ${mappingsInserted}`);
    console.log(`Status breakdown: ${JSON.stringify(byStatus)}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
