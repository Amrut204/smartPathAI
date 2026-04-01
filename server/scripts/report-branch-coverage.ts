import "dotenv/config";

import { closeMongoConnection, getMongoDb } from "../src/utils/mongodb.js";
import { BRANCH_PREP_TRACKS, type CanonicalBranchCode } from "../src/config/branch-prep.config.js";

async function main() {
  const db = await getMongoDb();
  const branches = Object.values(BRANCH_PREP_TRACKS).map((track) => track.branch as CanonicalBranchCode);

  const rows = await Promise.all(branches.map(async (branch) => {
    const [students, tenantResources, sharedResources, mockTests, packCounts] = await Promise.all([
      db.collection("students").countDocuments({ branch }),
      db.collection("resources").countDocuments({ is_active: true, branch_relevance: branch }),
      db.collection("shared_resources").countDocuments({ is_active: true, branch_relevance: branch }),
      db.collection("mock_tests").countDocuments({ is_active: true, primary_branches: branch }),
      Promise.all([
        db.collection("resources").distinct("content_pack_labels", { is_active: true, branch_relevance: branch }),
        db.collection("shared_resources").distinct("content_pack_labels", { is_active: true, branch_relevance: branch }),
      ]),
    ]);

    const packCount = new Set([
      ...packCounts[0].map((value) => String(value)),
      ...packCounts[1].map((value) => String(value)),
    ].filter(Boolean)).size;

    return {
      branch,
      students,
      resources: tenantResources + sharedResources,
      mockTests,
      packCount,
      qualifiesForFullSurfacing: tenantResources + sharedResources >= 10 && mockTests >= 5 && packCount >= 1,
    };
  }));

  console.table(rows);
}

main()
  .catch((error) => {
    console.error("Failed to build branch coverage report.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoConnection();
  });
