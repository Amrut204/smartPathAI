import "dotenv/config";

import { closeMongoConnection, getMongoDb } from "../src/utils/mongodb.js";
import { AdminSingletonService } from "../src/services/admin-singleton.service.js";

async function main() {
  await getMongoDb();
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) {
    const preview = await AdminSingletonService.preview();
    console.log(JSON.stringify({
      dryRun: true,
      ...preview,
    }, null, 2));
    await closeMongoConnection();
    return;
  }

  const result = await AdminSingletonService.cleanupDuplicateAdmins();
  console.log(JSON.stringify({
    dryRun: false,
    ...result,
  }, null, 2));
  await closeMongoConnection();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
