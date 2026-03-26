import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_DB_NAME,
  DEFAULT_MONGO_URI,
  connectMongo,
  guessLocalFileFromResource,
  logLine,
  nowIso,
  resolveAuditRoot,
  resolveRepoRoot,
  writeJson,
} from "./audit/_common.mjs";

function csvSplitLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function parseCsv(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = csvSplitLine(lines[0]).map((value) => value.trim());
  return lines.slice(1).map((line) => {
    const values = csvSplitLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = String(values[index] ?? "").trim();
    });
    return row;
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run") || !argv.includes("--confirm");
  const repoRoot = resolveRepoRoot();
  const reportsDir = path.join(resolveAuditRoot(repoRoot), "reports");
  const inputPath = path.join(reportsDir, "deletion_candidates.csv");
  const rows = parseCsv(inputPath);
  const candidateIds = rows.map((row) => String(row.id)).filter(Boolean);
  const pathsFile = path.join(reportsDir, "high_risk_material_paths.txt");

  logLine(repoRoot, `delete-high-risk-resources start (candidates=${candidateIds.length}, dryRun=${String(dryRun)})`);

  const { client, db } = await connectMongo(DEFAULT_MONGO_URI, DEFAULT_DB_NAME);
  try {
    const resources = await db.collection("shared_resources").find(
      { id: { $in: candidateIds } },
      { projection: { _id: 0, id: 1, title: 1, url: 1, source_pdf: 1, asset_id: 1, import_source: 1, is_active: 1 } },
    ).toArray();
    const resourceById = new Map(resources.map((resource) => [String(resource.id), resource]));

    const assetIds = resources.map((resource) => String(resource.asset_id ?? "")).filter(Boolean);
    const assets = assetIds.length > 0
      ? await db.collection("assets").find(
          { id: { $in: assetIds } },
          { projection: { _id: 0, id: 1, storage_key: 1 } },
        ).toArray()
      : [];
    const assetById = new Map(assets.map((asset) => [String(asset.id), asset]));

    const backupRows = rows.map((candidate) => {
      const resource = resourceById.get(String(candidate.id)) ?? null;
      const asset = resource?.asset_id ? assetById.get(String(resource.asset_id)) ?? null : null;
      const filePath = resource ? guessLocalFileFromResource(repoRoot, resource, asset) : String(candidate.localPath ?? "");
      return {
        candidate,
        resource,
        asset,
        filePath: filePath || null,
      };
    });

    writeJson(path.join(reportsDir, "high_risk_cleanup_backup.json"), {
      generatedAt: nowIso(),
      totalCandidates: rows.length,
      matchedResources: resources.length,
      backupRows,
    });

    fs.writeFileSync(
      pathsFile,
      backupRows
        .map((row) => String(row.filePath ?? "").replace(/\\/g, "/"))
        .filter(Boolean)
        .join("\n"),
      "utf8",
    );

    if (dryRun) {
      writeJson(path.join(reportsDir, "high_risk_cleanup_report.json"), {
        generatedAt: nowIso(),
        dryRun: true,
        totalCandidates: rows.length,
        matchedResources: resources.length,
        missingCandidates: rows.filter((candidate) => !resourceById.has(String(candidate.id))).map((candidate) => candidate.id),
      });
      return;
    }

    if (candidateIds.length > 0) {
      await db.collection("shared_resources").updateMany(
        { id: { $in: candidateIds } },
        { $set: { is_active: false, updated_at: nowIso() } },
      );
    }

    const deletedResources = [];
    const skippedResources = [];

    for (const candidate of rows) {
      const resource = resourceById.get(String(candidate.id));
      if (!resource) {
        skippedResources.push({ id: candidate.id, reason: "Resource not found" });
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
            try {
              fs.unlinkSync(localPath);
            } catch {
              // Ignore file delete failures and keep moving.
            }
          }
        }
      } else if (localPath && fs.existsSync(localPath)) {
        try {
          fs.unlinkSync(localPath);
        } catch {
          // Ignore file delete failures and keep moving.
        }
      }

      deletedResources.push({
        id: String(resource.id),
        title: String(resource.title ?? ""),
        localPath: localPath || null,
        assetId: resource.asset_id ? String(resource.asset_id) : null,
      });
    }

    writeJson(path.join(reportsDir, "high_risk_cleanup_report.json"), {
      generatedAt: nowIso(),
      dryRun: false,
      totalCandidates: rows.length,
      deletedCount: deletedResources.length,
      skippedCount: skippedResources.length,
      deletedResources,
      skippedResources,
    });
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
