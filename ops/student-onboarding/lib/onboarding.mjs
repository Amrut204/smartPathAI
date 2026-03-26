import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  ONBOARDING_COLLECTION,
  OUTPUT_ROOT,
  XLSX,
  bcryptHash,
  connectMongo,
  csvEscape,
  decryptFromFile,
  encryptToFile,
  ensureOutputDir,
  loadOnboardingEnv,
  nowIso,
  writeJson,
  writeText,
} from "./runtime.mjs";
import { buildCredentialMessage, deliverCredentialEmail, loadCredentialTemplates } from "./mailer.mjs";

const REQUIRED_FIELDS = ["fullName", "email", "rollNumber", "branch", "batch"];
const OPTIONAL_FIELDS = ["prn", "degree", "currentSemester", "cgpa", "backlogs", "totalHistoricalBacklogs", "attendancePct"];
const ACTIVE_BATCH_STATUSES = ["previewed", "applying", "applied", "verified", "email_queued", "partial"];
const RESUMABLE_BATCH_STATUSES = ["previewed", "failed", "partial"];
const HEADER_ALIASES = {
  fullName: ["fullname", "full_name", "studentname", "student_name", "name"],
  email: ["email", "collegeemail", "college_email", "loginemail", "login_email"],
  rollNumber: ["rollnumber", "roll_number", "rollno", "roll_no"],
  branch: ["branch", "department"],
  batch: ["batch", "graduationyear", "graduation_year", "passoutyear", "passout_year"],
  prn: ["prn", "prnnumber", "prn_number", "registrationnumber", "registration_number"],
  degree: ["degree", "program", "course"],
  currentSemester: ["currentsemester", "current_semester", "semester", "currentyear", "current_year"],
  cgpa: ["cgpa"],
  backlogs: ["backlogs", "activebacklogs", "active_backlogs"],
  totalHistoricalBacklogs: ["totalhistoricalbacklogs", "total_historical_backlogs", "totalbacklogs", "backlogs_total"],
  attendancePct: ["attendancepct", "attendance_pct", "attendancepercentage", "attendance_percentage", "attendance"],
};

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeCell(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return normalizeCell(value).toLowerCase();
}

function parseOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function buildTempPassword() {
  return `PIQ!${randomBytes(8).toString("base64url")}9a`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMapping(headers) {
  const headerRows = headers.map((raw) => ({ raw, normalized: normalizeHeader(raw) }));
  const mapping = {};
  for (const field of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]) {
    const aliases = [field, ...(HEADER_ALIASES[field] ?? [])].map(normalizeHeader);
    const match = headerRows.find((entry) => aliases.includes(entry.normalized));
    if (match?.raw) {
      mapping[field] = match.raw;
    }
  }
  return mapping;
}

function validateRow(row) {
  const issues = [];
  if (!row.fullName) issues.push("Missing fullName");
  if (!row.email) issues.push("Missing email");
  if (!row.rollNumber) issues.push("Missing rollNumber");
  if (!row.branch) issues.push("Missing branch");
  if (!row.batch) issues.push("Missing batch");
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) issues.push("Invalid email");

  const cgpa = parseOptionalNumber(row.cgpa);
  if (row.cgpa && (!Number.isFinite(cgpa) || cgpa < 0 || cgpa > 10)) issues.push("Invalid cgpa");
  const backlogs = parseOptionalNumber(row.backlogs);
  if (row.backlogs && (!Number.isFinite(backlogs) || backlogs < 0)) issues.push("Invalid backlogs");
  const totalBacklogs = parseOptionalNumber(row.totalHistoricalBacklogs);
  if (row.totalHistoricalBacklogs && (!Number.isFinite(totalBacklogs) || totalBacklogs < 0)) issues.push("Invalid totalHistoricalBacklogs");
  const attendance = parseOptionalNumber(row.attendancePct);
  if (row.attendancePct && (!Number.isFinite(attendance) || attendance < 0 || attendance > 100)) issues.push("Invalid attendancePct");
  return issues;
}

