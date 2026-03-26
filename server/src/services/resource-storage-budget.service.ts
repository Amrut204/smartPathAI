import { getMongoDb } from "../utils/mongodb.js";

type BudgetLevel = "ok" | "warning" | "blocked";

interface UsageCounterDocument {
  _id: string;
  period_key: string;
  request_count: number;
  transfer_bytes: number;
  created_at: string;
  updated_at: string;
}

interface ReservationResult {
  status: ResourceStorageBudgetStatus;
  rollback: () => Promise<void>;
  commit: (transferredBytes: number) => Promise<ResourceStorageBudgetStatus>;
}

export interface ResourceStorageBudgetConfig {
  enabled: boolean;
  requestLimit: number;
  requestWarningPct: number;
  transferLimitBytes: number;
  transferWarningPct: number;
}

export interface ResourceStorageBudgetMetric {
  used: number;
  limit: number;
  remaining: number;
  warningAt: number;
  percentUsed: number;
  status: BudgetLevel;
  displayUsed: string;
  displayLimit: string;
  displayRemaining: string;
}

export interface ResourceStorageBudgetStatus {
  enabled: boolean;
  periodKey: string;
  overallStatus: BudgetLevel;
  requests: ResourceStorageBudgetMetric;
  transfer: ResourceStorageBudgetMetric;
  appliesTo: "cloud_resources";
  message: string | null;
}

export interface ResourceStorageBudgetHistoryItem {
  periodKey: string;
  requestCount: number;
  transferBytes: number;
  transferDisplay: string;
  status: BudgetLevel;
}

export interface ResourceStorageBudgetDashboard {
  status: ResourceStorageBudgetStatus;
  config: ResourceStorageBudgetConfig & {
    transferLimitDisplay: string;
  };
  history: ResourceStorageBudgetHistoryItem[];
}

const COLLECTION_NAME = "resource_storage_usage";
const STATUS_CACHE_TTL_MS = 15_000;
const DASHBOARD_CACHE_TTL_MS = 15_000;
let statusCache: { expiresAt: number; value: ResourceStorageBudgetStatus } | null = null;
let dashboardCache: { expiresAt: number; value: ResourceStorageBudgetDashboard } | null = null;

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

function resolveBudgetConfig(): ResourceStorageBudgetConfig {
  const enabled = parseBooleanEnv(process.env.RESOURCE_S3_BUDGET_ENABLED, true);
  const requestLimit = Math.max(1, Math.floor(parsePositiveNumber(process.env.RESOURCE_S3_READ_LIMIT_MONTHLY, 20_000)));
  const requestWarningPct = Math.min(0.99, Math.max(0.5, parsePositiveNumber(process.env.RESOURCE_S3_READ_WARNING_PCT, 0.95)));
  const transferLimitGb = parsePositiveNumber(process.env.RESOURCE_S3_TRANSFER_LIMIT_GB_MONTHLY, 100);
  const transferWarningPct = Math.min(0.99, Math.max(0.5, parsePositiveNumber(process.env.RESOURCE_S3_TRANSFER_WARNING_PCT, 0.95)));

  return {
    enabled,
    requestLimit,
    requestWarningPct,
    transferLimitBytes: Math.max(1, Math.floor(transferLimitGb * 1024 * 1024 * 1024)),
    transferWarningPct,
  };
}

