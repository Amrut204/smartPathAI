import { parseArgs } from "./lib/runtime.mjs";
import { ensureOutputRoot, sendCredentials } from "./lib/onboarding.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tenantSlug = String(args.tenant ?? "").trim();
  const batchId = String(args.batch ?? "").trim();
  if (!tenantSlug || !batchId) {
    throw new Error("Usage: node ops/student-onboarding/send-credentials.mjs --tenant <slug> --batch <batchId> [--force-resend]");
  }

  await ensureOutputRoot();
  const result = await sendCredentials({
    tenantSlug,
    batchId,
    forceResend: Boolean(args["force-resend"]),
    onlyFailed: args.all ? false : true,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
