import path from "node:path";
import { spawnSync } from "node:child_process";

import { MongoClient } from "mongodb";

import { ensureDirectory, resolveDbName, writeJsonReport } from "./resource-s3-utils.mjs";

const REPORT_DIR = path.resolve(process.cwd(), "storage_reports");

function runNodeScript(scriptName, extraArgs = []) {
  const result = spawnSync(
    process.execPath,
    ["--env-file=.env", path.resolve(process.cwd(), "scripts", scriptName), ...extraArgs],
    { cwd: process.cwd(), stdio: "inherit" },
  );

  if (result.status !== 0) {
    throw new Error(`Script failed: ${scriptName}`);
  }
}

async function backupCurrentMetadata() {
  const client = new MongoClient(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  try {
    const db = client.db(resolveDbName());
    const [assets, sharedResources, legacyResources] = await Promise.all([
      db.collection("assets").find({}, { projection: { _id: 0 } }).toArray(),
      db.collection("shared_resources").find({}, { projection: { _id: 0 } }).toArray(),
      db.collection("resources").find({}, { projection: { _id: 0 } }).toArray(),
    ]);

    ensureDirectory(REPORT_DIR);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = writeJsonReport(REPORT_DIR, `resource-storage-backup-${timestamp}.json`, {
      createdAt: new Date().toISOString(),
      assets,
      sharedResources,
      legacyResources,
    });
    return filePath;
  } finally {
    await client.close();
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const backupFile = await backupCurrentMetadata();

  if (dryRun) {
    runNodeScript("build-resource-s3-manifest.mjs", ["--dry-run"]);
    runNodeScript("purge-s3-bucket.mjs", ["--dry-run", "--delete-all"]);
    runNodeScript("upload-resource-files-to-s3.mjs", ["--dry-run"]);
    runNodeScript("reconcile-resource-storage.mjs", []);
    console.log(JSON.stringify({ mode: "DRY_RUN", backupFile }, null, 2));
    return;
  }

  runNodeScript("build-resource-s3-manifest.mjs");
  runNodeScript("purge-s3-bucket.mjs", ["--delete-all"]);
  runNodeScript("upload-resource-files-to-s3.mjs");
  runNodeScript("reconcile-resource-storage.mjs");
  console.log(JSON.stringify({ mode: "WRITE", backupFile }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
