import { parseArgs } from "./lib/runtime.mjs";
import { ensureOutputRoot, verifyImport } from "./lib/onboarding.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tenantSlug = String(args.tenant ?? "").trim();
  const batchId = String(args.batch ?? "").trim();
  if (!tenantSlug || !batchId) {
    throw new Error("Usage: node ops/student-onboarding/verify.mjs --tenant <slug> --batch <batchId>");
  }

  await ensureOutputRoot();
  const result = await verifyImport({ tenantSlug, batchId });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
