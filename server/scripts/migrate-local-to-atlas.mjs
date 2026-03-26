import process from "node:process";

import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_SOURCE_DB,
  DEFAULT_SOURCE_URI,
  DEFAULT_TARGET_DB,
  DEFAULT_TARGET_URI,
  assertTargetReady,
  connectMongo,
  copyCollection,
  getCollectionCounts,
  hasFlag,
  listUserCollections,
  nowIso,
  parseFlag,
  recreateIndexes,
  writeReport,
} from "./mongo-migration-utils.mjs";

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = hasFlag(argv, "dry-run");
  const allowNonEmpty = hasFlag(argv, "allow-nonempty");
  const sourceUri = parseFlag(argv, "source-uri", DEFAULT_SOURCE_URI);
  const sourceDbName = parseFlag(argv, "source-db", DEFAULT_SOURCE_DB);
  const targetUri = parseFlag(argv, "target-uri", DEFAULT_TARGET_URI);
  const targetDbName = parseFlag(argv, "target-db", DEFAULT_TARGET_DB);
  const batchSize = Number(parseFlag(argv, "batch-size", String(DEFAULT_BATCH_SIZE))) || DEFAULT_BATCH_SIZE;

  if (!targetUri) {
    throw new Error("MONGODB_URI_TEST or --target-uri is required.");
  }

  const sourceClient = await connectMongo(sourceUri);
  const targetClient = await connectMongo(targetUri);
  const report = {
    startedAt: nowIso(),
    dryRun,
    allowNonEmpty,
    source: { uriLabel: sourceUri === DEFAULT_SOURCE_URI ? "env:MONGODB_URI" : "custom", dbName: sourceDbName },
    target: { uriLabel: targetUri === DEFAULT_TARGET_URI ? "env:MONGODB_URI_TEST" : "custom", dbName: targetDbName },
    batchSize,
    sourceCollections: [],
    sourceCounts: {},
    targetBefore: null,
    migratedCollections: [],
    finishedAt: null,
  };

  try {
    const sourceDb = sourceClient.db(sourceDbName);
    const targetDb = targetClient.db(targetDbName);

    const collections = await listUserCollections(sourceDb);
    const sourceCounts = await getCollectionCounts(sourceDb, collections);
    const targetBefore = await assertTargetReady(targetDb, { allowNonEmpty });

    report.sourceCollections = collections;
    report.sourceCounts = sourceCounts;
    report.targetBefore = targetBefore;

    if (!dryRun) {
      for (const collectionName of collections) {
        const sourceCollectionCount = Number(sourceCounts[collectionName] || 0);
        const targetCollectionCount = Number(targetBefore.counts[collectionName] || 0);

        if (!targetBefore.collections.includes(collectionName)) {
          await targetDb.createCollection(collectionName);
        }

        let copyResult = { total: sourceCollectionCount, copied: 0, skipped: false };
        if (targetCollectionCount > 0) {
          if (targetCollectionCount !== sourceCollectionCount) {
            throw new Error(
              `Target collection ${collectionName} already has ${targetCollectionCount} documents; expected ${sourceCollectionCount}.`,
            );
          }
          copyResult = { total: sourceCollectionCount, copied: 0, skipped: true };
        } else if (sourceCollectionCount > 0) {
          copyResult = {
            ...(await copyCollection({ sourceDb, targetDb, collectionName, batchSize })),
            skipped: false,
          };
        }

        const indexResult = await recreateIndexes({ sourceDb, targetDb, collectionName });
        report.migratedCollections.push({
          name: collectionName,
          documents: copyResult,
          indexes: indexResult,
        });
      }
    }

    report.finishedAt = nowIso();
    const reportPath = await writeReport("mongo-atlas-migration", report);

    console.log(JSON.stringify({
      ok: true,
      dryRun,
      sourceDb: sourceDbName,
      targetDb: targetDbName,
      collections: collections.length,
      reportPath,
      targetWasEmpty: targetBefore.nonEmpty.length === 0,
    }, null, 2));
  } finally {
    await Promise.allSettled([sourceClient.close(), targetClient.close()]);
  }
}

main().catch(async (error) => {
  const payload = {
    ok: false,
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    details: typeof error === "object" && error && "details" in error ? error.details : null,
  };
  const reportPath = await writeReport("mongo-atlas-migration-error", {
    ...payload,
    failedAt: nowIso(),
  }).catch(() => null);
  if (reportPath) payload.reportPath = reportPath;
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});
