import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { MongoClient } from "mongodb";

import {
  collectEntries,
  defaultBackupRoot,
  ensureDir,
  hasFlag,
  nowIso,
  parseFlag,
  pruneBackups,
  timestampLabel,
} from "./pilot-backup/_common.mjs";

const gzipAsync = promisify(gzip);

function resolveCommand() {
  return process.platform === "win32" ? "mongodump.exe" : "mongodump";
}

async function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function exportCollectionsToJsonGzip({ mongoUri, dbName, archivePath }) {
  const client = new MongoClient(mongoUri);
  await client.connect();

  try {
    const db = client.db(dbName);
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    const payload = {
      createdAt: nowIso(),
      dbName,
      collections: {},
    };

    for (const collection of collections) {
      const name = String(collection.name ?? "").trim();
      if (!name) continue;
      payload.collections[name] = await db.collection(name).find({}, { projection: { _id: 0 } }).toArray();
    }

    const buffer = Buffer.from(JSON.stringify(payload), "utf8");
    const zipped = await gzipAsync(buffer);
    await fs.promises.writeFile(archivePath, zipped);
  } finally {
    await client.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = hasFlag(argv, "dry-run");
  const mongoUri = parseFlag(argv, "uri", process.env.MONGODB_URI || "mongodb://127.0.0.1:27017");
  const dbName = parseFlag(argv, "db", process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev");
  const outputDir = path.resolve(parseFlag(argv, "output-dir", defaultBackupRoot("mongo")));
  const keepRecent = Number(parseFlag(argv, "keep-recent", "7")) || 7;
  const keepWeekly = Number(parseFlag(argv, "keep-weekly", "4")) || 4;

  let fileName = `mongo-backup-${dbName}-${timestampLabel()}.archive.gz`;
  const archivePath = path.join(outputDir, fileName);
  const command = resolveCommand();
  const args = [
    `--uri=${mongoUri}`,
    `--db=${dbName}`,
    `--archive=${archivePath}`,
    "--gzip",
  ];

  console.log(`[${nowIso()}] mongo backup starting`);
  console.log(`dbName=${dbName}`);
  console.log(`outputDir=${outputDir}`);
  console.log(`archivePath=${archivePath}`);

  if (dryRun) {
    console.log(`${command} ${args.join(" ")}`);
    return;
  }

  ensureDir(outputDir);
  let backupMode = "mongodump";
  const result = await runCommand(command, args).catch((error) => ({
    code: 1,
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
  }));

  if (result.code !== 0) {
    fileName = `mongo-backup-${dbName}-${timestampLabel()}.json.gz`;
    const fallbackPath = path.join(outputDir, fileName);
    console.warn(`mongodump unavailable, falling back to JSON export: ${result.stderr || result.stdout}`);
    await exportCollectionsToJsonGzip({
      mongoUri,
      dbName,
      archivePath: fallbackPath,
    });
    backupMode = "json_fallback";
  }

  const finalArchivePath = backupMode === "mongodump" ? archivePath : path.join(outputDir, fileName);
  if (!fs.existsSync(finalArchivePath)) {
    throw new Error(`Backup file was not created: ${finalArchivePath}`);
  }

  const metadata = {
    createdAt: nowIso(),
    dbName,
    archivePath: finalArchivePath,
    backupMode,
  };
  await fs.promises.writeFile(`${finalArchivePath}.json`, JSON.stringify(metadata, null, 2), "utf8");

  const entries = await collectEntries(outputDir, (name) => name.startsWith(`mongo-backup-${dbName}-`) && (
    name.endsWith(".archive.gz")
    || name.endsWith(".archive.gz.json")
    || name.endsWith(".json.gz")
    || name.endsWith(".json.gz.json")
  ));
  const grouped = new Map();
  for (const entry of entries) {
    const baseName = entry.name.replace(/\.json$/i, "");
    const bucket = grouped.get(baseName) ?? [];
    bucket.push(entry);
    grouped.set(baseName, bucket);
  }

  const primaryEntries = [...grouped.entries()].map(([baseName, bucket]) => {
    const archiveEntry = bucket.find((entry) => entry.name.endsWith(".archive.gz")) ?? bucket[0];
    return {
      name: baseName,
      path: archiveEntry.path,
      mtimeMs: archiveEntry.mtimeMs,
      files: bucket,
    };
  });

  const retention = pruneBackups(primaryEntries, { keepRecent, keepWeekly });
  for (const entry of retention.remove) {
    for (const file of entry.files) {
      await fs.promises.rm(file.path, { force: true });
      console.log(`pruned=${file.path}`);
    }
  }

  console.log(`[${nowIso()}] mongo backup complete`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
