import { createHash, randomUUID } from "node:crypto";

import { MongoClient } from "mongodb";

const MIGRATION_SOURCE = "resources_shared_migration_v1";

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    purge: argv.includes("--purge"),
  };
}

function normalizePath(value) {
  const path = String(value ?? "").trim().replace(/\\/g, "/");
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return "";
  if (path.startsWith("material/")) return path.slice("material/".length);
  return path;
}

function normalizeUrl(value) {
  return String(value ?? "").trim();
}

function assetDedupeKey(resource) {
  const sourcePdf = normalizePath(resource.source_pdf);
  if (sourcePdf) return `local:${sourcePdf.toLowerCase()}`;
  const url = normalizeUrl(resource.url);
  if (url) return `url:${url.toLowerCase()}`;
  return `fallback:${String(resource.id ?? "").toLowerCase()}`;
}

function resourceDedupeKey(resource, assetId) {
  const raw = [
    String(resource.title ?? "").trim().toLowerCase(),
    String(resource.description ?? "").trim().toLowerCase(),
    String(resource.resource_type ?? "pdf").trim().toLowerCase(),
    String(resource.topic_id ?? "").trim().toLowerCase(),
    String(assetId).trim().toLowerCase(),
  ].join("|");
  return createHash("sha1").update(raw).digest("hex");
}

function mappingKey(tenantId, sharedResourceId) {
  return `${String(tenantId).toLowerCase()}|${String(sharedResourceId).toLowerCase()}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";

  const client = new MongoClient(MONGO_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);

    if (args.purge && !args.dryRun) {
      await Promise.all([
        db.collection("tenant_resources").deleteMany({ migration_source: MIGRATION_SOURCE }),
        db.collection("shared_resources").deleteMany({ migration_source: MIGRATION_SOURCE }),
        db.collection("assets").deleteMany({ migration_source: MIGRATION_SOURCE }),
      ]);
    }

    await Promise.all([
      db.collection("assets").createIndex({ dedupe_key: 1 }, { unique: true }),
      db.collection("shared_resources").createIndex({ dedupe_key: 1 }, { unique: true }),
      db.collection("tenant_resources").createIndex({ tenant_id: 1, resource_id: 1 }, { unique: true }),
    ]);

    const legacyResources = await db.collection("resources").find(
      { resource_type: "pdf", is_active: true },
      {
        projection: {
          _id: 0,
          id: 1,
          tenant_id: 1,
          topic_id: 1,
          title: 1,
          description: 1,
          url: 1,
          source_pdf: 1,
          thumbnail_url: 1,
          duration_sec: 1,
          resource_type: 1,
        },
      },
    ).toArray();

    const now = new Date().toISOString();
    const assetByKey = new Map();
    const sharedByKey = new Map();
    const mappingSet = new Set();

    const existingAssets = await db.collection("assets").find(
      { migration_source: MIGRATION_SOURCE },
      { projection: { _id: 0, id: 1, dedupe_key: 1 } },
    ).toArray();
    existingAssets.forEach((asset) => {
      assetByKey.set(String(asset.dedupe_key), String(asset.id));
    });

    const existingShared = await db.collection("shared_resources").find(
      { migration_source: MIGRATION_SOURCE },
      { projection: { _id: 0, id: 1, dedupe_key: 1 } },
    ).toArray();
    existingShared.forEach((resource) => {
      sharedByKey.set(String(resource.dedupe_key), String(resource.id));
    });

    const existingMappings = await db.collection("tenant_resources").find(
      { migration_source: MIGRATION_SOURCE },
      { projection: { _id: 0, tenant_id: 1, resource_id: 1 } },
    ).toArray();
    existingMappings.forEach((mapping) => {
      mappingSet.add(mappingKey(mapping.tenant_id, mapping.resource_id));
    });

    const assetsToInsert = [];
    const sharedToInsert = [];
    const mappingsToInsert = [];

    for (const resource of legacyResources) {
      const aKey = assetDedupeKey(resource);
      let assetId = assetByKey.get(aKey);
      if (!assetId) {
        assetId = randomUUID();
        const normalizedSourcePdf = normalizePath(resource.source_pdf);
        const normalizedUrl = normalizePath(resource.url);
        assetsToInsert.push({
          id: assetId,
          dedupe_key: aKey,
          storage_provider: "local",
          storage_key: normalizedSourcePdf || normalizedUrl || "",
          public_url: null,
          bucket: null,
          mime_type: "application/pdf",
          size_bytes: null,
          source_path: normalizedSourcePdf || normalizedUrl || "",
          migration_source: MIGRATION_SOURCE,
          created_at: now,
          updated_at: now,
        });
        assetByKey.set(aKey, assetId);
      }

      const rKey = resourceDedupeKey(resource, assetId);
      let sharedResourceId = sharedByKey.get(rKey);
      if (!sharedResourceId) {
        sharedResourceId = randomUUID();
        sharedToInsert.push({
          id: sharedResourceId,
          dedupe_key: rKey,
          title: String(resource.title ?? "Resource"),
          description: String(resource.description ?? ""),
          resource_type: "pdf",
          thumbnail_url: resource.thumbnail_url ?? null,
          duration_sec: Number(resource.duration_sec ?? 0),
          topic_id: resource.topic_id ? String(resource.topic_id) : null,
          asset_id: assetId,
          source_pdf: normalizePath(resource.source_pdf || resource.url),
          url: normalizeUrl(resource.url),
          is_active: true,
          migration_source: MIGRATION_SOURCE,
          created_at: now,
          updated_at: now,
        });
        sharedByKey.set(rKey, sharedResourceId);
      }

      const mKey = mappingKey(resource.tenant_id, sharedResourceId);
      if (!mappingSet.has(mKey)) {
        mappingsToInsert.push({
          id: randomUUID(),
          tenant_id: String(resource.tenant_id),
          resource_id: sharedResourceId,
          is_active: true,
          migration_source: MIGRATION_SOURCE,
          created_at: now,
          updated_at: now,
        });
        mappingSet.add(mKey);
      }
    }

    if (!args.dryRun) {
      if (assetsToInsert.length > 0) {
        await db.collection("assets").insertMany(assetsToInsert, { ordered: false });
      }
      if (sharedToInsert.length > 0) {
        await db.collection("shared_resources").insertMany(sharedToInsert, { ordered: false });
      }
      if (mappingsToInsert.length > 0) {
        await db.collection("tenant_resources").insertMany(mappingsToInsert, { ordered: false });
      }
    }

    console.log("Shared resource migration complete");
    console.log(`Mode: ${args.dryRun ? "DRY_RUN" : "WRITE"}`);
    console.log(`Legacy PDF resources scanned: ${legacyResources.length}`);
    console.log(`Assets inserted: ${assetsToInsert.length}`);
    console.log(`Shared resources inserted: ${sharedToInsert.length}`);
    console.log(`Tenant mappings inserted: ${mappingsToInsert.length}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
