import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { MongoClient } from "mongodb";

const DEFAULT_PREFIX = "smartpathai/resources";
const DEFAULT_MANIFEST = "upload_staging/manifest.json";

function parseArgs(argv) {
  const args = {
    dryRun: false,
    prefix: process.env.CLOUD_UPLOAD_PREFIX ?? DEFAULT_PREFIX,
    manifest: process.env.CLOUD_UPLOAD_MANIFEST ?? DEFAULT_MANIFEST,
    materialRoot: process.env.CLOUD_UPLOAD_MATERIAL_ROOT ?? "",
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--prefix=")) args.prefix = arg.slice("--prefix=".length);
    else if (arg.startsWith("--manifest=")) args.manifest = arg.slice("--manifest=".length);
    else if (arg.startsWith("--material-root=")) args.materialRoot = arg.slice("--material-root=".length);
  }

  args.prefix = String(args.prefix ?? DEFAULT_PREFIX).trim().replace(/^\/+|\/+$/g, "");
  args.manifest = String(args.manifest ?? DEFAULT_MANIFEST).trim();
  return args;
}

function resolveMaterialRoot(customRoot) {
  if (customRoot) return path.resolve(process.cwd(), customRoot);

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(scriptDir, "../../material"),
    path.resolve(process.cwd(), "../material"),
    path.resolve(process.cwd(), "material"),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found ?? candidates[0];
}

function normalizePath(value) {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^material\//i, "")
    .replace(/^\/+/g, "");
}

function inferPublicUrl(bucket, key) {
  const region = process.env.AWS_REGION?.trim() || "us-east-1";
  const base = String(process.env.STORAGE_S3_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const encodedKey = key.split("/").map((part) => encodeURIComponent(part)).join("/");
  if (base) {
    return `${base}/${encodedKey}`;
  }
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
}

function resolveCloudKey(prefix, stagedRelativePath) {
  const staged = normalizePath(stagedRelativePath);
  const withoutRoot = staged.replace(/^upload_staging\//i, "");
  return `${prefix}/${withoutRoot}`.replace(/\/+/g, "/");
}

async function listAllObjectKeys(client, bucket, prefix) {
  const keys = new Set();
  let continuationToken = undefined;

  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }));

    for (const item of response.Contents ?? []) {
      const key = String(item.Key ?? "").trim();
      if (key) keys.add(key);
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

async function checkPublicObjectExists(publicUrl) {
  try {
    const response = await fetch(publicUrl, { method: "HEAD" });
    return {
      exists: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type"),
    };
  } catch (error) {
    return {
      exists: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bucket = String(process.env.AWS_S3_BUCKET ?? "").trim();
  if (!bucket) {
    throw new Error("Missing AWS_S3_BUCKET");
  }

  const materialRoot = resolveMaterialRoot(args.materialRoot);
  const manifestPath = path.isAbsolute(args.manifest)
    ? args.manifest
    : path.join(materialRoot, args.manifest);

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const manifestRows = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifestRows) || manifestRows.length === 0) {
    throw new Error(`Manifest has no records: ${manifestPath}`);
  }

  const expectedByOriginalPath = new Map();
  for (const row of manifestRows) {
    const original = normalizePath(row.originalRelativePath);
    const staged = normalizePath(row.stagedRelativePath);
    if (!original || !staged) continue;
    expectedByOriginalPath.set(original, {
      key: resolveCloudKey(args.prefix, staged),
      sourceRelative: staged,
    });
  }

  const s3 = new S3Client({ region: process.env.AWS_REGION?.trim() || "us-east-1" });
  let objectKeys = null;
  let usingPublicProbe = false;
  try {
    objectKeys = await listAllObjectKeys(s3, bucket, args.prefix);
  } catch (error) {
    const code = String(error?.Code ?? error?.name ?? "").toLowerCase();
    if (code.includes("accessdenied")) {
      usingPublicProbe = true;
    } else {
      throw error;
    }
  }

  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const dbName = process.env.MONGODB_DB_NAME || "campusdrive_dev";
  const client = new MongoClient(mongoUri);
  await client.connect();

  const report = {
    mode: args.dryRun ? "DRY_RUN" : "WRITE",
    bucket,
    prefix: args.prefix,
    matchingMode: usingPublicProbe ? "public_head_probe" : "bucket_listing",
    manifestPath,
    assetsScanned: 0,
    manifestMatches: 0,
    existingS3Matches: 0,
    updated: 0,
    alreadyMapped: 0,
    missingInManifest: 0,
    missingInBucket: 0,
    sampleMissing: [],
    sampleUpdated: [],
  };

  try {
    const db = client.db(dbName);
    const assets = await db.collection("assets").find(
      {},
      {
        projection: {
          _id: 0,
          id: 1,
          source_path: 1,
          storage_provider: 1,
          storage_key: 1,
          public_url: 1,
        },
      },
    ).toArray();

    const now = new Date().toISOString();

    for (const asset of assets) {
      report.assetsScanned += 1;
      const sourcePath = normalizePath(asset.source_path);
      if (!sourcePath) {
        report.missingInManifest += 1;
        continue;
      }

      const expected = expectedByOriginalPath.get(sourcePath);
      if (!expected) {
        report.missingInManifest += 1;
        continue;
      }

      report.manifestMatches += 1;
      const publicUrl = inferPublicUrl(bucket, expected.key);
      let existsInCloud = false;

      if (objectKeys) {
        existsInCloud = objectKeys.has(expected.key);
      } else {
        const probe = await checkPublicObjectExists(publicUrl);
        existsInCloud = probe.exists && String(probe.contentType ?? "").toLowerCase().includes("pdf");
      }

      if (!existsInCloud) {
        report.missingInBucket += 1;
        if (report.sampleMissing.length < 10) {
          report.sampleMissing.push({
            assetId: String(asset.id),
            sourcePath,
            expectedKey: expected.key,
            publicUrl,
          });
        }
        continue;
      }

      report.existingS3Matches += 1;
      const alreadyMapped = String(asset.storage_provider ?? "").toLowerCase() === "s3"
        && normalizePath(asset.storage_key) === normalizePath(expected.key)
        && String(asset.public_url ?? "").trim().length > 0;

      if (alreadyMapped) {
        report.alreadyMapped += 1;
        continue;
      }

      if (!args.dryRun) {
        await db.collection("assets").updateOne(
          { id: String(asset.id) },
          {
            $set: {
              storage_provider: "s3",
              storage_key: expected.key,
              public_url: publicUrl,
              bucket,
              updated_at: now,
              cloud_migrated_at: now,
              cloud_source_path: expected.sourceRelative,
            },
          },
        );
      }

      report.updated += 1;
      if (report.sampleUpdated.length < 10) {
        report.sampleUpdated.push({
          assetId: String(asset.id),
          sourcePath,
          storageKey: expected.key,
        });
      }
    }

    const reportPath = path.resolve(process.cwd(), "s3-backfill-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log(`Report written to ${reportPath}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
