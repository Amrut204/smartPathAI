import { getMongoDb } from "../utils/mongodb.js";

export type MongoStorageGuardLevel = "ok" | "warning" | "blocked";

export interface MongoStorageGuardConfig {
  enabled: boolean;
  limitBytes: number;
  warningPct: number;
  cacheTtlMs: number;
}

export interface MongoStorageGuardStatus {
  enabled: boolean;
  databaseName: string;
  checkedAt: string;
  level: MongoStorageGuardLevel;
  limitBytes: number;
  usedBytes: number;
  remainingBytes: number;
  percentUsed: number;
  warningAtBytes: number;
  measuredBy: "totalSize" | "storagePlusIndexes" | "dataPlusIndexes" | "dataSize";
  displayUsed: string;
  displayLimit: string;
  displayRemaining: string;
  message: string | null;
}

interface CachedStatus {
  expiresAt: number;
  status: MongoStorageGuardStatus;
}

let cachedStatus: CachedStatus | null = null;

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return !["0", "false", "no", "off"].includes(normalized);
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveConfig(): MongoStorageGuardConfig {
  const enabled = parseBooleanEnv(process.env.MONGO_STORAGE_GUARD_ENABLED, true);
  const limitGb = parsePositiveNumber(process.env.MONGO_STORAGE_LIMIT_GB, 4.5);
  const warningPct = Math.min(0.99, Math.max(0.5, parsePositiveNumber(process.env.MONGO_STORAGE_WARNING_PCT, 0.9)));
  const cacheTtlMs = Math.max(1_000, Math.floor(parsePositiveNumber(process.env.MONGO_STORAGE_CHECK_TTL_MS, 30_000)));

  return {
    enabled,
    limitBytes: Math.floor(limitGb * 1024 * 1024 * 1024),
    warningPct,
    cacheTtlMs,
  };
}

function formatBytes(bytes: number): string {
  const absolute = Math.max(0, bytes);
  if (absolute >= 1024 * 1024 * 1024) {
    return `${(absolute / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (absolute >= 1024 * 1024) {
    return `${(absolute / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (absolute >= 1024) {
    return `${(absolute / 1024).toFixed(2)} KB`;
  }
  return `${absolute} B`;
}

function resolveUsedBytes(stats: Record<string, unknown>) {
  const totalSize = Number(stats.totalSize ?? NaN);
  if (Number.isFinite(totalSize) && totalSize >= 0) {
    return { usedBytes: Math.floor(totalSize), measuredBy: "totalSize" } as const;
  }

  const storageSize = Number(stats.storageSize ?? NaN);
  const indexSize = Number(stats.indexSize ?? NaN);
  if (Number.isFinite(storageSize) && storageSize >= 0 && Number.isFinite(indexSize) && indexSize >= 0) {
    return { usedBytes: Math.floor(storageSize + indexSize), measuredBy: "storagePlusIndexes" } as const;
  }

  const dataSize = Number(stats.dataSize ?? NaN);
  if (Number.isFinite(dataSize) && dataSize >= 0 && Number.isFinite(indexSize) && indexSize >= 0) {
    return { usedBytes: Math.floor(dataSize + indexSize), measuredBy: "dataPlusIndexes" } as const;
  }

  return { usedBytes: Math.max(0, Math.floor(Number.isFinite(dataSize) ? dataSize : 0)), measuredBy: "dataSize" } as const;
}

function buildStatus(input: {
  databaseName: string;
  checkedAt: string;
  usedBytes: number;
  measuredBy: MongoStorageGuardStatus["measuredBy"];
  config: MongoStorageGuardConfig;
}): MongoStorageGuardStatus {
  const warningAtBytes = Math.floor(input.config.limitBytes * input.config.warningPct);
  const remainingBytes = Math.max(0, input.config.limitBytes - input.usedBytes);
  const percentUsed = input.config.limitBytes > 0
    ? Number(((input.usedBytes / input.config.limitBytes) * 100).toFixed(2))
    : 0;

  const level: MongoStorageGuardLevel = !input.config.enabled
    ? "ok"
    : input.usedBytes >= input.config.limitBytes
      ? "blocked"
      : input.usedBytes >= warningAtBytes
        ? "warning"
        : "ok";

  let message: string | null = null;
  if (level === "blocked") {
    message = "New Atlas writes are paused because the database storage safety cap has been reached. Delete old data or raise the configured limit before adding more.";
  } else if (level === "warning") {
    message = "Atlas storage is close to the configured safety cap. New writes may be paused soon to avoid extra cluster storage usage.";
  }

  return {
    enabled: input.config.enabled,
    databaseName: input.databaseName,
    checkedAt: input.checkedAt,
    level,
    limitBytes: input.config.limitBytes,
    usedBytes: input.usedBytes,
    remainingBytes,
    percentUsed,
    warningAtBytes,
    measuredBy: input.measuredBy,
    displayUsed: formatBytes(input.usedBytes),
    displayLimit: formatBytes(input.config.limitBytes),
    displayRemaining: formatBytes(remainingBytes),
    message,
  };
}

export class MongoStorageGuardService {
  static getConfig(): MongoStorageGuardConfig {
    return resolveConfig();
  }

  static clearCache(): void {
    cachedStatus = null;
  }

  static async getStatus(options?: { forceRefresh?: boolean }): Promise<MongoStorageGuardStatus> {
    const config = resolveConfig();
    const now = Date.now();
    if (!options?.forceRefresh && cachedStatus && cachedStatus.expiresAt > now) {
      return cachedStatus.status;
    }

    const db = await getMongoDb();
    const rawStats = await db.command({ dbStats: 1, scale: 1 });
    const { usedBytes, measuredBy } = resolveUsedBytes(rawStats as Record<string, unknown>);
    const status = buildStatus({
      databaseName: db.databaseName,
      checkedAt: new Date().toISOString(),
      usedBytes,
      measuredBy,
      config,
    });

    cachedStatus = {
      expiresAt: now + config.cacheTtlMs,
      status,
    };

    return status;
  }
}
