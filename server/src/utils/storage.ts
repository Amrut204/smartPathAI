import { existsSync } from "node:fs";
import path from "node:path";

function normalizeRelativePath(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^material\//i, "")
    .replace(/^\/+/g, "");
}

export function resolveMaterialRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), "../material"),
    path.resolve(process.cwd(), "material"),
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  return found ?? candidates[0];
}

export function buildLocalMaterialUrl(relativePath: string | null | undefined): string {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return "";
  return `material/${normalized}`;
}

export function buildLocalResourceFileUrl(relativePath: string | null | undefined): string {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return "";
  return `/api/v1/resources/file?path=${encodeURIComponent(normalized)}`;
}

export function resolveCloudPublicUrl(asset: Record<string, unknown> | null | undefined): string {
  const value = String(asset?.public_url ?? "").trim();
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return "";
}

export function resolveManagedCloudBaseUrl(): string {
  return String(process.env.STORAGE_S3_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

export function isManagedCloudUrl(url: string | null | undefined): boolean {
  const value = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(value)) {
    return false;
  }

  const managedBase = resolveManagedCloudBaseUrl();
  if (managedBase && value.startsWith(`${managedBase}/`)) {
    return true;
  }

  const bucket = String(process.env.AWS_S3_BUCKET ?? "").trim();
  const region = String(process.env.AWS_REGION ?? "us-east-1").trim() || "us-east-1";
  if (!bucket) return false;

  const bucketBase = `https://${bucket}.s3.${region}.amazonaws.com/`;
  return value.startsWith(bucketBase);
}

export function resolveStorageMode(asset: Record<string, unknown> | null | undefined): "local" | "cloud" {
  const provider = String(asset?.storage_provider ?? "").trim().toLowerCase();
  const publicUrl = resolveCloudPublicUrl(asset);
  if (provider && provider !== "local" && publicUrl) {
    return "cloud";
  }
  return "local";
}

export function resolveLocalStorageKey(input: {
  asset?: Record<string, unknown> | null;
  sourcePdf?: string | null;
  fallbackUrl?: string | null;
}) {
  const asset = input.asset ?? null;
  const candidates = [
    asset?.source_path ? String(asset.source_path) : "",
    asset?.cloud_source_path ? String(asset.cloud_source_path) : "",
    asset?.storage_key ? String(asset.storage_key) : "",
    input.sourcePdf ? String(input.sourcePdf) : "",
    input.fallbackUrl ? String(input.fallbackUrl) : "",
  ];

  for (const candidate of candidates) {
    const normalized = normalizeRelativePath(candidate);
    if (normalized && !/^https?:\/\//i.test(candidate)) {
      return normalized;
    }
  }

  return "";
}
