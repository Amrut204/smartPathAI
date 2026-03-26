import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_DB_NAME,
  DEFAULT_MONGO_URI,
  connectMongo,
  logLine,
  nowIso,
  parseArgs,
  readJson,
  readJsonl,
  resolveAuditRoot,
  resolveRepoRoot,
  writeCsv,
  writeJson,
  writeText,
} from "./audit/_common.mjs";

const GITHUB_API = "https://api.github.com";
const GITHUB_HEADERS = {
  "accept": "application/vnd.github+json",
  "user-agent": "campusdrive-legal-audit",
};

function sanitizeRepoFolder(repo) {
  return String(repo ?? "").replace(/[\\/]+/g, "-").replace(/\./g, "-").toLowerCase();
}

function inferRepoSlug(resource, repoMetaBySlug, repoFolderToSlug) {
  const title = String(resource.title ?? "");
  const description = String(resource.description ?? "");
  const text = `${title} ${description}`;

  const importedFrom = text.match(/Imported from\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i);
  if (importedFrom?.[1]) return importedFrom[1];

  const titleSlug = title.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
  if (titleSlug?.[1]) return titleSlug[1];

  const filePath = String(resource.filePath ?? resource.url ?? resource.source_pdf ?? "");
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const folderMatch = normalized.match(/repo_harvested(?:_nonpdf)?_resources\/([^/]+)/);
  if (folderMatch?.[1] && repoFolderToSlug.has(folderMatch[1])) {
    return repoFolderToSlug.get(folderMatch[1]);
  }

  for (const slug of repoMetaBySlug.keys()) {
    if (text.toLowerCase().includes(slug.toLowerCase())) return slug;
  }

  return null;
}

function inferOerProvider(resource) {
  const combined = `${resource.title ?? ""} ${resource.description ?? ""} ${resource.filePath ?? ""} ${resource.url ?? ""} ${resource.source_pdf ?? ""}`.toLowerCase();
  if (combined.includes("openstax")) return "openstax";
  if (combined.includes("mit opencourseware") || combined.includes("mit-ocw") || combined.includes("ocw.mit.edu")) return "mit_ocw";
  if (combined.includes("libretexts")) return "libretexts";
  if (combined.includes("bccampus")) return "bccampus";
  if (combined.includes("open textbook") || combined.includes("open_textbook")) return "open_textbook_library";
  if (combined.includes("pressbooks")) return "pressbooks";
  return null;
}

function normalizeLicense(spdx, name) {
  const value = String(spdx || name || "").trim();
  if (!value) return { license: "NO_LICENSE", canUseCommercially: false, attributionRequired: false, action: "REMOVE", reason: "No license found" };

  if (/^NOASSERTION$|^UNLICENSED$/i.test(value)) {
    return { license: value, canUseCommercially: false, attributionRequired: false, action: "REMOVE", reason: "No clear commercial license" };
  }
  if (/^MIT$/i.test(value)) {
    return { license: "MIT", canUseCommercially: true, attributionRequired: true, action: "KEEP", reason: "MIT license allows commercial use with attribution" };
  }
  if (/^APACHE-?2\.0$/i.test(value) || /apache/i.test(value)) {
    return { license: "Apache-2.0", canUseCommercially: true, attributionRequired: true, action: "KEEP", reason: "Apache license allows commercial use with attribution" };
  }
  if (/^BSD/i.test(value) || /bsd/i.test(value)) {
    return { license: value, canUseCommercially: true, attributionRequired: true, action: "KEEP", reason: "BSD license allows commercial use with attribution" };
  }
  if (/^ISC$/i.test(value) || /^MPL-?2\.0$/i.test(value)) {
    return { license: value, canUseCommercially: true, attributionRequired: true, action: "KEEP", reason: "Permissive open-source license" };
  }
  if (/GPL|AGPL|LGPL/i.test(value)) {
    return { license: value, canUseCommercially: false, attributionRequired: true, action: "REMOVE", reason: "GPL-family license is incompatible with a closed-source product" };
  }
  if (/CC-BY-NC|CC BY-NC|NONCOMMERCIAL/i.test(value)) {
    return { license: value, canUseCommercially: false, attributionRequired: true, action: "REMOVE", reason: "Non-commercial Creative Commons license is not allowed for a paid product" };
  }
  if (/CC-BY(?!-NC)|CC BY(?!-NC)|CC0|PUBLIC DOMAIN/i.test(value)) {
    return { license: value, canUseCommercially: true, attributionRequired: !/CC0|PUBLIC DOMAIN/i.test(value), action: "KEEP", reason: "Open license allows commercial use" };
  }

  return { license: value, canUseCommercially: false, attributionRequired: false, action: "REVIEW", reason: "License requires manual review" };
}

