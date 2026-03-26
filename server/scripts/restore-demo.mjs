import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { MongoClient } from "mongodb";

const gunzipAsync = promisify(gunzip);

const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";
const BACKUP_DIR = path.join(process.cwd(), "backups");
const DEMO_EMAIL_DOMAIN = "stxaviers-demo.edu";
const DEMO_EMAIL_PATTERN = new RegExp(`@${DEMO_EMAIL_DOMAIN.replace(".", "\\.")}$`, "i");
const DEMO_TENANT_NAME = "St. Xavier's Institute of Technology";
const ACCEPTED_DEMO_SLUGS = ["st-xaviers-demo", "stxaviers-demo"];
const HEALTH_PATH = "/api/health/demo";
const DEMO_LOGIN_PATH = "/api/v1/demo/auto-login-tpo";
const HEALTH_PROBE_PATH = path.join(process.cwd(), ".tmp-restore-health.ts");

const TENANT_SCOPED_COLLECTIONS = [
  "students",
  "mock_tests",
  "student_attempts",
  "drives",
  "drive_results",
  "drive_eligibility_snapshots",
  "study_hours",
  "topic_mastery",
  "student_topic_progress",
  "resources",
  "resource_view_events",
  "email_templates",
  "communications",
  "tenant_analytics",
  "student_activity_events",
  "companies",
  "interview_sessions",
  "interview_feedback",
  "coding_sessions",
  "coding_challenges",
  "calendar_events",
  "campaigns",
  "recruiters",
  "billing_accounts",
  "billing_invoices",
  "wallet_transactions",
  "wallet_accounts",
  "mentorship_sessions",
  "mentorship_requests",
  "ai_conversations",
  "ai_messages",
  "career_goals",
  "resume_reviews",
  "communication_audits",
  "communication_deliveries",
];

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function findLatestBackup() {
  const files = await fs.readdir(BACKUP_DIR);
  const candidates = await Promise.all(
    files
      .filter((file) => file.startsWith("demo-backup-") && (file.endsWith(".json.gz") || file.endsWith(".json")))
      .map(async (file) => ({
        file,
        path: path.join(BACKUP_DIR, file),
        stat: await fs.stat(path.join(BACKUP_DIR, file)),
      })),
  );

  candidates.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return candidates[0]?.path ?? null;
}

async function readBackupFile(filePath) {
  const raw = await fs.readFile(filePath);
  const buffer = filePath.endsWith(".gz") ? await gunzipAsync(raw) : raw;
  const json = JSON.parse(buffer.toString("utf8"));
  return json;
}

async function getExistingDemoContext(db) {
  const tenant = await db.collection("tenants").findOne(
    {
      $or: [
        { slug: { $in: ACCEPTED_DEMO_SLUGS } },
        { domain: DEMO_EMAIL_DOMAIN },
        { name: DEMO_TENANT_NAME },
      ],
    },
    { projection: { _id: 0, id: 1, slug: 1 } },
  );

  const demoUsers = await db.collection("users").find(
    { email: DEMO_EMAIL_PATTERN },
    { projection: { _id: 0, id: 1, tenant_id: 1 } },
  ).toArray();

  const tenantIds = new Set();
  if (tenant?.id) tenantIds.add(String(tenant.id));
  demoUsers.forEach((user) => {
    if (user?.tenant_id) tenantIds.add(String(user.tenant_id));
  });

  return { tenantIds: [...tenantIds] };
}

async function resetDemoData(db) {
  console.log("Resetting existing demo data...");
  const existingContext = await getExistingDemoContext(db);
  const tenantIds = existingContext.tenantIds;

  for (const collection of TENANT_SCOPED_COLLECTIONS) {
    if (tenantIds.length === 0) break;
    await db.collection(collection).deleteMany({ tenant_id: { $in: tenantIds } });
  }

  await db.collection("users").deleteMany({
    $or: [
      { email: DEMO_EMAIL_PATTERN },
      ...(tenantIds.length > 0 ? [{ tenant_id: { $in: tenantIds } }] : []),
    ],
  });

  if (tenantIds.length > 0) {
    await db.collection("students").deleteMany({ tenant_id: { $in: tenantIds } });
    await db.collection("tenants").deleteMany({ id: { $in: tenantIds } });
  }

  await db.collection("tenants").deleteMany({
    $or: [
      { slug: { $in: ACCEPTED_DEMO_SLUGS } },
      { domain: DEMO_EMAIL_DOMAIN },
      { name: DEMO_TENANT_NAME },
    ],
  });
}

