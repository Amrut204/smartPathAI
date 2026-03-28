import fs from "node:fs";
import path from "node:path";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { MongoClient } from "mongodb";

import {
  buildPublicUrl,
  buildStorageKey,
  detectContentType,
  ensureDirectory,
  requiredEnv,
  resolveDbName,
  resolveMaterialRoot,
  resolvePrefix,
  writeJsonLines,
  writeJsonReport,
} from "./resource-s3-utils.mjs";

const IMPORT_SOURCE = "open_resource_core_content_v1";
const REPORT_DIR = path.resolve(process.cwd(), "storage_reports");

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadFile(client, bucket, row) {
  const body = fs.readFileSync(row.absolutePath);
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: row.storageKey,
        Body: body,
        ContentType: row.contentType,
      }));
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await sleep(1000 * attempt);
        continue;
      }
    }
  }
  throw lastError;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bucket = requiredEnv("AWS_S3_BUCKET");
  const prefix = resolvePrefix();
  const materialRoot = resolveMaterialRoot();
  const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
  const mongoClient = new MongoClient(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017");
  await mongoClient.connect();

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  ensureDirectory(REPORT_DIR);

  try {
    const db = mongoClient.db(resolveDbName());
    const topics = await db.collection("topics").find(
      {},
      { projection: { _id: 0, id: 1, name: 1 } },
    ).toArray();
    const topicNameById = new Map(topics.map((topic) => [String(topic.id), String(topic.name ?? "")]));

    const rows = await db.collection("assets").aggregate([
      { $match: { import_source: IMPORT_SOURCE, storage_provider: { $ne: "s3" } } },
      {
        $lookup: {
          from: "shared_resources",
          localField: "id",
          foreignField: "asset_id",
          as: "resource",
        },
      },
      { $unwind: "$resource" },
      {
        $project: {
          _id: 0,
          assetId: "$id",
          resourceId: "$resource.id",
          localPath: "$source_path",
          topicId: "$resource.topic_id",
          resourceType: "$resource.resource_type",
          title: "$resource.title",
        },
      },
    ]).toArray();

    const manifestRows = [];
    const missing = [];

    for (const row of rows) {
      const localPath = String(row.localPath ?? "").replace(/\\/g, "/");
      const absolutePath = path.resolve(materialRoot, localPath);
      if (!localPath || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        missing.push({
          assetId: String(row.assetId),
          resourceId: String(row.resourceId),
          localPath,
        });
        continue;
      }

      const topicId = row.topicId ? String(row.topicId) : null;
      const topicName = topicId ? (topicNameById.get(topicId) ?? "") : "";
      const storageKey = buildStorageKey({
        prefix,
        collection: "shared",
        resourceType: String(row.resourceType ?? "pdf"),
        topicId,
        topicName,
        localPath,
        resourceId: String(row.resourceId),
        assetId: String(row.assetId),
      });

      manifestRows.push({
        assetId: String(row.assetId),
        resourceId: String(row.resourceId),
        title: String(row.title ?? ""),
        localPath,
        absolutePath,
        topicId,
        topicName,
        resourceType: String(row.resourceType ?? "pdf"),
        contentType: detectContentType(absolutePath),
        sizeBytes: fs.statSync(absolutePath).size,
        storageKey,
        publicUrl: buildPublicUrl(bucket, storageKey),
      });
    }

    const report = {
      mode: args.dryRun ? "DRY_RUN" : "WRITE",
      importSource: IMPORT_SOURCE,
      bucket,
      prefix,
      materialRoot,
      totalRows: rows.length,
      readyRows: manifestRows.length,
      missingRows: missing.length,
      uploaded: 0,
      updatedAssets: 0,
      updatedResources: 0,
      failed: 0,
      failures: [],
    };

    const now = new Date().toISOString();

    for (const row of manifestRows) {
      try {
        if (!args.dryRun) {
          await uploadFile(s3, bucket, row);
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
          report.updatedResources += 1;
        }

        report.uploaded += 1;
      } catch (error) {
        report.failed += 1;
        if (report.failures.length < 50) {
          report.failures.push({
            assetId: row.assetId,
            resourceId: row.resourceId,
            localPath: row.localPath,
            storageKey: row.storageKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const manifestPath = writeJsonLines(REPORT_DIR, `open-resource-core-s3-manifest-${timestamp}.jsonl`, manifestRows);
    const reportPath = writeJsonReport(REPORT_DIR, `open-resource-core-s3-report-${timestamp}.json`, {
      ...report,
      missing,
      manifestFile: manifestPath,
    });

    console.log(JSON.stringify({ ...report, missing, manifestFile: manifestPath, reportFile: reportPath }, null, 2));
  } finally {
    await mongoClient.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
