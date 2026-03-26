import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_DB_NAME,
  DEFAULT_MONGO_URI,
  connectMongo,
  guessLocalFileFromResource,
  logLine,
  nowIso,
  parseArgs,
  readJson,
  resolveAuditRoot,
  resolveRepoRoot,
  writeJson,
} from "./audit/_common.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    dryRun: false,
    mongoUri: DEFAULT_MONGO_URI,
    dbName: DEFAULT_DB_NAME,
    input: "resource_audit/reports/publisher_detection_report.json",
  });

  const confirm = process.argv.includes("--confirm");
  const repoRoot = resolveRepoRoot();
  const reportsDir = path.join(resolveAuditRoot(repoRoot), "reports");
  const inputPath = path.isAbsolute(args.input) ? args.input : path.join(repoRoot, args.input);
  const report = readJson(inputPath, null);
  if (!report) throw new Error(`Missing publisher detection report: ${inputPath}`);

  const candidates = Array.isArray(report.confirmedDeletionCandidates) ? report.confirmedDeletionCandidates : [];
  if (!confirm) {
    logLine(repoRoot, `audit:delete-confirmed-publishers dry-run only (${candidates.length} candidates). Re-run with --confirm to delete.`);
    writeJson(path.join(reportsDir, "confirmed_publisher_deletion_report.json"), {
      generatedAt: nowIso(),
      dryRun: true,
      totalCandidates: candidates.length,
      deletedResources: [],
      skippedResources: candidates,
    });
    return;
  }

  logLine(repoRoot, `audit:delete-confirmed-publishers starting delete for ${candidates.length} resources`);
  const { client, db } = await connectMongo(args.mongoUri, args.dbName);
  const deletedResources = [];
  const skippedResources = [];

  try {
    const ids = candidates.map((row) => String(row.id));
    const resources = await db.collection("shared_resources").find(
      { id: { $in: ids } },
      { projection: { _id: 0, id: 1, title: 1, url: 1, source_pdf: 1, asset_id: 1, import_source: 1 } },
    ).toArray();
    const resourceById = new Map(resources.map((row) => [String(row.id), row]));

    const assets = await db.collection("assets").find(
      { id: { $in: resources.map((row) => String(row.asset_id ?? "")).filter(Boolean) } },
      { projection: { _id: 0, id: 1, storage_key: 1 } },
    ).toArray();
    const assetById = new Map(assets.map((row) => [String(row.id), row]));

    const backup = candidates.map((candidate) => ({
      candidate,
      resource: resourceById.get(String(candidate.id)) || null,
      asset: resourceById.get(String(candidate.id))?.asset_id ? assetById.get(String(resourceById.get(String(candidate.id)).asset_id)) || null : null,
    }));
    writeJson(path.join(reportsDir, "confirmed_publisher_deletion_backup.json"), { generatedAt: nowIso(), totalCandidates: candidates.length, backup });

    for (const candidate of candidates) {
      const resource = resourceById.get(String(candidate.id));
      if (!resource) {
        skippedResources.push({ ...candidate, reason: "Resource not found in shared_resources" });
        continue;
      }

      const asset = resource.asset_id ? assetById.get(String(resource.asset_id)) : null;
      const localPath = guessLocalFileFromResource(repoRoot, resource, asset);

      await db.collection("tenant_resources").deleteMany({ resource_id: String(resource.id) });
      await db.collection("resource_view_events").deleteMany({ resource_id: String(resource.id) });
      await db.collection("shared_resources").deleteOne({ id: String(resource.id) });

      if (resource.asset_id) {
        const stillUsed = await db.collection("shared_resources").countDocuments({ asset_id: String(resource.asset_id) });
        if (stillUsed === 0) {
          await db.collection("assets").deleteOne({ id: String(resource.asset_id) });
          if (localPath && fs.existsSync(localPath)) {
            try { fs.unlinkSync(localPath); } catch {}
          }
        }
      } else if (localPath && fs.existsSync(localPath)) {
        try { fs.unlinkSync(localPath); } catch {}
      }

      deletedResources.push({ id: String(resource.id), title: resource.title, import_source: resource.import_source, filePath: localPath || resource.url || null, asset_id: resource.asset_id || null });
    }
  } finally {
    await client.close();
  }

  writeJson(path.join(reportsDir, "confirmed_publisher_deletion_report.json"), {
    generatedAt: nowIso(),
    dryRun: false,
    totalCandidates: candidates.length,
    deletedCount: deletedResources.length,
    skippedCount: skippedResources.length,
    deletedResources,
    skippedResources,
  });

  logLine(repoRoot, `audit:delete-confirmed-publishers completed (deleted=${deletedResources.length}, skipped=${skippedResources.length})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
