import { MongoClient } from "mongodb";

function normalizePath(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^material\//i, "")
    .replace(/^\/+/g, "");

  if (!normalized || /^https?:\/\//i.test(normalized)) {
    return "";
  }

  return normalized;
}

function chooseLocalPath(...candidates) {
  for (const candidate of candidates) {
    const normalized = normalizePath(candidate);
    if (normalized) return normalized;
  }
  return "";
}

async function main() {
  const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";
  const dryRun = process.argv.includes("--dry-run");

  const client = new MongoClient(MONGO_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);
    const now = new Date().toISOString();

    const assets = await db.collection("assets").find(
      {},
      {
        projection: {
          _id: 0,
          id: 1,
          source_path: 1,
          cloud_source_path: 1,
          storage_key: 1,
          storage_provider: 1,
          public_url: 1,
        },
      },
    ).toArray();

    let assetsUpdated = 0;
    for (const asset of assets) {
      const localPath = chooseLocalPath(
        asset.source_path,
        asset.cloud_source_path,
        asset.storage_key,
      );
      if (!localPath) continue;

      assetsUpdated += 1;
      if (!dryRun) {
        await db.collection("assets").updateOne(
          { id: String(asset.id) },
          {
            $set: {
              storage_provider: "local",
              storage_key: localPath,
              source_path: localPath,
              public_url: null,
              bucket: null,
              updated_at: now,
            },
            $unset: {
              cloud_migrated_at: "",
            },
          },
        );
      }
    }

    const sharedResources = await db.collection("shared_resources").find(
      {},
      {
        projection: {
          _id: 0,
          id: 1,
          asset_id: 1,
          source_pdf: 1,
          url: 1,
        },
      },
    ).toArray();

    const assetPathById = new Map(
      assets.map((asset) => [
        String(asset.id),
        chooseLocalPath(asset.source_path, asset.cloud_source_path, asset.storage_key),
      ]),
    );

    let sharedUpdated = 0;
    for (const resource of sharedResources) {
      const localPath = chooseLocalPath(
        resource.source_pdf,
        assetPathById.get(String(resource.asset_id ?? "")),
        resource.url,
      );
      if (!localPath) continue;

      sharedUpdated += 1;
      if (!dryRun) {
        await db.collection("shared_resources").updateOne(
          { id: String(resource.id) },
          {
            $set: {
              source_pdf: localPath,
              url: `material/${localPath}`,
              updated_at: now,
            },
          },
        );
      }
    }

    const legacyResources = await db.collection("resources").find(
      { resource_type: "pdf" },
      { projection: { _id: 0, id: 1, source_pdf: 1, url: 1 } },
    ).toArray();

    let legacyUpdated = 0;
    for (const resource of legacyResources) {
      const localPath = chooseLocalPath(resource.source_pdf, resource.url);
      if (!localPath) continue;
      legacyUpdated += 1;
      if (!dryRun) {
        await db.collection("resources").updateOne(
          { id: String(resource.id) },
          {
            $set: {
              source_pdf: localPath,
              url: `material/${localPath}`,
              updated_at: now,
            },
          },
        );
      }
    }

    console.log("Local storage switch complete");
    console.log(`Mode: ${dryRun ? "DRY_RUN" : "WRITE"}`);
    console.log(`Assets normalized: ${assetsUpdated}`);
    console.log(`Shared resources normalized: ${sharedUpdated}`);
    console.log(`Legacy resources normalized: ${legacyUpdated}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