function createParsedRecord(record, mapping, rowNumber) {
  const row = {
    rowNumber,
    fullName: normalizeCell(record[mapping.fullName]),
    email: normalizeEmail(record[mapping.email]),
    rollNumber: normalizeCell(record[mapping.rollNumber]),
    branch: normalizeCell(record[mapping.branch]),
    batch: normalizeCell(record[mapping.batch]),
    prn: normalizeCell(mapping.prn ? record[mapping.prn] : ""),
    degree: normalizeCell(mapping.degree ? record[mapping.degree] : ""),
    currentSemester: normalizeCell(mapping.currentSemester ? record[mapping.currentSemester] : ""),
    cgpa: normalizeCell(mapping.cgpa ? record[mapping.cgpa] : ""),
    backlogs: normalizeCell(mapping.backlogs ? record[mapping.backlogs] : ""),
    totalHistoricalBacklogs: normalizeCell(mapping.totalHistoricalBacklogs ? record[mapping.totalHistoricalBacklogs] : ""),
    attendancePct: normalizeCell(mapping.attendancePct ? record[mapping.attendancePct] : ""),
  };
  return {
    ...row,
    issues: validateRow(row),
  };
}

async function parseImportFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const ext = path.extname(absolutePath).toLowerCase();
  if (![".csv", ".xlsx", ".xls"].includes(ext)) {
    throw new Error("Only .csv, .xlsx, and .xls files are supported.");
  }

  const buffer = await readFile(absolutePath);
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    raw: false,
    cellFormula: false,
    dense: true,
  });
  const firstSheet = workbook.SheetNames[0] ? workbook.Sheets[workbook.SheetNames[0]] : undefined;
  if (!firstSheet) throw new Error("Unable to read the first sheet from the onboarding file.");

  const matrix = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" });
  const headers = Array.isArray(matrix[0]) ? matrix[0].map((value) => String(value ?? "").trim()) : [];
  if (headers.length === 0) throw new Error("The onboarding file has no header row.");

  const mapping = buildMapping(headers);
  const missingColumns = REQUIRED_FIELDS.filter((field) => !mapping[field]);
  const records = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
  const rows = records.map((record, index) => createParsedRecord(record, mapping, index + 2));

  const emailCounts = new Map();
  const rollCounts = new Map();
  for (const row of rows) {
    if (row.email) emailCounts.set(row.email, (emailCounts.get(row.email) ?? 0) + 1);
    if (row.rollNumber) rollCounts.set(row.rollNumber, (rollCounts.get(row.rollNumber) ?? 0) + 1);
  }

  const previewErrors = [];
  for (const row of rows) {
    const issues = [...row.issues];
    if (missingColumns.length > 0) issues.unshift(...missingColumns.map((field) => `Missing required column: ${field}`));
    if (row.email && (emailCounts.get(row.email) ?? 0) > 1) issues.push("Duplicate email in file");
    if (row.rollNumber && (rollCounts.get(row.rollNumber) ?? 0) > 1) issues.push("Duplicate rollNumber in file");
    row.issues = [...new Set(issues)];
    if (row.issues.length > 0) {
      previewErrors.push({ row: row.rowNumber, message: row.issues.join("; "), email: row.email, rollNumber: row.rollNumber });
    }
  }

  return {
    absolutePath,
    sourceFileName: path.basename(absolutePath),
    sourceHash: createHash("sha256").update(buffer).digest("hex"),
    headers,
    mapping,
    rows,
    counts: {
      total: rows.length,
      valid: rows.filter((row) => row.issues.length === 0).length,
      invalid: rows.filter((row) => row.issues.length > 0).length,
    },
    previewErrors,
  };
}

async function resolveTenant(db, tenantSlug) {
  const tenant = await db.collection("tenants").findOne(
    { slug: tenantSlug },
    { projection: { _id: 0, id: 1, slug: 1, name: 1, domain: 1 } },
  );
  if (!tenant) throw new Error(`Tenant '${tenantSlug}' was not found.`);
  return tenant;
}

async function assertNoOtherActiveBatch(db, tenantId, excludeBatchId) {
  const active = await db.collection(ONBOARDING_COLLECTION).findOne(
    {
      tenant_id: tenantId,
      status: { $in: ACTIVE_BATCH_STATUSES },
      ...(excludeBatchId ? { id: { $ne: excludeBatchId } } : {}),
    },
    { projection: { _id: 0, id: 1, status: 1, source_file_name: 1 } },
  );
  if (active) {
    throw new Error(`Tenant already has an active onboarding batch (${active.id}, status=${active.status}) for ${active.source_file_name}.`);
  }
}

