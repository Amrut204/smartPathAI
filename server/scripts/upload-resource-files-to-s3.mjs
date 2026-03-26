import fs from "node:fs";
import path from "node:path";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { MongoClient } from "mongodb";

import {
  buildPublicUrl,
  buildStorageKey,
  collectLocalStudentResourceFiles,
  ensureDirectory,
  requiredEnv,
  resolveDbName,
  resolvePrefix,
  summarizeManifestRows,
  writeJsonLines,
  writeJsonReport,
} from "./resource-s3-utils.mjs";

const REPORT_DIR = path.resolve(process.cwd(), "storage_reports");

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
  };
}

async function uploadFile(client, bucket, row) {
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: row.storageKey,
    Body: fs.createReadStream(row.absolutePath),
    ContentType: row.contentType,
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bucket = requiredEnv("AWS_S3_BUCKET");
  const prefix = resolvePrefix();
  const { manifestRows, skipped, materialRoot } = await collectLocalStudentResourceFiles();
  const rows = manifestRows.map((row) => {
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
      publicUrl: buildPublicUrl(bucket, storageKey),
    };
  });

  const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
  const mongoClient = new MongoClient(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017");
  await mongoClient.connect();

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  ensureDirectory(REPORT_DIR);

  const report = {
    mode: args.dryRun ? "DRY_RUN" : "WRITE",
    bucket,
    prefix,
    materialRoot,
    ...summarizeManifestRows(rows, skipped),
    uploaded: 0,
    updatedAssets: 0,
    updatedSharedResources: 0,
    updatedLegacyResources: 0,
    failed: 0,
    failures: [],
  };

  const db = mongoClient.db(resolveDbName());
  const now = new Date().toISOString();

  try {
    for (const row of rows) {
      try {
        if (!args.dryRun) {
          await uploadFile(s3, bucket, row);

          if (row.collection === "shared" && row.assetId) {
            await db.collection("assets").updateOne(
              { id: row.assetId },
              {
                $set: {
                  storage_provider: "s3",
                  storage_key: row.storageKey,
                  public_url: row.publicUrl,
                  bucket,
                  updated_at: now,
                  cloud_migrated_at: now,
                  cloud_source_path: row.localPath,
                },
              },
            );
            report.updatedAssets += 1;

            await db.collection("shared_resources").updateOne(
              { id: row.resourceId },
              {
                $set: {
                  url: row.publicUrl,
                  updated_at: now,
                },
              },
            );
            report.updatedSharedResources += 1;
          }

          if (row.collection === "legacy") {
            await db.collection("resources").updateOne(
              { id: row.resourceId },
              {
                $set: {
                  url: row.publicUrl,
                  updated_at: now,
                },
              },
            );
            report.updatedLegacyResources += 1;
          }
        }

        report.uploaded += 1;
      } catch (error) {
        report.failed += 1;
        if (report.failures.length < 50) {
          report.failures.push({
            resourceId: row.resourceId,
            localPath: row.localPath,
            storageKey: row.storageKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  } finally {
    await mongoClient.close();
  }

  const manifestPath = writeJsonLines(REPORT_DIR, `resource-s3-upload-manifest-${timestamp}.jsonl`, rows);
  const reportPath = writeJsonReport(REPORT_DIR, `resource-s3-upload-report-${timestamp}.json`, {
    ...report,
    manifestFile: manifestPath,
  });
  console.log(JSON.stringify({ ...report, manifestFile: manifestPath, reportFile: reportPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
