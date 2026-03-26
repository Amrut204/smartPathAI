import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { MongoClient } from "mongodb";

export const DEFAULT_SOURCE_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
export const DEFAULT_SOURCE_DB = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";
export const DEFAULT_TARGET_URI = process.env.MONGODB_URI_TEST || "";
export const DEFAULT_TARGET_DB = process.env.MONGODB_ATLAS_DB_NAME || "campusdrive_prod";
export const DEFAULT_BATCH_SIZE = 500;
export const CRITICAL_COLLECTIONS = [
  "tenants",
  "users",
  "students",
  "mock_tests",
  "resources",
  "shared_resources",
  "assets",
  "communications",
  "admin_ops_jobs",
];

export function nowIso() {
  return new Date().toISOString();
}

export function timestampLabel() {
  return nowIso().replace(/[:.]/g, "-");
}

export function hasFlag(argv, flag) {
  return argv.includes(`--${flag}`);
}

export function parseFlag(argv, flag, fallback = undefined) {
  const prefix = `--${flag}=`;
  const direct = argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = argv.findIndex((arg) => arg === `--${flag}`);
  if (index >= 0 && index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
    return argv[index + 1];
  }
  return fallback;
}

export async function ensureReportDir() {
  const dir = path.join(process.cwd(), "storage_reports");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function writeReport(prefix, payload) {
  const dir = await ensureReportDir();
  const filePath = path.join(dir, `${prefix}-${timestampLabel()}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

export async function connectMongo(uri) {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
  });
  await client.connect();
  return client;
}

export async function listUserCollections(db) {
  const rows = await db.listCollections({}, { nameOnly: true }).toArray();
  return rows
    .map((row) => String(row.name || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export async function getCollectionCounts(db, collectionNames) {
  const counts = {};
  for (const name of collectionNames) {
    counts[name] = await db.collection(name).countDocuments({});
  }
  return counts;
}

export async function assertTargetReady(db, { allowNonEmpty = false } = {}) {
  const collections = await listUserCollections(db);
  const counts = await getCollectionCounts(db, collections);
  const nonEmpty = collections.filter((name) => Number(counts[name] || 0) > 0);
  if (nonEmpty.length > 0 && !allowNonEmpty) {
    const error = new Error(`Target database is not empty. Non-empty collections: ${nonEmpty.join(", ")}`);
    error.name = "TARGET_NOT_EMPTY";
    error.details = { collections, counts, nonEmpty };
    throw error;
  }
  return { collections, counts, nonEmpty };
}

export function normalizeIndex(index) {
  const key = Object.entries(index.key || {}).map(([field, order]) => [field, Number(order)]);
  return {
    name: String(index.name || ""),
    key,
    unique: Boolean(index.unique),
    sparse: Boolean(index.sparse),
    partialFilterExpression: index.partialFilterExpression || null,
    expireAfterSeconds: typeof index.expireAfterSeconds === "number" ? index.expireAfterSeconds : null,
  };
}

export function indexSignature(index) {
  return JSON.stringify(normalizeIndex(index));
}

export async function listIndexes(db, collectionName) {
  const indexes = await db.collection(collectionName).indexes();
  return indexes.filter((index) => String(index.name) !== "_id_");
}

export function buildCreateIndexModel(index) {
  const options = {};
  for (const [key, value] of Object.entries(index)) {
    if (key === "v" || key === "ns" || key === "key" || key === "name") continue;
    options[key] = value;
  }
  return {
    key: index.key,
    name: index.name,
    ...options,
  };
}

export async function copyCollection({ sourceDb, targetDb, collectionName, batchSize = DEFAULT_BATCH_SIZE }) {
  const sourceCollection = sourceDb.collection(collectionName);
  const targetCollection = targetDb.collection(collectionName);
  const total = await sourceCollection.countDocuments({});
  let copied = 0;
  const cursor = sourceCollection.find({}).batchSize(batchSize);

  while (await cursor.hasNext()) {
    const docs = [];
    while (docs.length < batchSize && await cursor.hasNext()) {
      const doc = await cursor.next();
      if (doc) docs.push(doc);
    }
    if (docs.length > 0) {
      await targetCollection.insertMany(docs, { ordered: true });
      copied += docs.length;
    }
  }

  return { total, copied };
}

export async function recreateIndexes({ sourceDb, targetDb, collectionName }) {
  const indexes = await listIndexes(sourceDb, collectionName);
  if (indexes.length === 0) {
    return { total: 0, created: 0, skipped: 0, names: [] };
  }

  let created = 0;
  let skipped = 0;
  const names = [];
  for (const index of indexes) {
    names.push(String(index.name));
    try {
      await targetDb.collection(collectionName).createIndex(index.key, buildCreateIndexModel(index));
      created += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already exists/i.test(message) || /equivalent index/i.test(message)) {
        skipped += 1;
        continue;
      }
      throw error;
    }
  }

  return { total: indexes.length, created, skipped, names };
}

export function summarizeMismatch(label, sourceValue, targetValue) {
  return {
    label,
    source: sourceValue,
    target: targetValue,
    matches: JSON.stringify(sourceValue) === JSON.stringify(targetValue),
  };
}
