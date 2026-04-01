import "dotenv/config";

import { closeMongoConnection, getMongoDb } from "../src/utils/mongodb.js";
import { getCanonicalBranchCode } from "../src/config/branch-prep.config.js";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  const rows = await db.collection("students").find(
    {},
    { projection: { _id: 0, id: 1, tenant_id: 1, branch: 1 } },
  ).toArray();

  let normalized = 0;
  let unchanged = 0;
  let unmapped = 0;
  const sampleUnmapped = new Set<string>();

  for (const row of rows) {
    const currentBranch = String(row.branch ?? "").trim();
    const canonicalBranch = getCanonicalBranchCode(currentBranch);

    if (!canonicalBranch) {
      unmapped += 1;
      if (currentBranch) sampleUnmapped.add(currentBranch);
      continue;
    }

    if (currentBranch === canonicalBranch) {
      unchanged += 1;
      continue;
    }

    normalized += 1;
    if (!dryRun) {
      await db.collection("students").updateOne(
        { id: row.id, tenant_id: row.tenant_id },
        { $set: { branch: canonicalBranch, updated_at: new Date().toISOString() } },
      );
    }
  }

  console.log(JSON.stringify({
    totalStudents: rows.length,
    normalized,
    unchanged,
    unmapped,
    dryRun,
    sampleUnmapped: [...sampleUnmapped].slice(0, 20),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("Failed to normalize student branches.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoConnection();
  });
