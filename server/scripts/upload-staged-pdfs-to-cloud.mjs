import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { MongoClient } from "mongodb";

const SUPPORTED_PROVIDERS = new Set(["s3", "azure_blob", "gcs"]);
const DEFAULT_PREFIX = "smartpathai/resources";
const DEFAULT_MANIFEST = "upload_staging/manifest.json";

function parseArgs(argv) {
  const args = {
    dryRun: false,
    provider: process.env.CLOUD_UPLOAD_PROVIDER ?? "",
    prefix: process.env.CLOUD_UPLOAD_PREFIX ?? DEFAULT_PREFIX,
    manifest: process.env.CLOUD_UPLOAD_MANIFEST ?? DEFAULT_MANIFEST,
    materialRoot: process.env.CLOUD_UPLOAD_MATERIAL_ROOT ?? "",
    limit: 0,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--provider=")) args.provider = arg.slice("--provider=".length);
    else if (arg.startsWith("--prefix=")) args.prefix = arg.slice("--prefix=".length);
    else if (arg.startsWith("--manifest=")) args.manifest = arg.slice("--manifest=".length);
    else if (arg.startsWith("--material-root=")) args.materialRoot = arg.slice("--material-root=".length);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length)) || 0;
  }

  args.provider = String(args.provider ?? "").trim().toLowerCase();
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
    .replace(/^material\//i, "");
}

function normalizeBaseUrl(value) {
  if (!value) return "";
  return value.trim().replace(/\/+$/, "");
}

function sha1File(filePath) {
  const hash = createHash("sha1");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function uploadWithRetry(uploadFn, maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await uploadFn();
      return;
    } catch (error) {
      lastError = error;
      const retryableCode = String(error?.code ?? error?.Code ?? "").toUpperCase();
      const retryable = retryableCode === "ECONNRESET" || retryableCode === "ETIMEDOUT" || retryableCode === "TIMEOUTERROR";
      if (!retryable || attempt >= maxAttempts) break;
      await sleep(500 * attempt);
    }
  }
  throw lastError;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function inferPublicUrl(provider, bucketOrContainer, key) {
  const encodedKey = key.split("/").map((part) => encodeURIComponent(part)).join("/");

  if (provider === "s3") {
    const base = normalizeBaseUrl(process.env.STORAGE_S3_PUBLIC_BASE_URL);
    if (base) return `${base}/${encodedKey}`;
    const region = process.env.AWS_REGION?.trim() || "us-east-1";
    return `https://${bucketOrContainer}.s3.${region}.amazonaws.com/${encodedKey}`;
  }

  if (provider === "azure_blob") {
    const base = normalizeBaseUrl(process.env.STORAGE_AZURE_PUBLIC_BASE_URL);
    if (base) return `${base}/${encodedKey}`;
    return "";
  }

  if (provider === "gcs") {
    const base = normalizeBaseUrl(process.env.STORAGE_GCS_PUBLIC_BASE_URL);
    if (base) return `${base}/${encodedKey}`;
    return `https://storage.googleapis.com/${bucketOrContainer}/${encodedKey}`;
  }

  return "";
}