async function fetchGithubRepoLicense(repoSlug) {
  try {
    const response = await fetch(`${GITHUB_API}/repos/${repoSlug}`, { headers: GITHUB_HEADERS });
    if (!response.ok) return { ok: false, status: response.status };
    const json = await response.json();
    const license = normalizeLicense(json.license?.spdx_id, json.license?.name);
    return {
      ok: true,
      repo: repoSlug,
      default_branch: json.default_branch ?? null,
      html_url: json.html_url ?? `https://github.com/${repoSlug}`,
      license_spdx: json.license?.spdx_id ?? null,
      license_name: json.license?.name ?? null,
      ...license,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function classifyOer(provider, resource) {
  const combined = `${resource.title ?? ""} ${resource.description ?? ""} ${resource.filePath ?? ""}`.toLowerCase();
  if (provider === "openstax") {
    return { provider, license: "CC-BY-4.0", canUseCommercially: true, attributionRequired: true, action: "KEEP", reason: "OpenStax content is CC-BY 4.0" };
  }
  if (provider === "mit_ocw") {
    return { provider, license: "CC-BY-NC-SA", canUseCommercially: false, attributionRequired: true, action: "REMOVE", reason: "MIT OCW is typically CC-BY-NC-SA and not allowed for commercial use" };
  }
  if (provider === "libretexts") {
    return { provider, license: "CC-BY-NC-SA", canUseCommercially: false, attributionRequired: true, action: "REMOVE", reason: "LibreTexts is commonly CC-BY-NC-SA and needs removal for a paid product" };
  }
  if (provider === "bccampus") {
    return { provider, license: "CC-BY", canUseCommercially: true, attributionRequired: true, action: "KEEP", reason: "BCcampus resources are typically CC-BY" };
  }
  if (provider === "open_textbook_library") {
    if (/cc[-\s]?by(?![-\s]?nc)|public domain|cc0/i.test(combined)) {
      return { provider, license: "CC-BY-compatible", canUseCommercially: true, attributionRequired: true, action: "KEEP", reason: "Explicit permissive license found in resource metadata" };
    }
    return { provider, license: "VARIES", canUseCommercially: false, attributionRequired: true, action: "REVIEW", reason: "Open Textbook Library licenses vary by title" };
  }
  if (provider === "pressbooks") {
    if (/cc[-\s]?by(?![-\s]?nc)|public domain|cc0/i.test(combined)) {
      return { provider, license: "CC-BY-compatible", canUseCommercially: true, attributionRequired: true, action: "KEEP", reason: "Explicit permissive license found in resource metadata" };
    }
    return { provider, license: "VARIES", canUseCommercially: false, attributionRequired: true, action: "REVIEW", reason: "Pressbooks licenses vary by title" };
  }
  return { provider: provider || "unknown", license: "UNKNOWN", canUseCommercially: false, attributionRequired: false, action: "REVIEW", reason: "Unable to verify OER license automatically" };
}

function classifyFallback(resource) {
  const combined = `${resource.title ?? ""} ${resource.filePath ?? ""} ${resource.riskFactors?.join(" ") ?? ""}`.toLowerCase();
  if (/all rights reserved|careercup|casebook|product manager|copyright/i.test(combined)) {
    return { sourceKind: "fallback", license: "UNKNOWN", canUseCommercially: false, attributionRequired: false, action: "REMOVE", reason: "Likely copyrighted proprietary material" };
  }
  if (/doi|journal of|ieee|acm|published in/i.test(combined)) {
    return { sourceKind: "fallback", license: "ACADEMIC_UNKNOWN", canUseCommercially: false, attributionRequired: true, action: "REMOVE", reason: "Academic publication indicators need rights clearance" };
  }
  return { sourceKind: "fallback", license: "UNKNOWN", canUseCommercially: false, attributionRequired: false, action: "REVIEW", reason: "No definitive repo or OER license signal found" };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    dryRun: false,
    mongoUri: DEFAULT_MONGO_URI,
    dbName: DEFAULT_DB_NAME,
    input: "resource_audit/reports/legal_audit_report.json",
  });

  const repoRoot = resolveRepoRoot();
  const auditRoot = resolveAuditRoot(repoRoot);
  const reportsDir = path.join(auditRoot, "reports");
  const inputPath = path.isAbsolute(args.input) ? args.input : path.join(repoRoot, args.input);
  const report = readJson(inputPath, null);
  if (!report) throw new Error(`Missing audit report: ${inputPath}`);

  const mediumResources = Array.isArray(report.mediumRiskResources) ? report.mediumRiskResources : [];
  logLine(repoRoot, `audit:licenses starting for ${mediumResources.length} medium-risk resources`);

  const repoCacheRows = [
    ...readJsonl(path.join(repoRoot, "repo_resource_harvester/output/metadata/repos.jsonl")),
    ...readJsonl(path.join(repoRoot, "repo_resource_harvester/output_v2/metadata/repos.jsonl")),
  ];
  const repoMetaBySlug = new Map();
  const repoFolderToSlug = new Map();
  for (const row of repoCacheRows) {
    const repo = String(row.repo ?? "");
    if (!repo) continue;
    repoMetaBySlug.set(repo, row);
    repoFolderToSlug.set(sanitizeRepoFolder(repo), repo);
  }

  const decisions = [];
  const repoSummary = new Map();

  const { client, db } = await connectMongo(args.mongoUri, args.dbName);
  try {
    const sharedRows = await db.collection("shared_resources").find(
      { id: { $in: mediumResources.map((resource) => String(resource._id)) } },
      { projection: { _id: 0, id: 1, title: 1, description: 1, url: 1, source_pdf: 1, import_source: 1, resource_type: 1, asset_id: 1 } },
    ).toArray();
    const sharedById = new Map(sharedRows.map((row) => [String(row.id), row]));

    for (let index = 0; index < mediumResources.length; index += 1) {
      const auditResource = mediumResources[index];
      const resource = { ...sharedById.get(String(auditResource._id)), ...auditResource };
      let decision;
      let repoUrl = null;
      let repoSlug = null;
      let provider = null;

      if (/repo_/i.test(String(resource.import_source ?? ""))) {
        repoSlug = inferRepoSlug(resource, repoMetaBySlug, repoFolderToSlug);
        repoUrl = repoSlug ? `https://github.com/${repoSlug}` : null;
        if (repoSlug) {
          const fetched = await fetchGithubRepoLicense(repoSlug);
          if (fetched.ok) {
            decision = {
              sourceKind: "github_repo",
              repoSlug,
              repoUrl,
              detectedLicense: fetched.license,
              canUseCommercially: fetched.canUseCommercially,
              attributionRequired: fetched.attributionRequired,
              action: fetched.action,
              reason: fetched.reason,
            };
          } else {
            const cached = repoMetaBySlug.get(repoSlug);
            const normalized = normalizeLicense(cached?.license, cached?.license);
            decision = {
              sourceKind: "github_repo",
              repoSlug,
              repoUrl,
              detectedLicense: normalized.license,
              canUseCommercially: normalized.canUseCommercially,
              attributionRequired: normalized.attributionRequired,
              action: normalized.action,
              reason: fetched.status ? `GitHub API ${fetched.status}; fallback to cached repo metadata` : normalized.reason,
            };
          }
        } else {
          decision = { sourceKind: "github_repo", repoSlug: null, repoUrl: null, detectedLicense: "UNKNOWN", canUseCommercially: false, attributionRequired: false, action: "REMOVE", reason: "Repo-derived resource without a resolvable source repository" };
        }
      } else {
        provider = inferOerProvider(resource);
        if (provider) {
          const oer = classifyOer(provider, resource);
          decision = {
            sourceKind: "oer_source",
            provider: oer.provider,
            detectedLicense: oer.license,
            canUseCommercially: oer.canUseCommercially,
            attributionRequired: oer.attributionRequired,
            action: oer.action,
            reason: oer.reason,
          };
        } else {
          decision = classifyFallback(resource);
        }
      }

      if (!args.dryRun) {
        await db.collection("shared_resources").updateOne(
          { id: String(resource._id) },
          {
            $set: {
              "legal_audit.license_check.checked_at": nowIso(),
              "legal_audit.license_check.source_kind": decision.sourceKind,
              "legal_audit.license_check.repo_slug": repoSlug,
              "legal_audit.license_check.repo_url": repoUrl,
              "legal_audit.license_check.oer_provider": provider,
              "legal_audit.license_check.detected_license": decision.detectedLicense,
              "legal_audit.license_check.can_use_commercially": decision.canUseCommercially,
              "legal_audit.license_check.attribution_required": decision.attributionRequired,
              "legal_audit.license_check.action": decision.action,
              "legal_audit.license_check.reason": decision.reason,
            },
          },
        );
      }

      decisions.push({
        id: String(resource._id),
        title: String(resource.title ?? ""),
        filePath: String(resource.filePath ?? resource.url ?? ""),
        import_source: String(resource.import_source ?? ""),
        riskFactors: resource.riskFactors ?? [],
        repoUrl,
        repoSlug,
        provider,
        license: decision.detectedLicense,
        canUseCommercially: decision.canUseCommercially,
        attributionRequired: decision.attributionRequired,
        action: decision.action,
        reason: decision.reason,
      });

      if (repoSlug) {
        const existing = repoSummary.get(repoSlug) || {
          repoUrl: `https://github.com/${repoSlug}`,
          license: decision.detectedLicense,
          canUseCommercially: decision.canUseCommercially,
          attributionRequired: decision.attributionRequired,
          affectedResources: 0,
          action: decision.action === "KEEP" ? "KEEP with attribution" : decision.action === "REMOVE" ? "REMOVE" : "REVIEW",
        };
        existing.affectedResources += 1;
        repoSummary.set(repoSlug, existing);
      }

      if ((index + 1) % 10 === 0 || index === mediumResources.length - 1) {
        logLine(repoRoot, `audit:licenses progress ${index + 1}/${mediumResources.length}`);
      }
    }
  } finally {
    await client.close();
  }

  const keep = decisions.filter((row) => row.action === "KEEP");
  const remove = decisions.filter((row) => row.action === "REMOVE");
  const review = decisions.filter((row) => row.action === "REVIEW");

  const output = {
    generatedAt: nowIso(),
    inputAuditReport: inputPath,
    totalChecked: decisions.length,
    summary: { keep: keep.length, remove: remove.length, review: review.length },
    repos: [...repoSummary.entries()].map(([repo, info]) => ({ repo, ...info })),
    resources: decisions,
    keepResources: keep,
    removeResources: remove,
    reviewResources: review,
  };

  writeJson(path.join(reportsDir, "github_license_audit.json"), output);
  writeCsv(path.join(reportsDir, "medium_risk_keep_list.csv"), keep.map((row) => ({ id: row.id, title: row.title, import_source: row.import_source, repo_or_provider: row.repoSlug || row.provider || "", license: row.license, attributionRequired: row.attributionRequired, reason: row.reason })), ["id", "title", "import_source", "repo_or_provider", "license", "attributionRequired", "reason"]);
  writeCsv(path.join(reportsDir, "medium_risk_remove_list.csv"), remove.map((row) => ({ id: row.id, title: row.title, import_source: row.import_source, repo_or_provider: row.repoSlug || row.provider || "", license: row.license, reason: row.reason })), ["id", "title", "import_source", "repo_or_provider", "license", "reason"]);
  writeCsv(path.join(reportsDir, "medium_risk_review_list.csv"), review.map((row) => ({ id: row.id, title: row.title, import_source: row.import_source, repo_or_provider: row.repoSlug || row.provider || "", license: row.license, reason: row.reason })), ["id", "title", "import_source", "repo_or_provider", "license", "reason"]);
  writeText(path.join(reportsDir, "github_license_audit_summary.md"), ["# GitHub / OER License Audit", "", `Generated: ${output.generatedAt}`, `Checked medium-risk resources: ${output.totalChecked}`, "", `- Keep: ${keep.length}`, `- Remove: ${remove.length}`, `- Review: ${review.length}`, "", "## Repo Summary", ...output.repos.map((repo) => `- ${repo.repo}: ${repo.license} -> ${repo.action} (${repo.affectedResources} resources)`)].join("\n"));

  logLine(repoRoot, `audit:licenses completed (keep=${keep.length}, remove=${remove.length}, review=${review.length})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
