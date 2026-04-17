import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

import { closeMongoConnection, getMongoDb } from "../src/utils/mongodb.js";

type CandidateStudent = {
  tenantId: string;
  studentId: string;
  rollNumber: string;
};

type DuplicatePrnEntry = {
  tenantId: string;
  prn: string;
  count: number;
  sampleStudentIds: string[];
};

type ConflictSample = {
  tenantId: string;
  studentId: string;
  candidatePrn: string;
  reason: string;
};

type MissingRollSample = {
  tenantId: string;
  studentId: string;
};

type UpdatedSample = {
  tenantId: string;
  studentId: string;
  prn: string;
};

type UpdateFailureSample = {
  tenantId: string;
  studentId: string;
  prn: string;
  error: string;
};

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function parseFlag(flagName: string): string | undefined {
  const prefix = `--${flagName}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) {
    return direct.slice(prefix.length);
  }

  const index = process.argv.findIndex((arg) => arg === `--${flagName}`);
  if (index >= 0 && index + 1 < process.argv.length) {
    const next = process.argv[index + 1];
    if (!next.startsWith("--")) {
      return next;
    }
  }

  return undefined;
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getTenantPrnSet(registry: Map<string, Set<string>>, tenantId: string): Set<string> {
  const existing = registry.get(tenantId);
  if (existing) return existing;
  const next = new Set<string>();
  registry.set(tenantId, next);
  return next;
}

function timestampLabel(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeReport(payload: unknown): Promise<string> {
  const reportDir = path.join(process.cwd(), "storage_reports");
  await fs.mkdir(reportDir, { recursive: true });
  const filePath = path.join(reportDir, `student-prn-backfill-${timestampLabel()}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

function printUsage() {
  console.log([
    "Usage: tsx scripts/backfill-student-prn.ts [options]",
    "",
    "Options:",
    "  --apply                  Persist backfill updates. Without this flag, script runs in dry-run mode.",
    "  --tenant-id=<id>         Restrict scan and updates to one tenant.",
    "  --max-updates=<n>        Cap eligible updates processed in this run.",
    "  --sample-size=<n>        Sample size per section in report (default: 25).",
    "  --help                   Print this help message.",
    "",
    "Examples:",
    "  tsx scripts/backfill-student-prn.ts",
    "  tsx scripts/backfill-student-prn.ts --tenant-id=tenant_abc",
    "  tsx scripts/backfill-student-prn.ts --apply --tenant-id=tenant_abc --max-updates=500",
  ].join("\n"));
}

async function main() {
  if (hasFlag("--help")) {
    printUsage();
    return;
  }

  const dryRun = !hasFlag("--apply");
  const tenantIdFilter = normalizeText(parseFlag("tenant-id"));
  const maxUpdates = parsePositiveInt(parseFlag("max-updates"));
  const sampleSize = parsePositiveInt(parseFlag("sample-size")) ?? 25;

  const db = await getMongoDb();
  const students = db.collection("students");

  const scanFilter = tenantIdFilter ? { tenant_id: tenantIdFilter } : {};
  const projection = { _id: 0, id: 1, tenant_id: 1, roll_number: 1, profile_data: 1 };
  const cursor = students.find(scanFilter, { projection });

  const prnRegistry = new Map<string, Set<string>>();
  const duplicateTracker = new Map<string, DuplicatePrnEntry>();
  const candidates: CandidateStudent[] = [];

  let scannedStudents = 0;
  let withPrn = 0;
  let missingPrn = 0;
  let skippedNoTenant = 0;

  for await (const rawRow of cursor) {
    scannedStudents += 1;
    const row = rawRow as Record<string, unknown>;
    const tenantId = normalizeText(row.tenant_id);
    if (!tenantId) {
      skippedNoTenant += 1;
      continue;
    }

    const studentId = normalizeText(row.id);
    const rollNumber = normalizeText(row.roll_number);
    const profileData = toRecord(row.profile_data);
    const prn = normalizeText(profileData.prn);

    if (prn) {
      withPrn += 1;
      getTenantPrnSet(prnRegistry, tenantId).add(prn);

      const duplicateKey = `${tenantId}\u0000${prn}`;
      const existing = duplicateTracker.get(duplicateKey);
      if (existing) {
        existing.count += 1;
        if (studentId && existing.sampleStudentIds.length < 5) {
          existing.sampleStudentIds.push(studentId);
        }
      } else {
        duplicateTracker.set(duplicateKey, {
          tenantId,
          prn,
          count: 1,
          sampleStudentIds: studentId ? [studentId] : [],
        });
      }
      continue;
    }

    missingPrn += 1;
    candidates.push({ tenantId, studentId, rollNumber });
  }

  const duplicatePrnRows = [...duplicateTracker.values()]
    .filter((entry) => entry.count > 1)
    .sort((a, b) => b.count - a.count);

  const conflictSamples: ConflictSample[] = [];
  const missingRollSamples: MissingRollSample[] = [];
  const updatedSamples: UpdatedSample[] = [];
  const updateFailureSamples: UpdateFailureSample[] = [];

  let candidatesWithMissingRoll = 0;
  let conflicts = 0;
  let skippedByLimit = 0;
  let eligibleForBackfill = 0;
  let updated = 0;
  let updateFailures = 0;

  const now = new Date().toISOString();

  for (const candidate of candidates) {
    const nextPrn = candidate.rollNumber;
    if (!nextPrn) {
      candidatesWithMissingRoll += 1;
      if (missingRollSamples.length < sampleSize) {
        missingRollSamples.push({ tenantId: candidate.tenantId, studentId: candidate.studentId });
      }
      continue;
    }

    const tenantPrnSet = getTenantPrnSet(prnRegistry, candidate.tenantId);
    if (tenantPrnSet.has(nextPrn)) {
      conflicts += 1;
      if (conflictSamples.length < sampleSize) {
        conflictSamples.push({
          tenantId: candidate.tenantId,
          studentId: candidate.studentId,
          candidatePrn: nextPrn,
          reason: "candidate PRN already exists in tenant",
        });
      }
      continue;
    }

    if (maxUpdates !== null && eligibleForBackfill >= maxUpdates) {
      skippedByLimit += 1;
      continue;
    }

    eligibleForBackfill += 1;

    if (dryRun) {
      tenantPrnSet.add(nextPrn);
      if (updatedSamples.length < sampleSize) {
        updatedSamples.push({ tenantId: candidate.tenantId, studentId: candidate.studentId, prn: nextPrn });
      }
      continue;
    }

    try {
      const result = await students.updateOne(
        { tenant_id: candidate.tenantId, id: candidate.studentId },
        { $set: { "profile_data.prn": nextPrn, updated_at: now } },
      );

      if (result.matchedCount === 1) {
        tenantPrnSet.add(nextPrn);
        updated += 1;
        if (updatedSamples.length < sampleSize) {
          updatedSamples.push({ tenantId: candidate.tenantId, studentId: candidate.studentId, prn: nextPrn });
        }
      } else {
        updateFailures += 1;
        if (updateFailureSamples.length < sampleSize) {
          updateFailureSamples.push({
            tenantId: candidate.tenantId,
            studentId: candidate.studentId,
            prn: nextPrn,
            error: "No matching student found during update.",
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/E11000|duplicate key/i.test(message)) {
        conflicts += 1;
        if (conflictSamples.length < sampleSize) {
          conflictSamples.push({
            tenantId: candidate.tenantId,
            studentId: candidate.studentId,
            candidatePrn: nextPrn,
            reason: "duplicate key conflict during update",
          });
        }
      } else {
        updateFailures += 1;
        if (updateFailureSamples.length < sampleSize) {
          updateFailureSamples.push({ tenantId: candidate.tenantId, studentId: candidate.studentId, prn: nextPrn, error: message });
        }
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: dryRun ? "dry-run" : "apply",
    tenantIdFilter: tenantIdFilter || null,
    maxUpdates,
    sampleSize,
    scan: {
      scannedStudents,
      withPrn,
      missingPrn,
      skippedNoTenant,
    },
    duplicatePrn: {
      duplicateKeyCount: duplicatePrnRows.length,
      duplicateRows: duplicatePrnRows.reduce((acc, row) => acc + row.count, 0),
      sample: duplicatePrnRows.slice(0, sampleSize),
    },
    backfill: {
      candidates: candidates.length,
      candidatesWithMissingRoll,
      conflicts,
      skippedByLimit,
      eligibleForBackfill,
      wouldBackfill: dryRun ? eligibleForBackfill : null,
      updated: dryRun ? 0 : updated,
      updateFailures,
      sampleUpdated: updatedSamples,
      sampleMissingRoll: missingRollSamples,
      sampleConflicts: conflictSamples,
      sampleUpdateFailures: updateFailureSamples,
    },
  };

  const reportPath = await writeReport(report);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}

main()
  .catch((error) => {
    console.error("Failed to run student PRN backfill script.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoConnection();
  });
