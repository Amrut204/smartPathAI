import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { MongoClient } from "mongodb";

const gzipAsync = promisify(gzip);

const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";
const BACKUP_DIR = path.join(process.cwd(), "backups");
const DEMO_EMAIL_DOMAIN = "stxaviers-demo.edu";
const DEMO_EMAIL_PATTERN = new RegExp(`@${DEMO_EMAIL_DOMAIN.replace(".", "\\.")}$`, "i");
const DEMO_TENANT_NAME = "St. Xavier's Institute of Technology";
const ACCEPTED_DEMO_SLUGS = ["st-xaviers-demo", "stxaviers-demo"];

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

function timestampLabel() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function ensureBackupDir() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

async function getDemoTenants(db) {
  return db.collection("tenants").find(
    {
      $or: [
        { slug: { $in: ACCEPTED_DEMO_SLUGS } },
        { domain: DEMO_EMAIL_DOMAIN },
        { name: DEMO_TENANT_NAME },
      ],
    },
    { projection: { _id: 0 } },
  ).toArray();
}

async function getDemoUsers(db, tenantIds) {
  return db.collection("users").find(
    {
      $or: [
        { email: DEMO_EMAIL_PATTERN },
        ...(tenantIds.length > 0 ? [{ tenant_id: { $in: tenantIds } }] : []),
      ],
    },
    { projection: { _id: 0 } },
  ).toArray();
}

async function collectTenantData(db, tenantIds) {
  const collections = {};
  const counts = {};

  for (const collection of TENANT_SCOPED_COLLECTIONS) {
    const docs = await db.collection(collection).find(
      { tenant_id: { $in: tenantIds } },
      { projection: { _id: 0 } },
    ).toArray();
    collections[collection] = docs;
    counts[collection] = docs.length;
  }

  return { collections, counts };
}

async function cleanupOldBackups() {
  const files = await fs.readdir(BACKUP_DIR);
  const backupFiles = await Promise.all(
    files
      .filter((file) => file.startsWith("demo-backup-") && (file.endsWith(".json.gz") || file.endsWith(".json")))
      .map(async (file) => ({
        file,
        path: path.join(BACKUP_DIR, file),
        stat: await fs.stat(path.join(BACKUP_DIR, file)),
      })),
  );

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const recentBackups = backupFiles.filter((entry) => now - entry.stat.mtimeMs <= sevenDaysMs);
  const oldBackups = backupFiles.filter((entry) => now - entry.stat.mtimeMs > sevenDaysMs);

  for (const entry of oldBackups) {
    await fs.unlink(entry.path);
    console.log(`Deleted old backup: ${entry.file}`);
  }

  recentBackups.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  const excess = recentBackups.slice(5);
  for (const entry of excess) {
    await fs.unlink(entry.path);
    console.log(`Deleted excess backup: ${entry.file}`);
  }
}

async function runBackup() {
  const client = new MongoClient(MONGO_URI);

  try {
    await ensureBackupDir();
    await client.connect();
    const db = client.db(DB_NAME);

    console.log("Starting demo backup...");
    const tenants = await getDemoTenants(db);
    if (tenants.length === 0) {
      throw new Error("Demo tenant not found. Seed demo data before backing up.");
    }

    const tenantIds = tenants.map((tenant) => String(tenant.id));
    const users = await getDemoUsers(db, tenantIds);

    const { collections, counts } = await collectTenantData(db, tenantIds);
    const payload = {
      meta: {
        version: 1,
        createdAt: new Date().toISOString(),
        tenantIds,
        tenantSlugs: tenants.map((tenant) => tenant.slug).filter(Boolean),
        counts: {
          tenants: tenants.length,
          users: users.length,
          collections: counts,
        },
      },
      data: {
        tenants,
        users,
        collections,
      },
    };

    const jsonBuffer = Buffer.from(JSON.stringify(payload), "utf8");
    const gzipBuffer = await gzipAsync(jsonBuffer);

    const filenameBase = `demo-backup-${timestampLabel()}.json`;
    const targetPath = path.join(BACKUP_DIR, `${filenameBase}.gz`);
    await fs.writeFile(targetPath, gzipBuffer);

    console.log(`Backup saved: ${targetPath}`);
    console.log(`Backup size: ${(gzipBuffer.length / 1024).toFixed(1)} KB (compressed)`);

    await cleanupOldBackups();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Backup failed: ${message}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

await runBackup();
