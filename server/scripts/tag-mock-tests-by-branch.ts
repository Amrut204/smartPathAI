import "dotenv/config";

import { closeMongoConnection, getMongoDb } from "../src/utils/mongodb.js";
import {
  inferMockTestBranches,
  inferMockTestIsCrossBranch,
  normalizeMockTestBranches,
} from "../src/config/mock-test-branch.config.js";

function readFlag(name: string) {
  return process.argv.includes(name);
}

function readIntFlag(name: string, fallback: number) {
  const arg = process.argv.find((value) => value.startsWith(`${name}=`));
  if (!arg) return fallback;
  const parsed = Number(arg.split("=")[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function main() {
  const dryRun = readFlag("--dry-run");
  const sampleSize = readIntFlag("--sample", 20);
  const limit = readIntFlag("--limit", 5000);
  const now = new Date().toISOString();

  const db = await getMongoDb();
  const tests = await db.collection("mock_tests").find(
    { is_active: true },
    {
      projection: {
        _id: 0,
        id: 1,
        title: 1,
        topic_id: 1,
        company_id: 1,
        primary_branches: 1,
        is_cross_branch: 1,
      },
      sort: { created_at: -1 },
      limit,
    },
  ).toArray();

  const topicIds = [...new Set(tests.map((test) => test.topic_id).filter((value): value is string => Boolean(value)))];
  const companyIds = [...new Set(tests.map((test) => test.company_id).filter((value): value is string => Boolean(value)))];

  const [topics, companies] = await Promise.all([
    topicIds.length > 0
      ? db.collection("topics").find(
          { id: { $in: topicIds } },
          { projection: { _id: 0, id: 1, name: 1 } },
        ).toArray()
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.collection("companies").find(
          { id: { $in: companyIds } },
          { projection: { _id: 0, id: 1, name: 1 } },
        ).toArray()
      : Promise.resolve([]),
  ]);

  const topicMap = new Map(topics.map((topic) => [String(topic.id), String(topic.name ?? "")]));
  const companyMap = new Map(companies.map((company) => [String(company.id), String(company.name ?? "")]));

  const updates: Array<{
    id: string;
    title: string;
    topicName: string;
    companyName: string;
    primaryBranches: string[];
    isCrossBranch: boolean;
  }> = [];
  const unresolved: Array<{ id: string; title: string; topicName: string; companyName: string }> = [];
  let skippedTagged = 0;

  for (const test of tests) {
    const existingBranches = normalizeMockTestBranches(test.primary_branches);
    const existingCrossBranch = Boolean(test.is_cross_branch);
    if (existingBranches.length > 0 || existingCrossBranch) {
      skippedTagged += 1;
      continue;
    }

    const topicName = test.topic_id ? topicMap.get(String(test.topic_id)) ?? "" : "";
    const companyName = test.company_id ? companyMap.get(String(test.company_id)) ?? "" : "";
    const primaryBranches = inferMockTestBranches({
      title: String(test.title ?? ""),
      topicName,
      companyName,
    });
    const isCrossBranch = primaryBranches.length === 0 && inferMockTestIsCrossBranch({
      title: String(test.title ?? ""),
      topicName,
      companyName,
    });

    if (primaryBranches.length === 0 && !isCrossBranch) {
      unresolved.push({
        id: String(test.id),
        title: String(test.title ?? ""),
        topicName,
        companyName,
      });
      continue;
    }

    updates.push({
      id: String(test.id),
      title: String(test.title ?? ""),
      topicName,
      companyName,
      primaryBranches,
      isCrossBranch,
    });
  }

  console.log(`Scanned active tests: ${tests.length}`);
  console.log(`Already tagged: ${skippedTagged}`);
  console.log(`Taggable updates: ${updates.length}`);
  console.log(`Unresolved: ${unresolved.length}`);

  if (updates.length > 0) {
    console.log(`\nSample tagged tests (${Math.min(sampleSize, updates.length)}):`);
    console.table(
      updates.slice(0, sampleSize).map((item) => ({
        id: item.id,
        title: item.title,
        topicName: item.topicName,
        companyName: item.companyName,
        primaryBranches: item.primaryBranches.join(", "),
        isCrossBranch: item.isCrossBranch,
      })),
    );
  }

  if (unresolved.length > 0) {
    console.log(`\nSample unresolved tests (${Math.min(sampleSize, unresolved.length)}):`);
    console.table(unresolved.slice(0, sampleSize));
  }

  if (dryRun) {
    console.log("\nDry run complete. No updates written.");
    return;
  }

  if (updates.length === 0) {
    console.log("\nNo mock tests required branch tagging updates.");
    return;
  }

  const result = await db.collection("mock_tests").bulkWrite(
    updates.map((item) => ({
      updateOne: {
        filter: {
          id: item.id,
          $or: [
            { primary_branches: { $exists: false } },
            { primary_branches: { $size: 0 } },
          ],
          is_cross_branch: { $ne: true },
        },
        update: {
          $set: {
            primary_branches: item.primaryBranches,
            is_cross_branch: item.isCrossBranch,
            updated_at: now,
          },
        },
      },
    })),
    { ordered: false },
  );

  console.log("\nLive run complete.");
  console.log(`Matched: ${result.matchedCount}`);
  console.log(`Modified: ${result.modifiedCount}`);
}

main()
  .catch((error) => {
    console.error("Failed to tag mock tests by branch.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoConnection();
  });
