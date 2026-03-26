import path from "node:path";

import { MongoClient } from "mongodb";

import { ensureDirectory, resolveDbName, writeJsonReport } from "./resource-s3-utils.mjs";

const REPORT_DIR = path.resolve(process.cwd(), "storage_reports");

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017");
  await client.connect();

  try {
    const db = client.db(resolveDbName());
    const [assetsByProvider, sharedByProvider, sharedByType, legacyByType, unmigratedSharedSample] = await Promise.all([
      db.collection("assets").aggregate([
        { $group: { _id: "$storage_provider", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      db.collection("shared_resources").aggregate([
        { $match: { is_active: true } },
        { $lookup: { from: "assets", localField: "asset_id", foreignField: "id", as: "asset" } },
        { $unwind: { path: "$asset", preserveNullAndEmptyArrays: true } },
        { $group: { _id: "$asset.storage_provider", count: { $sum: 1 } } },
      ]).toArray(),
      db.collection("shared_resources").aggregate([
        { $match: { is_active: true } },
        { $group: { _id: "$resource_type", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      db.collection("resources").aggregate([
        { $match: { is_active: true } },
        { $group: { _id: "$resource_type", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      db.collection("shared_resources").aggregate([
        { $match: { is_active: true, resource_type: { $ne: "external_link" } } },
        { $lookup: { from: "assets", localField: "asset_id", foreignField: "id", as: "asset" } },
        { $unwind: { path: "$asset", preserveNullAndEmptyArrays: true } },
        { $match: { $or: [{ "asset.storage_provider": { $ne: "s3" } }, { asset: null }] } },
        { $project: { _id: 0, id: 1, title: 1, resource_type: 1, asset_id: 1, source_pdf: 1, url: 1 } },
        { $limit: 50 },
      ]).toArray(),
    ]);

    const counts = {
      assetsTotal: await db.collection("assets").countDocuments({}),
      assetsS3: await db.collection("assets").countDocuments({ storage_provider: "s3" }),
      assetsLocal: await db.collection("assets").countDocuments({ storage_provider: "local" }),
      assetsWithPublicUrl: await db.collection("assets").countDocuments({ public_url: { $exists: true, $nin: [null, ""] } }),
      sharedTotal: await db.collection("shared_resources").countDocuments({ is_active: true }),
      sharedAssetBacked: await db.collection("shared_resources").countDocuments({ is_active: true, asset_id: { $exists: true, $nin: [null, ""] } }),
      legacyTotal: await db.collection("resources").countDocuments({ is_active: true }),
    };

    ensureDirectory(REPORT_DIR);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const report = {
      counts,
      assetsByProvider,
      sharedByProvider,
      sharedByType,
      legacyByType,
      unmigratedSharedSample,
    };
    const reportPath = writeJsonReport(REPORT_DIR, `resource-storage-reconciliation-${timestamp}.json`, report);
    console.log(JSON.stringify({ ...report, reportFile: reportPath }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
