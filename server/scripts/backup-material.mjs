import fs from "node:fs";
import path from "node:path";

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
import { uploadDirectoryToR2, uploadFileToR2 } from "./r2-backup.mjs";

function resolveMaterialRoot() {
  const candidates = [
    path.resolve(process.cwd(), "../material"),
    path.resolve(process.cwd(), "material"),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found ?? candidates[0];
}

function normalizeRelativePath(value) {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^material\//i, "")
    .replace(/^\/+/g, "");
}

async function copySelectedPaths(materialRoot, targetDir, lines) {
  let copied = 0;
  for (const line of lines) {
    const relativePath = normalizeRelativePath(line);
    if (!relativePath) continue;
    const sourcePath = path.join(materialRoot, relativePath.replace(/\//g, path.sep));
    if (!fs.existsSync(sourcePath)) continue;

    const destinationPath = path.join(targetDir, relativePath.replace(/\//g, path.sep));
    ensureDir(path.dirname(destinationPath));
    await fs.promises.copyFile(sourcePath, destinationPath);
    copied += 1;
  }
  return copied;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = hasFlag(argv, "dry-run");
  const materialRoot = path.resolve(parseFlag(argv, "material-root", resolveMaterialRoot()));
  const outputDir = path.resolve(parseFlag(argv, "output-dir", defaultBackupRoot("material")));
  const pathsFile = parseFlag(argv, "paths-file", "");
  const keepRecent = Number(parseFlag(argv, "keep-recent", "7")) || 7;
  const keepWeekly = Number(parseFlag(argv, "keep-weekly", "4")) || 4;

  if (!fs.existsSync(materialRoot)) {
    throw new Error(`Material root not found: ${materialRoot}`);
  }

  const snapshotName = `material-backup-${timestampLabel()}`;
  const snapshotDir = path.join(outputDir, snapshotName);
  const mode = pathsFile ? "selected_paths" : "full";
  let copiedFiles = 0;

  console.log(`[${nowIso()}] material backup starting (${mode})`);
  console.log(`materialRoot=${materialRoot}`);
  console.log(`outputDir=${outputDir}`);
  console.log(`snapshotDir=${snapshotDir}`);

  if (!dryRun) {
    ensureDir(outputDir);
    ensureDir(snapshotDir);

    if (pathsFile) {
      const lines = fs.readFileSync(path.resolve(pathsFile), "utf8").split(/\r?\n/).filter(Boolean);
      copiedFiles = await copySelectedPaths(materialRoot, snapshotDir, lines);
    } else {
      await fs.promises.cp(materialRoot, snapshotDir, { recursive: true });
    }

    const manifest = {
      createdAt: nowIso(),
      mode,
      materialRoot,
      snapshotDir,
      pathsFile: pathsFile ? path.resolve(pathsFile) : null,
      copiedFiles: pathsFile ? copiedFiles : null,
      offMachineDestination: "cloudflare-r2://backups/material/",
    };
    const manifestPath = path.join(snapshotDir, "backup-manifest.json");
    await fs.promises.writeFile(
      manifestPath,
      JSON.stringify(manifest, null, 2),
      "utf8",
    );

    const uploadedFiles = await uploadDirectoryToR2({
      localDir: snapshotDir,
      keyPrefix: `material/${snapshotName}`,
    });
    await fs.promises.writeFile(
      manifestPath,
      JSON.stringify({
        ...manifest,
        remoteManifest: {
          key: `material/${snapshotName}/backup-manifest.json`,
        },
        remoteFileCount: uploadedFiles.length,
      }, null, 2),
      "utf8",
    );
    await uploadFileToR2({
      localPath: manifestPath,
      key: `material/${snapshotName}/backup-manifest.json`,
    });

    const entries = await collectEntries(outputDir, (name) => name.startsWith("material-backup-"));
    const retention = pruneBackups(entries, { keepRecent, keepWeekly });
    for (const entry of retention.remove) {
      await fs.promises.rm(entry.path, { recursive: true, force: true });
      console.log(`pruned=${entry.path}`);
    }
  }

  console.log(`[${nowIso()}] material backup complete`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
