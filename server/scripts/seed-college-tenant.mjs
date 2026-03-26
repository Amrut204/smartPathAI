import "dotenv/config";
import { randomUUID } from "node:crypto";

import { hash } from "bcryptjs";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";

function parseFlag(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function normalizeSlug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function nowIso() {
  return new Date().toISOString();
}

async function main() {
  const tenantName = parseFlag("name");
  const tpoEmail = parseFlag("tpo-email").trim().toLowerCase();
  const tpoName = parseFlag("tpo-name", "Training And Placement Officer");
  const tenantSlug = normalizeSlug(parseFlag("slug", tenantName));
  const tenantDomain = parseFlag("domain", `${tenantSlug}.local`);
  const seedPassword = parseFlag("password", "Demo@123");
  const subscriptionTier = parseFlag("tier", "pilot");

  if (!tenantName) {
    throw new Error("--name is required.");
  }

  if (!tpoEmail) {
    throw new Error("--tpo-email is required.");
  }

  if (!tenantSlug) {
    throw new Error("Unable to derive a tenant slug. Pass --slug explicitly.");
  }

  const client = new MongoClient(MONGO_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);
    const existingTenant = await db.collection("tenants").findOne(
      {
        $or: [
          { slug: tenantSlug },
          { name: tenantName },
        ],
      },
      { projection: { _id: 0, id: 1, name: 1, slug: 1 } },
    );

    if (existingTenant) {
      console.log(JSON.stringify({
        ok: true,
        created: false,
        reason: "tenant_exists",
        tenant: {
          id: String(existingTenant.id ?? ""),
          name: String(existingTenant.name ?? ""),
          slug: String(existingTenant.slug ?? ""),
        },
      }, null, 2));
      return;
    }

    const existingUser = await db.collection("users").findOne(
      { email: tpoEmail },
      { projection: { _id: 0, id: 1, tenant_id: 1, role: 1, email: 1 } },
    );

    if (existingUser) {
      throw new Error(`A user with email ${tpoEmail} already exists.`);
    }

    const now = nowIso();
    const tenantId = randomUUID();
    const tpoUserId = randomUUID();
    const passwordHash = await hash(seedPassword, 10);
    const collegeShortName = tenantName.replace(/^school of /i, "").trim();

    await db.collection("tenants").insertOne({
      id: tenantId,
      name: tenantName,
      slug: tenantSlug,
      domain: tenantDomain,
      subscription_tier: subscriptionTier,
      is_active: true,
      config: {
        mode: "pilot",
        maxStudents: 5000,
        emailSettings: {
          fromName: `${collegeShortName} Placement Cell`,
          replyToEmail: tpoEmail,
        },
      },
      created_at: now,
      updated_at: now,
    });

    await db.collection("users").insertOne({
      id: tpoUserId,
      tenant_id: tenantId,
      email: tpoEmail,
      role: "tpo",
      full_name: tpoName,
      is_active: true,
      password_hash: passwordHash,
      must_change_password: true,
      password_issued_at: now,
      password_version: 1,
      created_at: now,
      updated_at: now,
    });

    console.log(JSON.stringify({
      ok: true,
      created: true,
      tenant: {
        id: tenantId,
        name: tenantName,
        slug: tenantSlug,
        domain: tenantDomain,
      },
      tpo: {
        id: tpoUserId,
        email: tpoEmail,
        fullName: tpoName,
      },
      temporaryPassword: seedPassword,
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
