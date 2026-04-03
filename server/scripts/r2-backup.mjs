import fs from "node:fs";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function resolveEnv(...keys) {
  for (const key of keys) {
    const value = String(process.env[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

export function getR2Config() {
  const accountId = resolveEnv("CLOUDFLARE_R2_ACCOUNT_ID", "R2_ACCOUNT_ID");
  const accessKeyId = resolveEnv("CLOUDFLARE_R2_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID");
  const secretAccessKey = resolveEnv("CLOUDFLARE_R2_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY");
  const bucket = resolveEnv("CLOUDFLARE_R2_BUCKET", "R2_BUCKET", "AWS_S3_BUCKET");
  const prefix = resolveEnv("CLOUDFLARE_R2_BACKUP_PREFIX", "R2_BACKUP_PREFIX") || "backups";

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    prefix: prefix.replace(/^\/+|\/+$/g, ""),
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: "auto",
  };
}

function createR2Client(config) {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function normalizeKeySegment(value) {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function detectContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".gz") return "application/gzip";
  if (ext === ".txt" || ext === ".md") return "text/plain; charset=utf-8";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

export async function uploadFileToR2(params) {
  const config = getR2Config();
  if (!config) {
    throw new Error("Cloudflare R2 backup destination is not configured.");
  }

  const client = createR2Client(config);
  const localPath = path.resolve(params.localPath);
  const key = [config.prefix, normalizeKeySegment(params.key)].filter(Boolean).join("/");

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: fs.createReadStream(localPath),
    ContentType: params.contentType || detectContentType(localPath),
    Metadata: params.metadata ?? undefined,
  }));

  return {
    bucket: config.bucket,
    key,
    endpoint: config.endpoint,
  };
}

async function walkFiles(rootDir, currentDir = rootDir) {
  const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(rootDir, fullPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function uploadDirectoryToR2(params) {
  const rootDir = path.resolve(params.localDir);
  const files = await walkFiles(rootDir);
  const uploaded = [];

  for (const filePath of files) {
    const relativePath = path.relative(rootDir, filePath).replace(/\\/g, "/");
    uploaded.push(await uploadFileToR2({
      localPath: filePath,
      key: [normalizeKeySegment(params.keyPrefix), normalizeKeySegment(relativePath)].filter(Boolean).join("/"),
    }));
  }

  return uploaded;
}
