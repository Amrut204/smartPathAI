import path from "node:path";

import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

import { ensureDirectory, requiredEnv, resolvePrefix, writeJsonReport } from "./resource-s3-utils.mjs";

const REPORT_DIR = path.resolve(process.cwd(), "storage_reports");

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    deleteAll: argv.includes("--delete-all"),
  };
}

async function listAllObjects(client, bucket, prefix) {
  const items = [];
  let continuationToken = undefined;

  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }));

    for (const item of response.Contents ?? []) {
      items.push({
        key: String(item.Key ?? ""),
        size: Number(item.Size ?? 0),
        lastModified: item.LastModified?.toISOString?.() ?? null,
      });
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return items;
}

async function deleteObjectsInBatches(client, bucket, keys) {
  for (let index = 0; index < keys.length; index += 1000) {
    const chunk = keys.slice(index, index + 1000);
    await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: chunk.map((key) => ({ Key: key })),
        Quiet: false,
      },
    }));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bucket = requiredEnv("AWS_S3_BUCKET");
  const prefix = args.deleteAll ? "" : resolvePrefix();
  const client = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

  const inventory = await listAllObjects(client, bucket, prefix);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  ensureDirectory(REPORT_DIR);

  const inventoryPath = writeJsonReport(REPORT_DIR, `s3-purge-inventory-${timestamp}.json`, {
    bucket,
    prefix: prefix || "(entire bucket)",
    totalObjects: inventory.length,
    totalBytes: inventory.reduce((sum, item) => sum + item.size, 0),
    objects: inventory,
  });

  const report = {
    mode: args.dryRun ? "DRY_RUN" : "WRITE",
    bucket,
    prefix: prefix || "(entire bucket)",
    inventoryFile: inventoryPath,
    objectsMatched: inventory.length,
    deleted: 0,
    remainingAfterDelete: inventory.length,
  };

  if (!args.dryRun && inventory.length > 0) {
    await deleteObjectsInBatches(client, bucket, inventory.map((item) => item.key));
    const remaining = await listAllObjects(client, bucket, prefix);
    report.deleted = inventory.length - remaining.length;
    report.remainingAfterDelete = remaining.length;
  }

  const reportPath = writeJsonReport(REPORT_DIR, `s3-purge-report-${timestamp}.json`, report);
  console.log(JSON.stringify({ ...report, reportFile: reportPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
