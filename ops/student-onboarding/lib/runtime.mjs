import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const requireFromServer = createRequire(new URL("../../../server/package.json", import.meta.url));
export const { MongoClient } = requireFromServer("mongodb");
export const { hash: bcryptHash } = requireFromServer("bcryptjs");
export const XLSX = requireFromServer("xlsx");

export const ONBOARDING_COLLECTION = "student_onboarding_batches";
export const OUTPUT_ROOT = path.resolve(process.cwd(), "ops/student-onboarding/output");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  const output = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex < 0) continue;
    const key = trimmed.slice(0, equalIndex).trim();
    const rawValue = trimmed.slice(equalIndex + 1).trim();
    output[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
  return output;
}

export function loadOnboardingEnv() {
  const serverEnv = parseEnvFile(path.resolve(process.cwd(), "server/.env"));
  const rootEnv = parseEnvFile(path.resolve(process.cwd(), ".env"));
  const merged = { ...rootEnv, ...serverEnv, ...process.env };

  const config = {
    mongoUri: merged.MONGODB_URI,
    mongoDbName: merged.MONGODB_DB_NAME || "campusdrive_dev",
    emailMode: String(merged.EMAIL_MODE || "mock").trim().toLowerCase(),
    sendGridApiKey: merged.SENDGRID_API_KEY || "",
    sendGridFromEmail: merged.SENDGRID_FROM_EMAIL || "noreply@campusdrive.ai",
    resendApiKey: merged.RESEND_API_KEY || "",
    resendFromEmail: merged.RESEND_FROM_EMAIL || merged.SENDGRID_FROM_EMAIL || "onboarding@resend.dev",
    appUrl: merged.APP_URL || "http://localhost:5173",
    supportEmail: merged.SUPPORT_EMAIL || merged.SENDGRID_FROM_EMAIL || "support@campusdrive.ai",
    onboardingSecret: merged.STUDENT_ONBOARDING_SECRET || merged.APP_JWT_SECRET || "",
  };

  if (!config.mongoUri) {
    throw new Error("Missing MONGODB_URI for student onboarding.");
  }
  if (!config.onboardingSecret) {
    throw new Error("Missing STUDENT_ONBOARDING_SECRET (or APP_JWT_SECRET fallback) for credential manifest encryption.");
  }

  return config;
}

export async function connectMongo(config) {
  const client = new MongoClient(config.mongoUri);
  await client.connect();
  return {
    client,
    db: client.db(config.mongoDbName),
  };
}

export function ensureOutputDir(batchId) {
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  const dir = path.join(OUTPUT_ROOT, batchId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function deriveKey(secret) {
  return createHash("sha256").update(String(secret)).digest();
}

export async function encryptToFile(filePath, value, secret) {
  const iv = randomBytes(12);
  const key = deriveKey(secret);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = {
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
  await writeJson(filePath, payload);
}

export async function decryptFromFile(filePath, secret) {
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  const key = deriveKey(secret);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(String(raw.iv), "hex"));
  decipher.setAuthTag(Buffer.from(String(raw.authTag), "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(String(raw.ciphertext), "hex")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

export function nowIso() {
  return new Date().toISOString();
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

export function renderTemplate(value, variables) {
  return String(value).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => variables[key] ?? "");
}

export function csvEscape(value) {
  const raw = String(value ?? "");
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, "\"\"")}"`;
  }
  return raw;
}

export function writeText(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, "utf8");
}
