import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

import pdfParse from "pdf-parse";

import {
  DEFAULT_DB_NAME,
  DEFAULT_MONGO_URI,
  connectMongo,
  escapeForFileName,
  guessLocalFileFromResource,
  logLine,
  normalizeText,
  nowIso,
  parseArgs,
  resolveAuditRoot,
  resolveRepoRoot,
  writeCsv,
  writeJson,
  writeText,
} from "./audit/_common.mjs";

const PUBLISHERS = [
  "pearson",
  "mcgraw",
  "wiley",
  "springer",
  "elsevier",
  "cengage",
  "oxford university press",
];

const PUBLISHER_DOMAINS = [
  "pearson.com",
  "mheducation.com",
  "wiley.com",
  "springer.com",
  "elsevier.com",
  "sciencedirect.com",
  "cengage.com",
  "oup.com",
  "oxfordjournals.org",
];

function hasIsbn(text) {
  const value = normalizeText(text).toLowerCase();
  // Loose ISBN-10/13 detection with optional separators.
  return /\bisbn(?:-1[03])?\s*[:\-]?\s*(97[89][-\s]?)?(\d[-\s]?){9}[\dx]\b/i.test(value);
}

function extractDomains(text) {
  const out = new Set();
  const value = String(text ?? "");
  const urlMatches = value.match(/https?:\/\/[^\s\)"]+/g) || [];
  urlMatches.forEach((raw) => {
    try {
      const parsed = new URL(raw);
      out.add(parsed.hostname.toLowerCase());
    } catch {
      // ignore
    }
  });
  return [...out];
}

async function scanPdfIndicators(localPath) {
  if (!localPath || !fs.existsSync(localPath)) {
    return { ok: false, text: "" };
  }
  try {
    const buffer = fs.readFileSync(localPath);
    const parsed = await pdfParse(buffer);
    return { ok: true, text: normalizeText(parsed.text || "") };
  } catch {
    return { ok: false, text: "" };
  }
}

function detectRisk(resource, asset, pdfText) {
  const importSource = String(resource.import_source ?? "legacy_or_manual");
  const title = normalizeText(resource.title);
  const description = normalizeText(resource.description);
  const url = normalizeText(resource.url);
  const sourcePdf = normalizeText(resource.source_pdf);
  const storageKey = normalizeText(asset?.storage_key);
  const searchIndex = resource.search_index && typeof resource.search_index === "object" ? resource.search_index : {};
  const searchText = normalizeText(searchIndex.search_text || searchIndex.summary_short || "");
  const combined = `${title} ${description} ${url} ${sourcePdf} ${storageKey} ${searchText} ${pdfText}`.toLowerCase();

  const riskFactors = [];

  const publisherHit = PUBLISHERS.find((publisher) => combined.includes(publisher));
  if (publisherHit) {
    riskFactors.push(`Contains publisher name: ${publisherHit}`);
  }

  if (hasIsbn(combined)) {
    riskFactors.push("Contains ISBN indicator");
  }

  if (/\ball rights reserved\b/i.test(combined)) {
    riskFactors.push("Contains copyright notice: All Rights Reserved");
  }

  const domains = extractDomains(`${url} ${description} ${searchText}`);
  const publisherDomainHit = domains.find((domain) => PUBLISHER_DOMAINS.some((p) => domain === p || domain.endsWith(`.${p}`)));
  if (publisherDomainHit) {
    riskFactors.push(`Source domain includes publisher site: ${publisherDomainHit}`);
  }

  // Explicit import-source rules.
  if (/scrapedpdfs/i.test(importSource) || /question_source_harvest/i.test(importSource)) {
    riskFactors.push(`High-risk import source: ${importSource}`);
  }

  const containsNc = /\bcc[-\s]?by[-\s]?nc\b|\bnoncommercial\b/i.test(combined);
  if (containsNc) {
    riskFactors.push("Contains non-commercial license indicator (CC-BY-NC)");
  }

  const academicIndicators = [
    /\bdoi\s*:/i,
    /\bjournal of\b/i,
    /\bieee\b/i,
    /\bacm\b/i,
    /\bpublished in\b/i,
  ];
  if (academicIndicators.some((re) => re.test(combined))) {
    riskFactors.push("Academic paper indicators present (DOI/Journal/IEEE/ACM)");
  }

  const safeLicenseIndicators = [
    /\bcc[-\s]?by(?![-\s]?nc)\b/i,
    /\bcc0\b/i,
    /\bpublic domain\b/i,
    /\bmit license\b/i,
    /\bapache license\b/i,
    /\bbsd license\b/i,
  ];

  const hasSafeLicenseText = safeLicenseIndicators.some((re) => re.test(combined));

  // Risk level resolution in priority order.
  const isHigh = riskFactors.some((f) => f.startsWith("Contains publisher name:"))
    || riskFactors.includes("Contains ISBN indicator")
    || riskFactors.some((f) => f.startsWith("Source domain includes publisher site:"))
    || riskFactors.some((f) => f.startsWith("High-risk import source:"));

  if (isHigh) {
    return {
      riskLevel: "HIGH_RISK",
      riskFactors,
      recommendedAction: "DELETE IMMEDIATELY",
    };
  }

  const isSafe = importSource === "external_resource_metadata_v1"
    || (/openstax/i.test(combined) && hasSafeLicenseText)
    || (hasSafeLicenseText && !containsNc);

  if (isSafe) {
    return {
      riskLevel: "SAFE",
      riskFactors: riskFactors.length ? riskFactors : ["Clear permissive/open license indicator found"],
      recommendedAction: "KEEP with attribution requirements",
    };
  }

  const isMedium = importSource === "open_resource_master_v1"
    || /repo_resource_harvest/i.test(importSource)
    || containsNc
    || riskFactors.includes("Academic paper indicators present (DOI/Journal/IEEE/ACM)");

  if (isMedium) {
    return {
      riskLevel: "MEDIUM_RISK",
      riskFactors: riskFactors.length ? riskFactors : [`Needs license verification for import source: ${importSource}`],
      recommendedAction: "VERIFY LICENSE",
    };
  }

  const isLow = /repo_resource_nonpdf/i.test(importSource)
    || /external_link/i.test(String(resource.resource_type ?? ""))
    || hasSafeLicenseText;

  if (isLow) {
    return {
      riskLevel: "LOW_RISK",
      riskFactors: riskFactors.length ? riskFactors : ["Probably safe but verify attribution/license details"],
      recommendedAction: "VERIFY (low priority)",
    };
  }

  return {
    riskLevel: "LOW_RISK",
    riskFactors: riskFactors.length ? riskFactors : ["No strong indicators found; treat as low risk and verify"],
    recommendedAction: "VERIFY (low priority)",
  };
}

function percent(part, total) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    dryRun: false,
    mongoUri: DEFAULT_MONGO_URI,
    dbName: DEFAULT_DB_NAME,
    limit: 0,
  });

  const repoRoot = resolveRepoRoot();
  const auditRoot = resolveAuditRoot(repoRoot);
  const reportsDir = path.join(auditRoot, "reports");
  const reportPath = path.join(reportsDir, "legal_audit_report.json");

  logLine(repoRoot, `audit:analyze starting (db=${args.dbName}, uri=${args.mongoUri})`);

  const { client, db } = await connectMongo(args.mongoUri, args.dbName);
  try {
    const shared = await db.collection("shared_resources").find(
      {},
      {
        projection: {
          _id: 0,
          id: 1,
          title: 1,
          description: 1,
          url: 1,
          resource_type: 1,
          source_pdf: 1,
          asset_id: 1,
          import_source: 1,
          search_index: 1,
          is_active: 1,
          created_at: 1,
        },
      },
    ).toArray();

    const scoped = args.limit > 0 ? shared.slice(0, args.limit) : shared;
    const assetIds = [...new Set(scoped.map((r) => String(r.asset_id ?? "")).filter(Boolean))];
    const assets = assetIds.length > 0
      ? await db.collection("assets").find(
          { id: { $in: assetIds } },
          { projection: { _id: 0, id: 1, storage_key: 1, mime_type: 1, size_bytes: 1 } },
        ).toArray()
      : [];
    const assetById = new Map(assets.map((a) => [String(a.id), a]));

    const rows = [];
    let scannedPdf = 0;

    for (let index = 0; index < scoped.length; index += 1) {
      const resource = scoped[index];
      const asset = resource.asset_id ? assetById.get(String(resource.asset_id)) : null;
      const localPath = guessLocalFileFromResource(repoRoot, resource, asset);

      const type = String(resource.resource_type ?? "unknown");
      const shouldScanPdf = type === "pdf" && localPath && fs.existsSync(localPath);
      const pdfText = shouldScanPdf ? (await scanPdfIndicators(localPath)).text : "";
      if (shouldScanPdf) scannedPdf += 1;

      const result = detectRisk(resource, asset, pdfText);

      rows.push({
        id: String(resource.id),
        title: String(resource.title ?? ""),
        description: String(resource.description ?? ""),
        url: String(resource.url ?? ""),
        resourceType: type,
        import_source: String(resource.import_source ?? "legacy_or_manual"),
        asset_id: resource.asset_id ? String(resource.asset_id) : null,
        source_pdf: resource.source_pdf ? String(resource.source_pdf) : null,
        localPath: localPath || null,
        riskLevel: result.riskLevel,
        riskFactors: result.riskFactors,
        recommendedAction: result.recommendedAction,
      });

      if ((index + 1) % 100 === 0) {
        logLine(repoRoot, `audit:analyze progress ${index + 1}/${scoped.length}`);
      }
    }

    const totalResources = rows.length;
    const high = rows.filter((r) => r.riskLevel === "HIGH_RISK");
    const medium = rows.filter((r) => r.riskLevel === "MEDIUM_RISK");
    const low = rows.filter((r) => r.riskLevel === "LOW_RISK");
    const safe = rows.filter((r) => r.riskLevel === "SAFE");

    const byImportSource = rows.reduce((acc, row) => {
      const key = row.import_source;
      if (!acc[key]) {
        acc[key] = { total: 0, high: 0, medium: 0, low: 0, safe: 0 };
      }
      acc[key].total += 1;
      if (row.riskLevel === "HIGH_RISK") acc[key].high += 1;
      else if (row.riskLevel === "MEDIUM_RISK") acc[key].medium += 1;
      else if (row.riskLevel === "SAFE") acc[key].safe += 1;
      else acc[key].low += 1;
      return acc;
    }, {});

    const report = {
      auditDate: nowIso(),
      db: { name: args.dbName },
      totalResources,
      scannedPdf,
      summary: {
        highRisk: { count: high.length, percentage: percent(high.length, totalResources) },
        mediumRisk: { count: medium.length, percentage: percent(medium.length, totalResources) },
        lowRisk: { count: low.length, percentage: percent(low.length, totalResources) },
        safe: { count: safe.length, percentage: percent(safe.length, totalResources) },
      },
      byImportSource,
      highRiskResources: high.slice(0, 400).map((r) => ({
        _id: r.id,
        title: r.title,
        filePath: r.localPath,
        import_source: r.import_source,
        riskFactors: r.riskFactors,
        recommendedAction: r.recommendedAction,
      })),
      mediumRiskResources: medium.slice(0, 400).map((r) => ({
        _id: r.id,
        title: r.title,
        filePath: r.localPath,
        import_source: r.import_source,
        riskFactors: r.riskFactors,
        recommendedAction: r.recommendedAction,
      })),
      lowRiskResources: low.slice(0, 400).map((r) => ({
        _id: r.id,
        title: r.title,
        filePath: r.localPath,
        import_source: r.import_source,
        riskFactors: r.riskFactors,
        recommendedAction: r.recommendedAction,
      })),
      safeResources: safe.slice(0, 400).map((r) => ({
        _id: r.id,
        title: r.title,
        filePath: r.localPath,
        import_source: r.import_source,
        riskFactors: r.riskFactors,
        recommendedAction: r.recommendedAction,
      })),
      actionPlan: {
        immediateDelete: high.length,
        needsReview: medium.length,
        probablySafe: low.length,
        verified: safe.length,
      },
    };

    writeJson(reportPath, report);

    const csvRows = rows.map((r) => ({
      id: r.id,
      title: r.title,
      import_source: r.import_source,
      resource_type: r.resourceType,
      riskLevel: r.riskLevel,
      recommendedAction: r.recommendedAction,
      localPath: r.localPath ?? "",
      url: r.url ?? "",
      riskFactors: r.riskFactors.join(" | "),
    }));
    writeCsv(
      path.join(reportsDir, "deletion_candidates.csv"),
      csvRows.filter((r) => r.riskLevel === "HIGH_RISK"),
      ["id", "title", "import_source", "resource_type", "riskLevel", "recommendedAction", "localPath", "url", "riskFactors"],
    );
    writeCsv(
      path.join(reportsDir, "license_verification_needed.csv"),
      csvRows.filter((r) => r.riskLevel === "MEDIUM_RISK"),
      ["id", "title", "import_source", "resource_type", "riskLevel", "recommendedAction", "localPath", "url", "riskFactors"],
    );
    writeCsv(
      path.join(reportsDir, "safe_resources.csv"),
      csvRows.filter((r) => r.riskLevel === "SAFE"),
      ["id", "title", "import_source", "resource_type", "riskLevel", "recommendedAction", "localPath", "url", "riskFactors"],
    );

    const summaryMd = [
      "# Legal Audit Summary",
      "",
      `Audit date: ${report.auditDate}`,
      `DB: ${args.dbName}`,
      `Total shared resources: ${totalResources}`,
      `PDFs scanned for indicators: ${scannedPdf}`,
      "",
      "## Distribution",
      `- HIGH RISK: ${high.length} (${report.summary.highRisk.percentage}%)`,
      `- MEDIUM RISK: ${medium.length} (${report.summary.mediumRisk.percentage}%)`,
      `- LOW RISK: ${low.length} (${report.summary.lowRisk.percentage}%)`,
      `- SAFE: ${safe.length} (${report.summary.safe.percentage}%)`,
      "",
      "## Next Actions",
      `- Immediate delete candidates: ${high.length}`,
      `- License verification needed: ${medium.length}`,
      `- Probably safe but verify: ${low.length}`,
      `- Verified safe: ${safe.length}`,
      "",
      "Reports:",
      "- reports/legal_audit_report.json",
      "- reports/deletion_candidates.csv",
      "- reports/license_verification_needed.csv",
      "- reports/safe_resources.csv",
      "",
    ].join("\n");

    writeText(path.join(auditRoot, "audit_summary.md"), summaryMd);

    // Also write a compact JSONL for downstream scripts.
    const jsonlPath = path.join(reportsDir, "legal_audit_rows.jsonl");
    const jsonl = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
    fs.writeFileSync(jsonlPath, jsonl);

    logLine(repoRoot, `audit:analyze complete (high=${high.length}, medium=${medium.length}, low=${low.length}, safe=${safe.length})`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  const repoRoot = resolveRepoRoot();
  logLine(repoRoot, `audit:analyze failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

