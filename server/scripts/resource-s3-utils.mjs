import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { MongoClient } from "mongodb";

const DEFAULT_PREFIX = "smartpathai/resources";
const DEFAULT_REPORT_DIR = path.resolve(process.cwd(), "storage_reports");

export function normalizePath(value) {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^material\//i, "")
    .replace(/^\/+/g, "");
}

export function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? "").trim());
}

export function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export function shortHash(value) {
  return crypto.createHash("sha1").update(String(value ?? "")).digest("hex").slice(0, 10);
}

export function resolveMaterialRoot(customRoot = "") {
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

export function ensureDirectory(dirPath = DEFAULT_REPORT_DIR) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function writeJsonReport(reportDir, fileName, payload) {
  ensureDirectory(reportDir);
  const reportPath = path.join(reportDir, fileName);
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2));
  return reportPath;
}

export function writeJsonLines(reportDir, fileName, rows) {
  ensureDirectory(reportDir);
  const reportPath = path.join(reportDir, fileName);
  const lines = rows.map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(reportPath, `${lines}${rows.length ? "\n" : ""}`);
  return reportPath;
}

export function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

export function resolvePrefix() {
  return String(process.env.CLOUD_UPLOAD_PREFIX ?? DEFAULT_PREFIX).trim().replace(/^\/+|\/+$/g, "") || DEFAULT_PREFIX;
}

export function buildPublicUrl(bucket, key) {
  const base = String(process.env.STORAGE_S3_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const encodedKey = key.split("/").map((part) => encodeURIComponent(part)).join("/");
  if (base) {
    return `${base}/${encodedKey}`;
  }

  const region = String(process.env.AWS_REGION ?? "us-east-1").trim() || "us-east-1";
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
}

export function detectContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".md" || extension === ".markdown" || extension === ".txt") return "text/plain; charset=utf-8";
  if (extension === ".json" || extension === ".ipynb") return "application/json; charset=utf-8";
  if (extension === ".csv") return "text/csv; charset=utf-8";
  return "application/octet-stream";
}

export function buildStorageKey(params) {
  const prefix = params.prefix ?? resolvePrefix();
  const collection = params.collection === "legacy" ? "legacy" : "shared";
  const resourceType = slugify(params.resourceType || "file") || "file";
  const topicSlug = slugify(params.topicName || params.topicId || "untagged") || "untagged";
  const extension = path.extname(params.localPath).toLowerCase() || "";
  const baseName = slugify(path.basename(params.localPath, extension)) || "resource";
  const identity = params.assetId || params.resourceId || params.localPath;
  const suffix = shortHash(identity);
  return `${prefix}/${collection}/${resourceType}/${topicSlug}/${baseName}__${suffix}${extension}`.replace(/\/+/g, "/");
}

export async function createMongoClient() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const client = new MongoClient(uri);
  await client.connect();
  return client;
}

export function resolveDbName() {
  return process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";
}