function outputPaths(batchId) {
  const dir = ensureOutputDir(batchId);
  return {
    dir,
    summaryPath: path.join(dir, "summary.json"),
    errorsPath: path.join(dir, "errors.csv"),
    manifestPath: path.join(dir, "credentials.enc.json"),
  };
}

function buildProfileData(existingProfileData, row) {
  return {
    ...(existingProfileData ?? {}),
    ...(row.prn ? { prn: row.prn } : {}),
    ...(row.degree ? { degree: row.degree } : {}),
    ...(row.currentSemester ? { currentSemester: row.currentSemester } : {}),
    ...(row.totalHistoricalBacklogs !== "" ? { totalHistoricalBacklogs: Number(row.totalHistoricalBacklogs) } : {}),
  };
}

async function writeArtifacts(batch, parsed, applySummary = { createdUsers: [], updatedUsers: [], failedRows: [] }) {
  const { summaryPath, errorsPath } = outputPaths(batch.id);
  let existingSummary = {};
  try {
    existingSummary = JSON.parse(await readFile(summaryPath, "utf8"));
  } catch {
    existingSummary = {};
  }
  await writeJson(summaryPath, {
    batchId: batch.id,
    status: batch.status,
    tenantSlug: batch.tenant_slug,
    sourceFileName: batch.source_file_name,
    counts: batch.row_counts,
    createdUsers: applySummary.createdUsers?.length ? applySummary.createdUsers : (existingSummary.createdUsers ?? []),
    updatedUsers: applySummary.updatedUsers?.length ? applySummary.updatedUsers : (existingSummary.updatedUsers ?? []),
    failedRows: applySummary.failedRows?.length ? applySummary.failedRows : (existingSummary.failedRows ?? []),
    verification: batch.verification_snapshot ?? existingSummary.verification ?? null,
    emailDispatch: batch.email_summary ?? existingSummary.emailDispatch ?? null,
    preview: batch.preview ?? {
      headers: parsed.headers,
      mapping: parsed.mapping,
    },
  });

  const rows = [...(parsed.previewErrors ?? []), ...(applySummary.failedRows ?? [])];
  const seen = new Set();
  const unique = rows.filter((row) => {
    const key = `${row.row}|${row.message}|${row.email ?? ""}|${row.rollNumber ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const csv = ["row,message,email,roll_number", ...unique.map((row) =>
    [row.row, row.message, row.email ?? "", row.rollNumber ?? ""].map(csvEscape).join(","))].join("\n");
  writeText(errorsPath, `${csv}\n`);
}

async function createPreviewBatch(db, tenant, parsed, options = {}) {
  await assertNoOtherActiveBatch(db, tenant.id);
  const batchId = randomUUID();
  const stamp = nowIso();
  const { summaryPath, errorsPath } = outputPaths(batchId);
  const doc = {
    id: batchId,
    tenant_id: tenant.id,
    tenant_slug: tenant.slug,
    source_file_name: parsed.sourceFileName,
    source_hash: parsed.sourceHash,
    status: "previewed",
    row_counts: { total: parsed.counts.total, valid: parsed.counts.valid, created: 0, updated: 0, skipped: parsed.counts.invalid, failed: 0 },
    created_by: options.createdBy ?? "ops-cli",
    created_at: stamp,
    updated_at: stamp,
    finished_at: null,
    filters: { chunkSize: Number(options.chunkSize ?? 100), resetPasswords: Boolean(options.resetPasswords) },
    errors: parsed.previewErrors.slice(0, 250),
    manifest_path: null,
    summary_path: summaryPath,
    error_report_path: errorsPath,
    verification_snapshot: null,
    email_summary: { queued: 0, sent: 0, failed: 0, recipients: [] },
    preview: {
      headers: parsed.headers,
      mapping: parsed.mapping,
      sample_rows: parsed.rows.slice(0, 5).map((row) => ({
        rowNumber: row.rowNumber,
        fullName: row.fullName,
        email: row.email,
        rollNumber: row.rollNumber,
        branch: row.branch,
        batch: row.batch,
      })),
    },
  };
  await db.collection(ONBOARDING_COLLECTION).insertOne(doc);
  await writeArtifacts(doc, parsed);
  return doc;
}

async function findBatchById(db, tenantId, batchId) {
  const batch = await db.collection(ONBOARDING_COLLECTION).findOne(
    { tenant_id: tenantId, id: batchId },
    { projection: { _id: 0 } },
  );
  if (!batch) throw new Error(`Batch '${batchId}' was not found.`);
  return batch;
}

async function findOrCreateBatchForApply(db, tenant, parsed, options) {
  const latest = await db.collection(ONBOARDING_COLLECTION).findOne(
    { tenant_id: tenant.id, source_hash: parsed.sourceHash },
    { projection: { _id: 0 }, sort: { created_at: -1 } },
  );
  if (!latest) return createPreviewBatch(db, tenant, parsed, options);
  if (!RESUMABLE_BATCH_STATUSES.includes(String(latest.status))) {
    throw new Error(`Batch '${latest.id}' is in status '${latest.status}' and cannot be applied again.`);
  }
  await assertNoOtherActiveBatch(db, tenant.id, latest.id);
  return latest;
}

async function resolveTarget(db, tenantId, row) {
  const users = db.collection("users");
  const students = db.collection("students");

  const emailUser = row.email ? await users.findOne({ email: row.email }, { projection: { _id: 0 } }) : null;
  if (emailUser && String(emailUser.tenant_id) !== tenantId) return { error: "Email already belongs to a different tenant." };
  if (emailUser && String(emailUser.role) !== "student") return { error: "Email is already linked to a non-student account." };

  const emailStudent = emailUser
    ? await students.findOne({ tenant_id: tenantId, user_id: String(emailUser.id) }, { projection: { _id: 0 } })
    : null;
  const rollStudent = row.rollNumber
    ? await students.findOne({ tenant_id: tenantId, roll_number: row.rollNumber }, { projection: { _id: 0 } })
    : null;
  const rollUser = rollStudent
    ? await users.findOne({ id: String(rollStudent.user_id) }, { projection: { _id: 0 } })
    : null;

  if (rollStudent && !rollUser) return { error: "Existing student record is orphaned and has no matching user." };
  if (emailStudent && rollStudent && String(emailStudent.id) !== String(rollStudent.id)) return { error: "Email and roll number point to different student records." };
  if (emailUser && rollUser && String(emailUser.id) !== String(rollUser.id)) return { error: "Email and roll number are linked to different user records." };

  if (emailStudent) return { mode: "update", user: emailUser, student: emailStudent };
  if (rollStudent) return { mode: "update", user: rollUser, student: rollStudent };
  if (emailUser) return { mode: "attach", user: emailUser, student: null };
  return { mode: "create", user: null, student: null };
}

async function upsertRow(db, tenant, row, params) {
  const stamp = nowIso();
  const users = db.collection("users");
  const students = db.collection("students");
  const resolved = await resolveTarget(db, tenant.id, row);
  if (resolved.error) return { kind: "skipped", reason: resolved.error };

  const cgpa = row.cgpa === "" ? 0 : Number(row.cgpa);
  const backlogs = row.backlogs === "" ? 0 : Number(row.backlogs);
  const totalBacklogs = row.totalHistoricalBacklogs === "" ? 0 : Number(row.totalHistoricalBacklogs);
  const attendancePct = row.attendancePct === "" ? 0 : Number(row.attendancePct);

  if (resolved.mode === "create") {
    const userId = randomUUID();
    const studentId = randomUUID();
    const tempPassword = buildTempPassword();
    const passwordHash = await bcryptHash(tempPassword, 10);
    await users.insertOne({
      id: userId,
      tenant_id: tenant.id,
      email: row.email,
      role: "student",
      full_name: row.fullName,
      is_active: true,
      must_change_password: true,
      password_hash: passwordHash,
      password_issued_at: stamp,
      onboarding_batch_id: params.batchId,
      password_version: 1,
      created_at: stamp,
      updated_at: stamp,
    });
    try {
      await students.insertOne({
        id: studentId,
        tenant_id: tenant.id,
        user_id: userId,
        roll_number: row.rollNumber,
        branch: row.branch,
        batch: row.batch,
        cgpa,
        backlogs,
        backlogs_total: totalBacklogs,
        attendance_pct: attendancePct,
        skills: [],
        points: 0,
        streak_current: 0,
        streak_longest: 0,
        readiness_score: 0,
        profile_data: buildProfileData({}, row),
        created_at: stamp,
        updated_at: stamp,
      });
    } catch (error) {
      await users.deleteOne({ id: userId });
      throw error;
    }
    return {
      kind: "created",
      userId,
      studentId,
      recipient: { action: "created", userId, studentId, fullName: row.fullName, email: row.email, rollNumber: row.rollNumber, tempPassword },
    };
  }

  const user = resolved.user;
  const student = resolved.student;
  if (!user) return { kind: "failed", reason: "Resolved student has no user record." };

  const userUpdate = { full_name: row.fullName || user.full_name, email: row.email || user.email, updated_at: stamp };
  let recipient = null;
  if (params.resetPasswords) {
    const tempPassword = buildTempPassword();
    const passwordHash = await bcryptHash(tempPassword, 10);
    await users.updateOne(
      { id: user.id, tenant_id: tenant.id },
      {
        $set: {
          ...userUpdate,
          password_hash: passwordHash,
          must_change_password: true,
          password_issued_at: stamp,
          onboarding_batch_id: params.batchId,
          password_version: Number(user.password_version ?? 0) + 1,
        },
      },
    );
    recipient = { action: "reset", userId: user.id, studentId: student?.id ?? null, fullName: row.fullName, email: row.email, rollNumber: row.rollNumber, tempPassword };
  } else {
    await users.updateOne({ id: user.id, tenant_id: tenant.id }, { $set: userUpdate });
  }

  if (student) {
    await students.updateOne(
      { id: student.id, tenant_id: tenant.id },
      {
        $set: {
          roll_number: row.rollNumber,
          branch: row.branch,
          batch: row.batch,
          cgpa,
          backlogs,
          backlogs_total: totalBacklogs,
          attendance_pct: attendancePct,
          profile_data: buildProfileData(student.profile_data, row),
          updated_at: stamp,
        },
      },
    );
    return { kind: "updated", userId: user.id, studentId: student.id, recipient };
  }

  const newStudentId = randomUUID();
  await students.insertOne({
    id: newStudentId,
    tenant_id: tenant.id,
    user_id: user.id,
    roll_number: row.rollNumber,
    branch: row.branch,
    batch: row.batch,
    cgpa,
    backlogs,
    backlogs_total: totalBacklogs,
    attendance_pct: attendancePct,
    skills: [],
    points: 0,
    streak_current: 0,
    streak_longest: 0,
    readiness_score: 0,
    profile_data: buildProfileData({}, row),
    created_at: stamp,
    updated_at: stamp,
  });
  return { kind: "updated", userId: user.id, studentId: newStudentId, recipient };
}

function buildFailedRow(row, message) {
  return { row: row.rowNumber, message, email: row.email, rollNumber: row.rollNumber };
}

async function refreshBatch(db, tenantId, batchId) {
  return findBatchById(db, tenantId, batchId);
}

export async function previewImport(options) {
  const config = loadOnboardingEnv();
  const { client, db } = await connectMongo(config);
  try {
    const tenant = await resolveTenant(db, options.tenantSlug);
    const parsed = await parseImportFile(options.filePath);
    const batch = await createPreviewBatch(db, tenant, parsed, options);
    return {
      batchId: batch.id,
      tenantSlug: tenant.slug,
      sourceFileName: parsed.sourceFileName,
      counts: batch.row_counts,
      errors: parsed.previewErrors.slice(0, 20),
      outputDir: outputPaths(batch.id).dir,
    };
  } finally {
    await client.close();
  }
}

export async function applyImport(options) {
  const config = loadOnboardingEnv();
  const { client, db } = await connectMongo(config);
  try {
    const tenant = await resolveTenant(db, options.tenantSlug);
    const parsed = await parseImportFile(options.filePath);
    const batch = await findOrCreateBatchForApply(db, tenant, parsed, options);
    const paths = outputPaths(batch.id);
    const state = { created: 0, updated: 0, skipped: 0, failed: 0, createdUsers: [], updatedUsers: [], failedRows: [], manifestRecipients: [] };
    const seenEmails = new Set();
    const seenRolls = new Set();
    const chunkSize = Number(options.chunkSize ?? 100);
    const pauseMs = Number(options.pauseMs ?? 50);

    await db.collection(ONBOARDING_COLLECTION).updateOne(
      { tenant_id: tenant.id, id: batch.id },
      {
        $set: {
          status: "applying",
          updated_at: nowIso(),
          finished_at: null,
          filters: { ...(batch.filters ?? {}), chunkSize, resetPasswords: Boolean(options.resetPasswords) },
          verification_snapshot: null,
          email_summary: { queued: 0, sent: 0, failed: 0, recipients: [] },
          manifest_path: null,
          errors: [],
        },
      },
    );

    for (let index = 0; index < parsed.rows.length; index += 1) {
      const row = parsed.rows[index];
      if (row.email && seenEmails.has(row.email)) {
        state.skipped += 1;
        state.failedRows.push(buildFailedRow(row, "Duplicate email in file"));
      } else if (row.rollNumber && seenRolls.has(row.rollNumber)) {
        state.skipped += 1;
        state.failedRows.push(buildFailedRow(row, "Duplicate rollNumber in file"));
      } else if (row.issues.length > 0) {
        state.skipped += 1;
        state.failedRows.push(buildFailedRow(row, row.issues.join("; ")));
      } else {
        try {
          const result = await upsertRow(db, tenant, row, { batchId: batch.id, resetPasswords: Boolean(options.resetPasswords) });
          if (result.kind === "created") {
            state.created += 1;
            state.createdUsers.push({ row: row.rowNumber, userId: result.userId, studentId: result.studentId, email: row.email, rollNumber: row.rollNumber });
            if (result.recipient) state.manifestRecipients.push(result.recipient);
          } else if (result.kind === "updated") {
            state.updated += 1;
            state.updatedUsers.push({ row: row.rowNumber, userId: result.userId, studentId: result.studentId, email: row.email, rollNumber: row.rollNumber, passwordReset: Boolean(result.recipient) });
            if (result.recipient) state.manifestRecipients.push(result.recipient);
          } else if (result.kind === "skipped") {
            state.skipped += 1;
            state.failedRows.push(buildFailedRow(row, result.reason));
          } else {
            state.failed += 1;
            state.failedRows.push(buildFailedRow(row, result.reason));
          }
        } catch (error) {
          state.failed += 1;
          state.failedRows.push(buildFailedRow(row, error instanceof Error ? error.message : "Upsert failed"));
        }
      }

      if (row.email) seenEmails.add(row.email);
      if (row.rollNumber) seenRolls.add(row.rollNumber);

      const processed = index + 1;
      if (processed % chunkSize === 0 || processed === parsed.rows.length) {
        const stamp = nowIso();
        const interimRecipients = state.manifestRecipients.map((entry) => ({
          email: entry.email,
          userId: entry.userId,
          action: entry.action,
          status: "queued",
          provider: null,
          providerMessageId: null,
          error: null,
          queuedAt: stamp,
          sentAt: null,
        }));
        await db.collection(ONBOARDING_COLLECTION).updateOne(
          { tenant_id: tenant.id, id: batch.id },
          {
            $set: {
              status: state.failed > 0 ? "partial" : "applying",
              updated_at: stamp,
              row_counts: { total: parsed.counts.total, valid: parsed.counts.valid, created: state.created, updated: state.updated, skipped: state.skipped, failed: state.failed },
              errors: state.failedRows.slice(0, 250),
              manifest_path: state.manifestRecipients.length > 0 ? paths.manifestPath : null,
              email_summary: { queued: state.manifestRecipients.length, sent: 0, failed: 0, recipients: interimRecipients },
            },
          },
        );
        await encryptToFile(paths.manifestPath, {
          batchId: batch.id,
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          generatedAt: stamp,
          recipients: state.manifestRecipients,
        }, config.onboardingSecret);
        const refreshed = await refreshBatch(db, tenant.id, batch.id);
        await writeArtifacts(refreshed, parsed, state);
        if (processed < parsed.rows.length) await sleep(pauseMs);
      }
    }

    const finalStamp = nowIso();
    await db.collection(ONBOARDING_COLLECTION).updateOne(
      { tenant_id: tenant.id, id: batch.id },
      {
        $set: {
          status: state.failed > 0 ? "partial" : "applied",
          updated_at: finalStamp,
          finished_at: finalStamp,
          row_counts: { total: parsed.counts.total, valid: parsed.counts.valid, created: state.created, updated: state.updated, skipped: state.skipped, failed: state.failed },
          errors: state.failedRows.slice(0, 250),
          manifest_path: state.manifestRecipients.length > 0 ? paths.manifestPath : null,
        },
      },
    );
    const refreshed = await refreshBatch(db, tenant.id, batch.id);
    await writeArtifacts(refreshed, parsed, state);
    return { batchId: batch.id, status: refreshed.status, counts: refreshed.row_counts, outputDir: paths.dir, manifestPath: refreshed.manifest_path };
  } finally {
    await client.close();
  }
}

export async function verifyImport(options) {
  const config = loadOnboardingEnv();
  const { client, db } = await connectMongo(config);
  try {
    const tenant = await resolveTenant(db, options.tenantSlug);
    const batch = await findBatchById(db, tenant.id, options.batchId);
    if (!["applied", "partial", "verified"].includes(String(batch.status))) {
      throw new Error(`Batch '${batch.id}' must be applied before verification. Current status: ${batch.status}`);
    }

    const manifest = batch.manifest_path
      ? await decryptFromFile(batch.manifest_path, config.onboardingSecret)
      : { recipients: [] };
    const users = db.collection("users");
    const students = db.collection("students");
    const issues = [];
    const counts = batch.row_counts ?? {};

    if (Number(counts.total ?? 0) !== Number(counts.created ?? 0) + Number(counts.updated ?? 0) + Number(counts.skipped ?? 0) + Number(counts.failed ?? 0)) {
      issues.push("Row totals do not balance with created + updated + skipped + failed.");
    }

    const createdRecipients = manifest.recipients.filter((recipient) => recipient.action === "created");
    const createdUserIdsFromManifest = createdRecipients.map((recipient) => String(recipient.userId));
    const createdUsers = createdUserIdsFromManifest.length > 0
      ? await users.find({ tenant_id: tenant.id, id: { $in: createdUserIdsFromManifest } }).project({ _id: 0 }).toArray()
      : [];
    const createdUserIds = createdUsers.map((user) => String(user.id));
    const createdStudents = createdUserIds.length > 0
      ? await students.find({ tenant_id: tenant.id, user_id: { $in: createdUserIds } }).project({ _id: 0 }).toArray()
      : [];

    if (createdUsers.length !== createdRecipients.length) issues.push("Created-user count does not match the credential manifest.");
    if (createdUsers.length !== createdStudents.length) issues.push("Created student count does not match created user count.");

    for (const recipient of manifest.recipients) {
      const user = await users.findOne({ id: recipient.userId, tenant_id: tenant.id }, { projection: { _id: 0 } });
      if (!user) {
        issues.push(`User missing for ${recipient.email}.`);
        continue;
      }
      if (!user.is_active) issues.push(`User ${recipient.email} is inactive.`);
      if (String(user.email).toLowerCase() !== String(recipient.email).toLowerCase()) issues.push(`Email mismatch for ${recipient.email}.`);
      if ((recipient.action === "created" || recipient.action === "reset") && !user.must_change_password) {
        issues.push(`must_change_password missing for ${recipient.email}.`);
      }
    }

    const verificationSnapshot = {
      verifiedAt: nowIso(),
      inputTotal: Number(counts.total ?? 0),
      created: Number(counts.created ?? 0),
      updated: Number(counts.updated ?? 0),
      skipped: Number(counts.skipped ?? 0),
      failed: Number(counts.failed ?? 0),
      manifestRecipients: manifest.recipients.length,
      createdUsersFound: createdUsers.length,
      createdStudentsFound: createdStudents.length,
      issues,
    };
    const status = issues.length === 0 ? "verified" : "failed";
    await db.collection(ONBOARDING_COLLECTION).updateOne(
      { tenant_id: tenant.id, id: batch.id },
      { $set: { status, updated_at: nowIso(), verification_snapshot: verificationSnapshot } },
    );
    const refreshed = await refreshBatch(db, tenant.id, batch.id);
    await writeArtifacts(refreshed, { headers: refreshed.preview?.headers ?? [], mapping: refreshed.preview?.mapping ?? {}, previewErrors: refreshed.errors ?? [] });
    return { batchId: batch.id, status, verification: verificationSnapshot };
  } finally {
    await client.close();
  }
}

export async function sendCredentials(options) {
  const config = loadOnboardingEnv();
  const { client, db } = await connectMongo(config);
  try {
    const tenant = await resolveTenant(db, options.tenantSlug);
    const batch = await findBatchById(db, tenant.id, options.batchId);
    if (!["verified", "partial", "email_sent"].includes(String(batch.status))) {
      throw new Error(`Batch '${batch.id}' must be verified before sending credentials. Current status: ${batch.status}`);
    }

    const manifest = batch.manifest_path
      ? await decryptFromFile(batch.manifest_path, config.onboardingSecret)
      : { recipients: [] };
    const templates = await loadCredentialTemplates();
    const loginUrl = `${String(config.appUrl).replace(/\/+$/, "")}/login`;
    const existing = Array.isArray(batch.email_summary?.recipients) ? batch.email_summary.recipients : [];
    const existingByEmail = new Map(existing.map((entry) => [String(entry.email).toLowerCase(), entry]));
    const recipients = [];
    let sent = 0;
    let failed = 0;
    const { dir } = outputPaths(batch.id);

    await db.collection(ONBOARDING_COLLECTION).updateOne(
      { tenant_id: tenant.id, id: batch.id },
      { $set: { status: "email_queued", updated_at: nowIso() } },
    );

    for (const recipient of manifest.recipients) {
      const prior = existingByEmail.get(String(recipient.email).toLowerCase());
      if (prior?.status === "sent" && !options.forceResend) {
        recipients.push(prior);
        sent += 1;
        continue;
      }
      if (prior?.status === "sent" && options.onlyFailed) {
        recipients.push(prior);
        sent += 1;
        continue;
      }

      const message = buildCredentialMessage(templates, {
        student_name: recipient.fullName,
        login_email: recipient.email,
        temp_password: recipient.tempPassword,
        login_url: loginUrl,
        college_name: tenant.name,
        support_email: config.supportEmail,
      });

      try {
        const delivery = await deliverCredentialEmail(config, {
          batchId: batch.id,
          to: recipient.email,
          subject: message.subject,
          body: message.body,
          outputPath: config.emailMode === "mock"
            ? path.join(dir, `email-${String(recipient.email).replace(/[^a-z0-9]+/gi, "_").toLowerCase()}.json`)
            : null,
        });
        recipients.push({
          email: recipient.email,
          userId: recipient.userId,
          action: recipient.action,
          status: "sent",
          provider: delivery.provider,
          providerMessageId: delivery.providerMessageId,
          error: null,
          queuedAt: prior?.queuedAt ?? nowIso(),
          sentAt: nowIso(),
        });
        sent += 1;
      } catch (error) {
        recipients.push({
          email: recipient.email,
          userId: recipient.userId,
          action: recipient.action,
          status: "failed",
          provider: config.emailMode,
          providerMessageId: null,
          error: error instanceof Error ? error.message : "Email send failed",
          queuedAt: prior?.queuedAt ?? nowIso(),
          sentAt: null,
        });
        failed += 1;
      }
    }

    const status = failed > 0 ? "partial" : "email_sent";
    await db.collection(ONBOARDING_COLLECTION).updateOne(
      { tenant_id: tenant.id, id: batch.id },
      {
        $set: {
          status,
          updated_at: nowIso(),
          email_summary: { queued: manifest.recipients.length, sent, failed, recipients },
        },
      },
    );
    const refreshed = await refreshBatch(db, tenant.id, batch.id);
    await writeArtifacts(refreshed, { headers: refreshed.preview?.headers ?? [], mapping: refreshed.preview?.mapping ?? {}, previewErrors: refreshed.errors ?? [] });
    return { batchId: batch.id, status, emailSummary: refreshed.email_summary };
  } finally {
    await client.close();
  }
}

export async function ensureOutputRoot() {
  await mkdir(OUTPUT_ROOT, { recursive: true });
}
