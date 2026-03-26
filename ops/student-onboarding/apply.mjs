import { parseArgs } from "./lib/runtime.mjs";
import { applyImport, ensureOutputRoot } from "./lib/onboarding.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tenantSlug = String(args.tenant ?? "").trim();
  const filePath = String(args.file ?? "").trim();
  if (!tenantSlug || !filePath) {
    throw new Error("Usage: node ops/student-onboarding/apply.mjs --tenant <slug> --file <path> [--chunk-size 100] [--reset-passwords]");
  }

  await ensureOutputRoot();
  const result = await applyImport({
    tenantSlug,
    filePath,
    createdBy: String(args["created-by"] ?? "ops-cli"),
    chunkSize: Number(args["chunk-size"] ?? 100),
    pauseMs: Number(args["pause-ms"] ?? 50),
    resetPasswords: Boolean(args["reset-passwords"]),
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
