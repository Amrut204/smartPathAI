import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import pdfParse from "pdf-parse";

import {
  logLine,
  nowIso,
  parseArgs,
  readJson,
  resolveAuditRoot,
  resolveRepoRoot,
  writeCsv,
  writeJson,
  writeText,
} from "./audit/_common.mjs";

const execFileAsync = promisify(execFile);

const PUBLISHERS = [
  "Pearson",
  "McGraw-Hill",
  "McGraw",
  "Wiley",
  "Springer",
  "Elsevier",
  "Cengage",
  "Oxford University Press",
  "Cambridge University Press",
  "Schaum",
];

const ISBN_REGEX = /\bisbn(?:-1[03])?\s*[:\-]?\s*(97[89][-\s]?)?(\d[-\s]?){9}[\dx]\b/i;

function extractSnippet(text, term) {
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return null;
  return text.slice(Math.max(0, index - 80), Math.min(text.length, index + 160)).replace(/\s+/g, " ").trim();
}

function binaryFallbackPreview(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const text = buffer.toString("latin1", 0, Math.min(buffer.length, 512 * 1024)).replace(/\s+/g, " ").trim();
    return { ok: true, text, pages: null, fallback: "binary_scan" };
  } catch (error) {
    return { ok: false, text: "", pages: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function readPdfPreview(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const parsed = await pdfParse(buffer);
    const text = String(parsed.text ?? "").replace(/\s+/g, " ").trim();
    return { ok: true, text: text.slice(0, 25000), pages: parsed.numpages ?? null };
  } catch (error) {
    return { ok: false, text: "", pages: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function readPdfPreviewWithTimeout(filePath) {
  const childSource = [
    "import fs from 'node:fs';",
    "import pdfParse from 'pdf-parse';",
    "const filePath = process.argv[1];",
    "const buffer = fs.readFileSync(filePath);",
    "const parsed = await pdfParse(buffer);",
    "const text = String(parsed.text ?? '').replace(/\\s+/g, ' ').trim().slice(0, 25000);",
    "process.stdout.write(JSON.stringify({ ok: true, text, pages: parsed.numpages ?? null }));",
  ].join("");

  try {
    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", childSource, filePath], {
      cwd: path.join(resolveRepoRoot(), "server"),
      timeout: 20000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return JSON.parse(stdout || "{}");
  } catch (error) {
    const fallback = binaryFallbackPreview(filePath);
    if (fallback.ok) {
      return {
        ...fallback,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      ok: false,
      text: "",
      pages: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function analyzePdf(resource, preview) {
  const combined = `${resource.title ?? ""} ${preview.text}`.toLowerCase();
  const publisherHits = PUBLISHERS.filter((name) => combined.includes(name.toLowerCase()));
  const isbn = ISBN_REGEX.test(combined);
  const allRightsReserved = /\ball rights reserved\b/i.test(combined);
  const copyright = /\bcopyright\b/i.test(combined);
  const evidence = [];

  for (const hit of publisherHits) {
    evidence.push(`Publisher: ${hit}${extractSnippet(preview.text, hit) ? ` | ${extractSnippet(preview.text, hit)}` : ""}`);
  }
  if (isbn) evidence.push("ISBN pattern detected");
  if (allRightsReserved) evidence.push("Contains 'All Rights Reserved'");
  if (copyright) evidence.push("Contains copyright notice");

  let severity = "LOW";
  let recommendedAction = "PROBABLY SAFE";
  let confidenceScore = 15;

  if (publisherHits.length > 0 && isbn && (allRightsReserved || copyright)) {
    severity = "SEVERE";
    recommendedAction = "DELETE IMMEDIATELY";
    confidenceScore = 95;
  } else if (publisherHits.length > 0 && (isbn || allRightsReserved || copyright)) {
    severity = "HIGH";
    recommendedAction = "LIKELY DELETE";
    confidenceScore = 80;
  } else if (publisherHits.length > 0 || isbn || allRightsReserved || copyright) {
    severity = "MEDIUM";
    recommendedAction = "REVIEW";
    confidenceScore = 55;
  }

  return { severity, recommendedAction, confidenceScore, publisherHits, isbn, copyright, allRightsReserved, evidence };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, consume));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { dryRun: false, input: "resource_audit/reports/legal_audit_report.json" });

  const repoRoot = resolveRepoRoot();
  const auditRoot = resolveAuditRoot(repoRoot);
  const reportsDir = path.join(auditRoot, "reports");
  const inputPath = path.isAbsolute(args.input) ? args.input : path.join(repoRoot, args.input);
  const report = readJson(inputPath, null);
  if (!report) throw new Error(`Missing audit report: ${inputPath}`);

  const highRisk = Array.isArray(report.highRiskResources) ? report.highRiskResources : [];
  logLine(repoRoot, `audit:publishers starting for ${highRisk.length} high-risk resources`);

  const findings = await runPool(highRisk, 5, async (resource, index) => {
    logLine(repoRoot, `audit:publishers scanning ${index + 1}/${highRisk.length} ${resource.title}`);
    const preview = await readPdfPreviewWithTimeout(resource.filePath);
    if (!preview.ok) {
      return {
        id: String(resource._id),
        title: resource.title,
        filePath: resource.filePath,
        import_source: resource.import_source,
        status: "error",
        error: preview.error,
        severity: "MEDIUM",
        recommendedAction: "REVIEW",
        confidenceScore: 0,
        publisherHits: [],
        evidence: [`PDF parse failed: ${preview.error}`],
      };
    }

    const analysis = analyzePdf(resource, preview);
    return {
      id: String(resource._id),
      title: resource.title,
      filePath: resource.filePath,
      import_source: resource.import_source,
      status: "ok",
      pageCount: preview.pages,
      ...analysis,
    };
  });

  const bySeverity = findings.reduce((acc, row) => {
    acc[row.severity] = (acc[row.severity] || 0) + 1;
    return acc;
  }, {});

  const byPublisher = {};
  for (const finding of findings) {
    for (const publisher of finding.publisherHits) {
      byPublisher[publisher] = (byPublisher[publisher] || 0) + 1;
    }
  }

  const confirmedDeletionCandidates = findings.filter((row) => row.severity === "SEVERE" || row.severity === "HIGH");
  const detectionReport = {
    generatedAt: nowIso(),
    inputAuditReport: inputPath,
    totalScanned: findings.length,
    summary: {
      severe: bySeverity.SEVERE || 0,
      high: bySeverity.HIGH || 0,
      medium: bySeverity.MEDIUM || 0,
      low: bySeverity.LOW || 0,
      errors: findings.filter((row) => row.status === "error").length,
    },
    byPublisher,
    confirmedDeletionCandidates,
    findings,
  };

  writeJson(path.join(reportsDir, "publisher_detection_report.json"), detectionReport);
  writeCsv(path.join(reportsDir, "publisher_detection_candidates.csv"), confirmedDeletionCandidates.map((row) => ({ id: row.id, title: row.title, filePath: row.filePath, severity: row.severity, confidenceScore: row.confidenceScore, publishers: row.publisherHits.join("; "), evidence: row.evidence.join(" | "), action: row.recommendedAction })), ["id", "title", "filePath", "severity", "confidenceScore", "publishers", "evidence", "action"]);
  writeText(path.join(reportsDir, "publisher_detection_summary.md"), ["# Publisher Detection Report", "", `Generated: ${detectionReport.generatedAt}`, `Scanned: ${findings.length}`, "", `- Severe: ${detectionReport.summary.severe}`, `- High: ${detectionReport.summary.high}`, `- Medium: ${detectionReport.summary.medium}`, `- Low: ${detectionReport.summary.low}`, "", "## Confirmed Deletion Candidates", ...confirmedDeletionCandidates.map((row) => `- ${row.title} (${row.severity}, confidence ${row.confidenceScore})`)].join("\n"));

  logLine(repoRoot, `audit:publishers completed (confirmed=${confirmedDeletionCandidates.length})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