function getCurrentPeriodKey(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getDocumentId(periodKey: string): string {
  return `cloud_resources:${periodKey}`;
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

function buildMetric(input: {
  used: number;
  limit: number;
  warningPct: number;
  formatter?: (value: number) => string;
}): ResourceStorageBudgetMetric {
  const used = Math.max(0, Math.floor(input.used));
  const limit = Math.max(1, Math.floor(input.limit));
  const warningAt = Math.max(1, Math.floor(limit * input.warningPct));
  const remaining = Math.max(0, limit - used);
  const percentUsed = Number(((used / limit) * 100).toFixed(2));
  const status: BudgetLevel =
    used >= limit ? "blocked" : used >= warningAt ? "warning" : "ok";

  const formatter = input.formatter ?? ((value: number) => String(value));

  return {
    used,
    limit,
    remaining,
    warningAt,
    percentUsed,
    status,
    displayUsed: formatter(used),
    displayLimit: formatter(limit),
    displayRemaining: formatter(remaining),
  };
}

function buildStatusFromUsage(doc: UsageCounterDocument | null): ResourceStorageBudgetStatus {
  const config = resolveBudgetConfig();
  const periodKey = getCurrentPeriodKey();
  if (!config.enabled) {
    const requests = buildMetric({ used: 0, limit: config.requestLimit, warningPct: config.requestWarningPct });
    const transfer = buildMetric({
      used: 0,
      limit: config.transferLimitBytes,
      warningPct: config.transferWarningPct,
      formatter: formatBytes,
    });
    return {
      enabled: false,
      periodKey,
      overallStatus: "ok",
      requests,
      transfer,
      appliesTo: "cloud_resources",
      message: null,
    };
  }

  const requests = buildMetric({
    used: Number(doc?.request_count ?? 0),
    limit: config.requestLimit,
    warningPct: config.requestWarningPct,
  });
  const transfer = buildMetric({
    used: Number(doc?.transfer_bytes ?? 0),
    limit: config.transferLimitBytes,
    warningPct: config.transferWarningPct,
    formatter: formatBytes,
  });

  const overallStatus: BudgetLevel =
    requests.status === "blocked" || transfer.status === "blocked"
      ? "blocked"
      : requests.status === "warning" || transfer.status === "warning"
        ? "warning"
        : "ok";

  let message: string | null = null;
  if (overallStatus === "blocked") {
    message = "Cloud resource access is temporarily paused because this month's AWS safety cap has been reached. Please try again next month or raise the configured budget limits.";
  } else if (overallStatus === "warning") {
    message = "Cloud resource usage is close to this month's AWS safety cap. New PDF opens may be paused soon to prevent extra charges.";
  }

  return {
    enabled: true,
    periodKey,
    overallStatus,
    requests,
    transfer,
    appliesTo: "cloud_resources",
    message,
  };
}

async function readUsageDocument(periodKey: string): Promise<UsageCounterDocument | null> {
  const db = await getMongoDb();
  return db.collection<UsageCounterDocument>(COLLECTION_NAME).findOne({ _id: getDocumentId(periodKey) });
}

export class ResourceStorageBudgetService {
  private static clearCaches() {
    statusCache = null;
    dashboardCache = null;
  }

  static getConfig(): ResourceStorageBudgetConfig {
    return resolveBudgetConfig();
  }

  static async getStatus(): Promise<ResourceStorageBudgetStatus> {
    if (statusCache && statusCache.expiresAt > Date.now()) {
      return statusCache.value;
    }

    const periodKey = getCurrentPeriodKey();
    const doc = await readUsageDocument(periodKey);
    const value = buildStatusFromUsage(doc);
    statusCache = {
      expiresAt: Date.now() + STATUS_CACHE_TTL_MS,
      value,
    };
    return value;
  }

  static async listRecentHistory(limit = 6): Promise<ResourceStorageBudgetHistoryItem[]> {
    const db = await getMongoDb();
    const rows = await db
      .collection<UsageCounterDocument>(COLLECTION_NAME)
      .find({}, { projection: { _id: 0, period_key: 1, request_count: 1, transfer_bytes: 1 } })
      .sort({ period_key: -1 })
      .limit(Math.max(1, Math.floor(limit)))
      .toArray();

    const config = resolveBudgetConfig();

    return rows.map((row) => {
      const requests = buildMetric({
        used: Number(row.request_count ?? 0),
        limit: config.requestLimit,
        warningPct: config.requestWarningPct,
      });
      const transfer = buildMetric({
        used: Number(row.transfer_bytes ?? 0),
        limit: config.transferLimitBytes,
        warningPct: config.transferWarningPct,
        formatter: formatBytes,
      });

      const status: BudgetLevel =
        requests.status === "blocked" || transfer.status === "blocked"
          ? "blocked"
          : requests.status === "warning" || transfer.status === "warning"
            ? "warning"
            : "ok";

      return {
        periodKey: String(row.period_key),
        requestCount: Number(row.request_count ?? 0),
        transferBytes: Number(row.transfer_bytes ?? 0),
        transferDisplay: formatBytes(Number(row.transfer_bytes ?? 0)),
        status,
      };
    });
  }

  static async getAdminDashboard(): Promise<ResourceStorageBudgetDashboard> {
    if (dashboardCache && dashboardCache.expiresAt > Date.now()) {
      return dashboardCache.value;
    }

    const [status, history] = await Promise.all([this.getStatus(), this.listRecentHistory(6)]);
    const config = this.getConfig();
    const value = {
      status,
      config: {
        ...config,
        transferLimitDisplay: formatBytes(config.transferLimitBytes),
      },
      history,
    };
    dashboardCache = {
      expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
      value,
    };
    return value;
  }

  static async reserveCloudRead(): Promise<ReservationResult> {
    const config = resolveBudgetConfig();
    const periodKey = getCurrentPeriodKey();
    const status = await this.getStatus();

    if (!config.enabled) {
      return {
        status,
        rollback: async () => undefined,
        commit: async () => status,
      };
    }

    if (status.requests.status === "blocked" || status.transfer.status === "blocked") {
      throw new Error(status.message ?? "Cloud resource usage limit reached");
    }

    const db = await getMongoDb();
    const collection = db.collection<UsageCounterDocument>(COLLECTION_NAME);
    const now = new Date().toISOString();
    const documentId = getDocumentId(periodKey);
    let settled = false;

    await collection.updateOne(
      { _id: documentId },
      {
        $setOnInsert: {
          _id: documentId,
          period_key: periodKey,
          created_at: now,
        },
        $inc: { request_count: 1 },
        $set: { updated_at: now },
      },
      { upsert: true },
    );
    this.clearCaches();

    const rollback = async () => {
      if (settled) return;
      settled = true;
      await collection.updateOne(
        { _id: documentId },
        {
          $inc: { request_count: -1 },
          $set: { updated_at: new Date().toISOString() },
        },
      );
      this.clearCaches();
    };

    const commit = async (transferredBytes: number) => {
      if (settled) {
        return this.getStatus();
      }
      settled = true;
      await collection.updateOne(
        { _id: documentId },
        {
          $inc: { transfer_bytes: Math.max(0, Math.floor(transferredBytes)) },
          $set: { updated_at: new Date().toISOString() },
        },
      );
      this.clearCaches();
      return this.getStatus();
    };

    return {
      status: await this.getStatus(),
      rollback,
      commit,
    };
  }
}
