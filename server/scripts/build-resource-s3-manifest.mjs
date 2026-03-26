import path from "node:path";

import {
  buildPublicUrl,
  buildStorageKey,
  collectLocalStudentResourceFiles,
  ensureDirectory,
  resolvePrefix,
  summarizeManifestRows,
  writeJsonLines,
  writeJsonReport,
} from "./resource-s3-utils.mjs";

const REPORT_DIR = path.resolve(process.cwd(), "storage_reports");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const bucket = String(process.env.AWS_S3_BUCKET ?? "").trim();
  const prefix = resolvePrefix();

  const { materialRoot, manifestRows, skipped } = await collectLocalStudentResourceFiles();
  const rowsWithKeys = manifestRows.map((row) => {
    const storageKey = buildStorageKey({
      prefix,
      collection: row.collection,
      resourceType: row.resourceType,
      topicId: row.topicId,
      topicName: row.topicName,
      localPath: row.localPath,
      resourceId: row.resourceId,
      assetId: row.assetId,
    });

    return {
      ...row,
      storageKey,
      publicUrl: bucket ? buildPublicUrl(bucket, storageKey) : null,
    };
  });

  ensureDirectory(REPORT_DIR);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const manifestName = `resource-s3-manifest-${timestamp}.jsonl`;
  const summaryName = `resource-s3-manifest-summary-${timestamp}.json`;
  const skippedName = `resource-s3-manifest-skipped-${timestamp}.json`;

  const summary = {
    mode: dryRun ? "DRY_RUN" : "WRITE",
    bucket,
    prefix,
    materialRoot,
    ...summarizeManifestRows(rowsWithKeys, skipped),
    manifestFile: path.join(REPORT_DIR, manifestName),
    skippedFile: path.join(REPORT_DIR, skippedName),
  };

  writeJsonLines(REPORT_DIR, manifestName, rowsWithKeys);
  writeJsonReport(REPORT_DIR, skippedName, skipped);
  writeJsonReport(REPORT_DIR, summaryName, summary);

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
