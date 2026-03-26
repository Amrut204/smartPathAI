import process from "node:process";

import {
  CRITICAL_COLLECTIONS,
  DEFAULT_SOURCE_DB,
  DEFAULT_SOURCE_URI,
  DEFAULT_TARGET_DB,
  DEFAULT_TARGET_URI,
  connectMongo,
  getCollectionCounts,
  indexSignature,
  listIndexes,
  listUserCollections,
  nowIso,
  parseFlag,
  summarizeMismatch,
  writeReport,
} from "./mongo-migration-utils.mjs";

async function main() {
  const argv = process.argv.slice(2);
  const sourceUri = parseFlag(argv, "source-uri", DEFAULT_SOURCE_URI);
  const sourceDbName = parseFlag(argv, "source-db", DEFAULT_SOURCE_DB);
  const targetUri = parseFlag(argv, "target-uri", DEFAULT_TARGET_URI);
  const targetDbName = parseFlag(argv, "target-db", DEFAULT_TARGET_DB);

  if (!targetUri) {
    throw new Error("MONGODB_URI_TEST or --target-uri is required.");
  }

  const sourceClient = await connectMongo(sourceUri);
  const targetClient = await connectMongo(targetUri);

  try {
    const sourceDb = sourceClient.db(sourceDbName);
    const targetDb = targetClient.db(targetDbName);

    const [sourceCollections, targetCollections] = await Promise.all([
      listUserCollections(sourceDb),
      listUserCollections(targetDb),
    ]);
    const allCollections = [...new Set([...sourceCollections, ...targetCollections])].sort((a, b) => a.localeCompare(b));
    const [sourceCounts, targetCounts] = await Promise.all([
      getCollectionCounts(sourceDb, allCollections),
      getCollectionCounts(targetDb, allCollections),
    ]);

    const collectionPresence = summarizeMismatch("collection_list", sourceCollections, targetCollections);
    const countResults = allCollections.map((name) => ({
      collection: name,
      sourceCount: Number(sourceCounts[name] || 0),
      targetCount: Number(targetCounts[name] || 0),
      matches: Number(sourceCounts[name] || 0) === Number(targetCounts[name] || 0),
    }));

    const criticalIndexes = [];
    for (const collectionName of CRITICAL_COLLECTIONS) {
      const [sourceIndexes, targetIndexes] = await Promise.all([
        listIndexes(sourceDb, collectionName).catch(() => []),
        listIndexes(targetDb, collectionName).catch(() => []),
      ]);
      const sourceSignatures = sourceIndexes.map(indexSignature).sort();
      const targetSignatures = targetIndexes.map(indexSignature).sort();
      criticalIndexes.push({
        collection: collectionName,
        sourceIndexCount: sourceIndexes.length,
        targetIndexCount: targetIndexes.length,
        matches: JSON.stringify(sourceSignatures) === JSON.stringify(targetSignatures),
        missingOnTarget: sourceIndexes
          .filter((index) => !targetSignatures.includes(indexSignature(index)))
          .map((index) => index.name),
      });
    }

    const report = {
      startedAt: nowIso(),
      source: { dbName: sourceDbName },
      target: { dbName: targetDbName },
      collectionPresence,
      countResults,
      criticalIndexes,
      finishedAt: nowIso(),
    };

    const ok = collectionPresence.matches
      && countResults.every((row) => row.matches)
      && criticalIndexes.every((row) => row.matches);

    const reportPath = await writeReport("mongo-atlas-verification", { ok, ...report });

    console.log(JSON.stringify({
      ok,
      sourceDb: sourceDbName,
      targetDb: targetDbName,
      collectionCount: allCollections.length,
      mismatchedCollections: countResults.filter((row) => !row.matches).map((row) => row.collection),
      indexFailures: criticalIndexes.filter((row) => !row.matches).map((row) => ({ collection: row.collection, missingOnTarget: row.missingOnTarget })),
      reportPath,
    }, null, 2));

    if (!ok) {
      process.exitCode = 1;
    }
  } finally {
    await Promise.allSettled([sourceClient.close(), targetClient.close()]);
  }
}

main().catch(async (error) => {
  const payload = {
    ok: false,
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
  const reportPath = await writeReport("mongo-atlas-verification-error", {
    ...payload,
    failedAt: nowIso(),
  }).catch(() => null);
  if (reportPath) payload.reportPath = reportPath;
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});