function resolveCloudKey(prefix, topic, stagedRelativePath) {
  const staged = normalizePath(stagedRelativePath);
  const withoutRoot = staged.replace(/^upload_staging\//i, "");
  const safeTopic = String(topic ?? "").trim().toLowerCase().replace(/[^a-z0-9_/-]+/g, "_");
  if (withoutRoot) return `${prefix}/${withoutRoot}`.replace(/\/+/g, "/");
  const fileName = path.basename(staged);
  return `${prefix}/${safeTopic}/${fileName}`.replace(/\/+/g, "/");
}

async function createUploader(provider) {
  if (provider === "s3") {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const bucket = requiredEnv("AWS_S3_BUCKET");
    const region = process.env.AWS_REGION?.trim() || "us-east-1";
    const client = new S3Client({ region });

    return {
      bucketOrContainer: bucket,
      async uploadFile(localPath, key) {
        await client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: fs.createReadStream(localPath),
          ContentType: "application/pdf",
        }));
      },
    };
  }

  if (provider === "azure_blob") {
    const { BlobServiceClient } = await import("@azure/storage-blob");
    const connectionString = requiredEnv("AZURE_STORAGE_CONNECTION_STRING");
    const container = requiredEnv("AZURE_STORAGE_CONTAINER");
    const service = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = service.getContainerClient(container);
    await containerClient.createIfNotExists();

    return {
      bucketOrContainer: container,
      async uploadFile(localPath, key) {
        const blobClient = containerClient.getBlockBlobClient(key);
        await blobClient.uploadFile(localPath, {
          blobHTTPHeaders: { blobContentType: "application/pdf" },
        });
      },
    };
  }

  if (provider === "gcs") {
    const { Storage } = await import("@google-cloud/storage");
    const bucket = requiredEnv("GCS_BUCKET");
    const storage = new Storage();
    const bucketClient = storage.bucket(bucket);

    return {
      bucketOrContainer: bucket,
      async uploadFile(localPath, key) {
        await bucketClient.upload(localPath, {
          destination: key,
          resumable: false,
          contentType: "application/pdf",
        });
      },
    };
  }

  throw new Error(`Unsupported provider '${provider}'`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!SUPPORTED_PROVIDERS.has(args.provider)) {
    throw new Error(`Invalid provider '${args.provider}'. Supported: s3 | azure_blob | gcs`);
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

  const byOriginalPath = new Map();
  const byStagedPath = new Map();
  const bySha1 = new Map();
  for (const row of manifestRows) {
    const original = normalizePath(row.originalRelativePath);
    const staged = normalizePath(row.stagedRelativePath);
    const sha1 = String(row.sha1 ?? "").toLowerCase();
    if (original) byOriginalPath.set(original, row);
    if (staged) byStagedPath.set(staged, row);
    if (sha1) bySha1.set(sha1, row);
  }

  const uploader = args.dryRun ? null : await createUploader(args.provider);
  const bucketOrContainer = uploader?.bucketOrContainer ?? (
    args.provider === "s3"
      ? requiredEnv("AWS_S3_BUCKET")
      : args.provider === "azure_blob"
        ? requiredEnv("AZURE_STORAGE_CONTAINER")
        : requiredEnv("GCS_BUCKET")
  );

  const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";
  const client = new MongoClient(MONGO_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);
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
          cloud_migrated_at: 1,
        },
      },
    ).toArray();

    const fileHashCache = new Map();
    const uploadedBySha1 = new Map();
    const now = new Date().toISOString();

    let scanned = 0;
    let matched = 0;
    let uploaded = 0;
    let dbUpdated = 0;
    let skippedMissingFile = 0;
    let skippedNotInManifest = 0;
    let skippedAlreadySynced = 0;
    let uploadErrors = 0;

    for (const asset of assets) {
      if (args.limit > 0 && matched >= args.limit) break;
      scanned += 1;

      const sourcePath = normalizePath(asset.source_path);
      const storageKey = normalizePath(asset.storage_key);
      let row = null;

      if (sourcePath && byOriginalPath.has(sourcePath)) row = byOriginalPath.get(sourcePath);
      if (!row && sourcePath && byStagedPath.has(sourcePath)) row = byStagedPath.get(sourcePath);
      if (!row && storageKey && byOriginalPath.has(storageKey)) row = byOriginalPath.get(storageKey);
      if (!row && storageKey && byStagedPath.has(storageKey)) row = byStagedPath.get(storageKey);

      if (!row) {
        const localCandidate = sourcePath || storageKey;
        if (localCandidate) {
          const candidateAbsolute = path.join(materialRoot, localCandidate);
          if (fs.existsSync(candidateAbsolute)) {
            let fileSha1 = fileHashCache.get(candidateAbsolute);
            if (!fileSha1) {
              fileSha1 = sha1File(candidateAbsolute);
              fileHashCache.set(candidateAbsolute, fileSha1);
            }
            row = bySha1.get(fileSha1.toLowerCase()) ?? null;
          }
        }
      }

      if (!row) {
        skippedNotInManifest += 1;
        continue;
      }

      matched += 1;
      const stagedRelativePath = normalizePath(row.stagedRelativePath || "");
      const originalRelativePath = normalizePath(row.originalRelativePath || "");
      const sourceRelative = stagedRelativePath || originalRelativePath;
      const absolutePath = path.join(materialRoot, sourceRelative);
      if (!sourceRelative || !fs.existsSync(absolutePath)) {
        skippedMissingFile += 1;
        continue;
      }

      const fileSha1 = String(row.sha1 ?? "").toLowerCase() || sha1File(absolutePath);
      const cloudKey = resolveCloudKey(args.prefix, row.topic, stagedRelativePath || originalRelativePath);
      const publicUrl = inferPublicUrl(args.provider, bucketOrContainer, cloudKey);
      const alreadySynced = String(asset.storage_provider ?? "").toLowerCase() === args.provider
        && normalizePath(asset.storage_key) === normalizePath(cloudKey)
        && Boolean(asset.cloud_migrated_at);

      if (!args.dryRun && alreadySynced) {
        skippedAlreadySynced += 1;
        continue;
      }

      if (!args.dryRun) {
        try {
          if (!uploadedBySha1.has(fileSha1)) {
            await uploadWithRetry(() => uploader.uploadFile(absolutePath, cloudKey));
            uploadedBySha1.set(fileSha1, cloudKey);
            uploaded += 1;
          }
        } catch (error) {
          uploadErrors += 1;
          console.error(`Upload failed for asset ${asset.id}: ${absolutePath}`);
          console.error(error);
          continue;
        }
      }

      if (!args.dryRun) {
        await db.collection("assets").updateOne(
          { id: String(asset.id) },
          {
            $set: {
              storage_provider: args.provider,
              storage_key: cloudKey,
              public_url: publicUrl || null,
              bucket: bucketOrContainer,
              updated_at: now,
              cloud_migrated_at: now,
              cloud_source_path: sourceRelative,
            },
          },
        );
      }
      dbUpdated += 1;
    }

    console.log("Cloud upload sync complete");
    console.log(`Mode: ${args.dryRun ? "DRY_RUN" : "WRITE"}`);
    console.log(`Provider: ${args.provider}`);
    console.log(`Material root: ${materialRoot}`);
    console.log(`Manifest: ${manifestPath}`);
    console.log(`Prefix: ${args.prefix}`);
    console.log(`Assets scanned: ${scanned}`);
    console.log(`Assets matched to manifest: ${matched}`);
    console.log(`Files uploaded (unique by hash): ${uploaded}`);
    console.log(`${args.dryRun ? "Assets that would be updated in DB" : "Assets updated in DB"}: ${dbUpdated}`);
    console.log(`Skipped missing local file: ${skippedMissingFile}`);
    console.log(`Skipped not in manifest: ${skippedNotInManifest}`);
    console.log(`Skipped already synced: ${skippedAlreadySynced}`);
    console.log(`Upload errors: ${uploadErrors}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
