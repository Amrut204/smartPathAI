import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { parseArgs } from "./lib/runtime.mjs";
import { applyImport, ensureOutputRoot, previewImport, sendCredentials, verifyImport } from "./lib/onboarding.mjs";

async function confirmSend(autoYes) {
  if (autoYes) return true;
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Verification passed. Send credential emails now? (y/N) ");
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tenantSlug = String(args.tenant ?? "").trim();
  const filePath = String(args.file ?? "").trim();
  if (!tenantSlug || !filePath) {
    throw new Error("Usage: node ops/student-onboarding/run.mjs --tenant <slug> --file <path> [--chunk-size 100] [--yes]");
  }

  await ensureOutputRoot();
  const preview = await previewImport({
    tenantSlug,
    filePath,
    createdBy: String(args["created-by"] ?? "ops-cli"),
    chunkSize: Number(args["chunk-size"] ?? 100),
    resetPasswords: Boolean(args["reset-passwords"]),
  });
  console.log("Preview summary:");
  console.log(JSON.stringify(preview, null, 2));

  const apply = await applyImport({
    tenantSlug,
    filePath,
    createdBy: String(args["created-by"] ?? "ops-cli"),
    chunkSize: Number(args["chunk-size"] ?? 100),
    pauseMs: Number(args["pause-ms"] ?? 50),
    resetPasswords: Boolean(args["reset-passwords"]),
  });
  console.log("Apply summary:");
  console.log(JSON.stringify(apply, null, 2));

  const verification = await verifyImport({ tenantSlug, batchId: apply.batchId });
  console.log("Verification summary:");
  console.log(JSON.stringify(verification, null, 2));
  if (verification.status !== "verified") {
    process.exitCode = 1;
    return;
  }

  if (!(await confirmSend(Boolean(args.yes)))) {
    console.log("Credential emails were not sent. Run send-credentials.mjs when ready.");
    return;
  }

  const emailResult = await sendCredentials({
    tenantSlug,
    batchId: apply.batchId,
    forceResend: Boolean(args["force-resend"]),
    onlyFailed: args.all ? false : true,
  });
  console.log("Credential email summary:");
  console.log(JSON.stringify(emailResult, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