async function insertDocuments(db, collection, docs) {
  if (!Array.isArray(docs) || docs.length === 0) return;
  await db.collection(collection).insertMany(docs, { ordered: false });
}

async function verifyCounts(db, backup) {
  const tenantIds = backup.meta?.tenantIds ?? backup.data?.tenants?.map((tenant) => String(tenant.id)) ?? [];
  const failures = [];

  const tenantCount = await db.collection("tenants").countDocuments({ id: { $in: tenantIds } });
  if (tenantCount !== backup.meta.counts.tenants) {
    failures.push(`Tenants count mismatch (expected ${backup.meta.counts.tenants}, got ${tenantCount})`);
  }

  const userCount = await db.collection("users").countDocuments({
    $or: [
      { email: DEMO_EMAIL_PATTERN },
      ...(tenantIds.length > 0 ? [{ tenant_id: { $in: tenantIds } }] : []),
    ],
  });
  if (userCount !== backup.meta.counts.users) {
    failures.push(`Users count mismatch (expected ${backup.meta.counts.users}, got ${userCount})`);
  }

  const collectionCounts = backup.meta.counts.collections ?? {};
  for (const [collection, expected] of Object.entries(collectionCounts)) {
    const actual = await db.collection(collection).countDocuments({ tenant_id: { $in: tenantIds } });
    if (actual !== expected) {
      failures.push(`${collection} count mismatch (expected ${expected}, got ${actual})`);
    }
  }

  return failures;
}

async function runHealthProbe() {
  await fs.writeFile(
    HEALTH_PROBE_PATH,
    `import request from "supertest";
import app from "./src/app.ts";

const health = await request(app).get("${HEALTH_PATH}");
const login = await request(app).get("${DEMO_LOGIN_PATH}");
console.log(JSON.stringify({
  health: { status: health.status, body: health.body },
  login: { status: login.status, cookies: login.headers["set-cookie"] ?? [] }
}));`,
    "utf8",
  );

  const result = await runCommand(
    npxCommand(),
    ["tsx", HEALTH_PROBE_PATH],
    { env: { NODE_ENV: "test" } },
  );

  try {
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "Health probe process failed");
    }
    const jsonLine = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("{") && line.endsWith("}"));
    if (!jsonLine) {
      throw new Error("Health probe did not return JSON");
    }
    const parsed = JSON.parse(jsonLine);
    return { result, parsed };
  } finally {
    try {
      await fs.unlink(HEALTH_PROBE_PATH);
    } catch {
      // ignore
    }
  }
}

async function restore() {
  const inputArg = process.argv.find((arg) => {
    if (arg.startsWith("--")) return false;
    return arg.endsWith(".json") || arg.endsWith(".json.gz");
  });
  const backupPath = inputArg || await findLatestBackup();

  if (!backupPath) {
    console.error("No backup file found. Provide a backup path or create one with npm run backup:demo.");
    process.exitCode = 1;
    return;
  }

  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);

    console.log(`Restoring demo data from ${backupPath}`);
    const backup = await readBackupFile(backupPath);

    if (!backup?.data?.tenants || !backup?.data?.users || !backup?.data?.collections || !backup?.meta?.counts) {
      throw new Error("Backup file is missing required data sections.");
    }

    await resetDemoData(db);

    await insertDocuments(db, "tenants", backup.data.tenants);
    await insertDocuments(db, "users", backup.data.users);

    for (const [collection, docs] of Object.entries(backup.data.collections)) {
      await insertDocuments(db, collection, docs);
    }

    const countFailures = await verifyCounts(db, backup);
    if (countFailures.length > 0) {
      countFailures.forEach((failure) => console.error(failure));
      throw new Error("Restored counts do not match backup.");
    }

    const { parsed } = await runHealthProbe();
    const healthOk = parsed.health?.status >= 200 && parsed.health?.status < 300 && parsed.health?.body?.status === "healthy";
    const loginOk = parsed.login?.status === 302 && Array.isArray(parsed.login?.cookies) && parsed.login.cookies.length > 0;

    if (!healthOk) {
      throw new Error("Health check failed after restore.");
    }
    if (!loginOk) {
      throw new Error("Demo login failed after restore.");
    }

    console.log("Restore complete. Health check and demo login verified.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Restore failed: ${message}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

await restore();