export async function collectLocalStudentResourceFiles(options = {}) {
  const materialRoot = resolveMaterialRoot(options.materialRoot);
  const client = await createMongoClient();

  try {
    const db = client.db(resolveDbName());
    const topics = await db.collection("topics").find(
      {},
      { projection: { _id: 0, id: 1, name: 1 } },
    ).toArray();
    const topicNameById = new Map(topics.map((topic) => [String(topic.id), String(topic.name ?? "")]));

    const sharedRows = await db.collection("shared_resources").aggregate([
      { $match: { is_active: true, resource_type: { $ne: "external_link" } } },
      {
        $lookup: {
          from: "assets",
          localField: "asset_id",
          foreignField: "id",
          as: "asset",
        },
      },
      { $unwind: { path: "$asset", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          id: 1,
          title: 1,
          topic_id: 1,
          resource_type: 1,
          url: 1,
          source_pdf: 1,
          asset_id: 1,
          asset: {
            id: "$asset.id",
            source_path: "$asset.source_path",
            storage_provider: "$asset.storage_provider",
            storage_key: "$asset.storage_key",
            public_url: "$asset.public_url",
          },
        },
      },
    ]).toArray();

    const legacyRows = await db.collection("resources").find(
      { is_active: true, resource_type: { $ne: "external_link" } },
      {
        projection: {
          _id: 0,
          id: 1,
          title: 1,
          topic_id: 1,
          resource_type: 1,
          url: 1,
          source_pdf: 1,
        },
      },
    ).toArray();

    const manifestRows = [];
    const seenKeys = new Set();
    const skipped = [];

    for (const row of sharedRows) {
      const asset = row.asset ?? null;
      const storageProvider = String(asset?.storage_provider ?? "").trim().toLowerCase();
      const localPath = normalizePath(asset?.source_path || row.source_pdf || row.url);
      const looksExternal = isHttpUrl(row.url) || isHttpUrl(row.source_pdf);
      if (!localPath || looksExternal) {
        skipped.push({ collection: "shared", reason: "no_local_path", resourceId: String(row.id), title: String(row.title ?? "") });
        continue;
      }

      const absolutePath = path.resolve(materialRoot, localPath);
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        skipped.push({ collection: "shared", reason: "missing_file", resourceId: String(row.id), localPath });
        continue;
      }

      const manifestRow = {
        collection: "shared",
        resourceId: String(row.id),
        assetId: row.asset_id ? String(row.asset_id) : null,
        title: String(row.title ?? ""),
        topicId: row.topic_id ? String(row.topic_id) : null,
        topicName: row.topic_id ? (topicNameById.get(String(row.topic_id)) ?? "") : "",
        resourceType: String(row.resource_type ?? "file"),
        localPath,
        absolutePath,
        sizeBytes: fs.statSync(absolutePath).size,
        contentType: detectContentType(absolutePath),
        existingStorageProvider: storageProvider || "local",
      };

      const dedupeKey = `shared|${manifestRow.assetId || manifestRow.resourceId}|${manifestRow.localPath}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        manifestRows.push(manifestRow);
      }
    }

    for (const row of legacyRows) {
      const localPath = normalizePath(row.source_pdf || row.url);
      const looksExternal = isHttpUrl(row.url) || isHttpUrl(row.source_pdf);
      if (!localPath || looksExternal) {
        skipped.push({ collection: "legacy", reason: "external_or_no_local_path", resourceId: String(row.id), title: String(row.title ?? "") });
        continue;
      }

      const absolutePath = path.resolve(materialRoot, localPath);
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        skipped.push({ collection: "legacy", reason: "missing_file", resourceId: String(row.id), localPath });
        continue;
      }

      const manifestRow = {
        collection: "legacy",
        resourceId: String(row.id),
        assetId: null,
        title: String(row.title ?? ""),
        topicId: row.topic_id ? String(row.topic_id) : null,
        topicName: row.topic_id ? (topicNameById.get(String(row.topic_id)) ?? "") : "",
        resourceType: String(row.resource_type ?? "file"),
        localPath,
        absolutePath,
        sizeBytes: fs.statSync(absolutePath).size,
        contentType: detectContentType(absolutePath),
        existingStorageProvider: "local",
      };

      const dedupeKey = `legacy|${manifestRow.resourceId}|${manifestRow.localPath}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        manifestRows.push(manifestRow);
      }
    }

    return { materialRoot, manifestRows, skipped };
  } finally {
    await client.close();
  }
}

export function summarizeManifestRows(rows, skipped) {
  const byCollection = {};
  const byType = {};
  let totalBytes = 0;

  for (const row of rows) {
    byCollection[row.collection] = (byCollection[row.collection] || 0) + 1;
    byType[row.resourceType] = (byType[row.resourceType] || 0) + 1;
    totalBytes += Number(row.sizeBytes || 0);
  }

  return {
    totalFiles: rows.length,
    totalBytes,
    byCollection,
    byType,
    skipped: skipped.length,
  };
}
