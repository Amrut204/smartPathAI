import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MongoClient } from "mongodb";

export const DEFAULT_MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
export const DEFAULT_DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";

export function resolveRepoRoot() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDir, "../../..");
}

export function resolveAuditRoot(repoRoot) {
  return path.join(repoRoot, "resource_audit");
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function nowIso() {
  return new Date().toISOString();
}

export function auditLogPath(repoRoot) {
  return path.join(resolveAuditRoot(repoRoot), "audit.log");
}

export function logLine(repoRoot, message) {
  const line = `[${nowIso()}] ${message}`;
  // Always log to console for progress visibility.
  console.log(line);
  try {
    ensureDir(resolveAuditRoot(repoRoot));
    fs.appendFileSync(auditLogPath(repoRoot), `${line}\n`);
  } catch {
    // ignore log write failures
  }
}

export function parseArgs(argv, defaults) {
  const args = { ...defaults };
  for (const raw of argv) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw.startsWith("--uri=")) args.mongoUri = raw.slice("--uri=".length);
    else if (raw.startsWith("--db=")) args.dbName = raw.slice("--db=".length);
    else if (raw.startsWith("--input=")) args.input = raw.slice("--input=".length);
    else if (raw.startsWith("--output=")) args.output = raw.slice("--output=".length);
    else if (raw.startsWith("--limit=")) args.limit = Math.max(0, Number(raw.slice("--limit=".length)) || 0);
    else if (raw === "--purge") args.purge = true;
  }
  return args;
}

export async function connectMongo(mongoUri, dbName) {
  const client = new MongoClient(mongoUri);
  await client.connect();
  return { client, db: client.db(dbName) };
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

export function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function readJsonl(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value);
}

export function writeCsv(filePath, rows, headers) {
  ensureDir(path.dirname(filePath));
  const esc = (v) => {
    const str = String(v ?? "");
    if (/[\",\n]/.test(str)) return `"${str.replace(/\"/g, "\"\"")}"`;
    return str;
  };
  const lines = [];
  lines.push(headers.map(esc).join(","));
  for (const row of rows) {
    lines.push(headers.map((h) => esc(row[h])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

export function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function escapeForFileName(value) {
  return String(value ?? "")
    .replace(/[<>:\"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "resource";
}

export function guessLocalFileFromResource(repoRoot, resource, asset) {
  const url = String(resource.url ?? "");
  if (/^material\//i.test(url)) {
    return path.join(repoRoot, url.replace(/\//g, path.sep));
  }

  const sourcePdf = String(resource.source_pdf ?? "");
  if (sourcePdf) {
    return path.join(repoRoot, "material", sourcePdf.replace(/\//g, path.sep));
  }

  const storageKey = asset?.storage_key ? String(asset.storage_key) : "";
  if (storageKey) {
    return path.join(repoRoot, "material", storageKey.replace(/\//g, path.sep));
  }

  return "";
}
