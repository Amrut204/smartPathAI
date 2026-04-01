import "dotenv/config";

import { closeMongoConnection, getMongoDb } from "../src/utils/mongodb.js";
import {
  normalizeProfileDegree,
  normalizeProfileLocations,
  normalizeProfileTargetRoles,
} from "../src/config/profile-options.config.js";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  const rows = await db.collection("students").find(
    {},
    { projection: { _id: 0, id: 1, tenant_id: 1, profile_data: 1 } },
  ).toArray();

  let normalized = 0;

  for (const row of rows) {
    const profileData = row.profile_data && typeof row.profile_data === "object"
      ? { ...(row.profile_data as Record<string, unknown>) }
      : {};

    const next = {
      ...profileData,
      degree: normalizeProfileDegree(profileData.degree),
      targetRoles: normalizeProfileTargetRoles(profileData.targetRoles),
      preferredLocations: normalizeProfileLocations(profileData.preferredLocations),
    };

    if (JSON.stringify(next) === JSON.stringify(profileData)) {
      continue;
    }

    normalized += 1;
    if (!dryRun) {
      await db.collection("students").updateOne(
        { tenant_id: row.tenant_id, id: row.id },
        { $set: { profile_data: next, updated_at: new Date().toISOString() } },
      );
    }
  }

  console.log(JSON.stringify({ totalStudents: rows.length, normalized, dryRun }, null, 2));
}

main()
  .catch((error) => {
    console.error("Failed to normalize student profile values.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoConnection();
  });
