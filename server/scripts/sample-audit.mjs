import path from "node:path";

import {
  nowIso,
  parseArgs,
  readJsonl,
  resolveAuditRoot,
  resolveRepoRoot,
  writeCsv,
  writeJson,
  writeText,
} from "./audit/_common.mjs";

function shuffle(values) {
  const out = [...values];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
}

function categoryToRisk(category) {
  const normalized = String(category ?? "").toLowerCase();
  if (normalized === "high") return "HIGH_RISK";
  if (normalized === "medium") return "MEDIUM_RISK";
  if (normalized === "safe") return "SAFE";
  return "LOW_RISK";
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { input: "resource_audit/reports/legal_audit_rows.jsonl" });
  const categoryArg = (() => {
    const raw = process.argv.find((entry) => entry.startsWith("--category="));
    return raw ? raw.slice("--category=".length) : "low";
  })();
  const sampleSize = (() => {
    const raw = process.argv.find((entry) => entry.startsWith("--sample-size="));
    const value = raw ? Number(raw.slice("--sample-size=".length)) : 50;
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 50;
  })();

  const repoRoot = resolveRepoRoot();
  const reportsDir = path.join(resolveAuditRoot(repoRoot), "reports");
  const inputPath = path.isAbsolute(args.input) ? args.input : path.join(repoRoot, args.input);
  const rows = readJsonl(inputPath);
  const targetRisk = categoryToRisk(categoryArg);
  const candidates = rows.filter((row) => row.riskLevel === targetRisk);
  const sample = shuffle(candidates).slice(0, Math.min(sampleSize, candidates.length));

  const output = {
    generatedAt: nowIso(),
    category: categoryArg,
    targetRisk,
    totalCandidates: candidates.length,
    sampleSize: sample.length,
    reviewInstructions: {
      rule90: "If 90%+ are safe, assume rest are safe.",
      rule70: "If 70-90% are safe, sample another 50.",
      below70: "If <70% are safe, deeper audit is needed.",
    },
    sample,
  };

  writeJson(path.join(reportsDir, `sample_audit_${categoryArg}.json`), output);
  writeCsv(path.join(reportsDir, `sample_audit_${categoryArg}.csv`), sample.map((row) => ({ id: row.id, title: row.title, import_source: row.import_source, resourceType: row.resourceType, filePath: row.localPath || row.url || "", riskFactors: (row.riskFactors || []).join(" | "), reviewerDecision: "", reviewerNotes: "" })), ["id", "title", "import_source", "resourceType", "filePath", "riskFactors", "reviewerDecision", "reviewerNotes"]);
  writeText(path.join(reportsDir, `sample_audit_${categoryArg}.md`), [`# Sample Audit (${categoryArg})`, "", `Generated: ${output.generatedAt}`, `Candidates in pool: ${candidates.length}`, `Sample size: ${sample.length}`, "", "Manual review guidance:", "- If 45+ of 50 are safe (90%+), treat the remaining pool as safe enough.", "- If 35-45 are safe (70-90%), sample another 50.", "- If fewer than 35 are safe (<70%), run a deeper audit."].join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
