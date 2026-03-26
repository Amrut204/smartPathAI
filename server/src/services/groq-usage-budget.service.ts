import { AppError } from "../middleware/error-handler.js";
import { getMongoDb } from "../utils/mongodb.js";

interface GroqUsageDocument {
  _id: string;
  period_key: string;
  request_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  created_at: string;
  updated_at: string;
}

export interface GroqBudgetStatus {
  enabled: boolean;
  periodKey: string;
  requestCount: number;
  requestLimit: number | null;
  tokenCount: number;
  tokenLimit: number | null;
  estimatedCostUsd: number;
  costLimitUsd: number | null;
  warningThresholdPct: number;
  warning: boolean;
  blocked: boolean;
  message: string | null;
}

const COLLECTION_NAME = "groq_usage_budget";
let indexesEnsured = false;

function monthKey(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function parsePositiveNumber(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getConfig() {
  const warningThresholdPct = Number(process.env.GROQ_WARNING_PCT ?? 0.9);
  return {
    enabled: String(process.env.GROQ_BUDGET_ENABLED ?? "true").trim().toLowerCase() !== "false",
    requestLimit: parsePositiveNumber(process.env.GROQ_REQUEST_LIMIT_MONTHLY),
    tokenLimit: parsePositiveNumber(process.env.GROQ_TOKEN_LIMIT_MONTHLY),
    costLimitUsd: parsePositiveNumber(process.env.GROQ_COST_LIMIT_USD_MONTHLY),
    warningThresholdPct: Number.isFinite(warningThresholdPct) && warningThresholdPct > 0 && warningThresholdPct < 1
      ? warningThresholdPct
      : 0.9,
  };
}

async function ensureIndexes() {
  if (indexesEnsured) return;
  const db = await getMongoDb();
  await db.collection<GroqUsageDocument>(COLLECTION_NAME).createIndex({ period_key: 1 }, { unique: true });
  indexesEnsured = true;
}

function buildStatusFromUsage(doc: GroqUsageDocument | null): GroqBudgetStatus {
  const config = getConfig();
  const requestCount = Number(doc?.request_count ?? 0);
  const tokenCount = Number(doc?.total_tokens ?? 0);
  const estimatedCostUsd = Number(doc?.estimated_cost_usd ?? 0);

  const requestRatio = config.requestLimit ? requestCount / config.requestLimit : 0;
  const tokenRatio = config.tokenLimit ? tokenCount / config.tokenLimit : 0;
  const costRatio = config.costLimitUsd ? estimatedCostUsd / config.costLimitUsd : 0;
  const maxRatio = Math.max(requestRatio, tokenRatio, costRatio, 0);

  const blocked = config.enabled && (
    (config.requestLimit !== null && requestCount >= config.requestLimit)
    || (config.tokenLimit !== null && tokenCount >= config.tokenLimit)
    || (config.costLimitUsd !== null && estimatedCostUsd >= config.costLimitUsd)
  );
  const warning = !blocked && config.enabled && maxRatio >= config.warningThresholdPct;

  let message: string | null = null;
  if (blocked) {
    message = "Groq AI usage is paused for this month to prevent extra billing.";
  } else if (warning) {
    message = "Groq AI usage is close to this month's safety cap. New AI requests may be paused soon.";
  }

  return {
    enabled: config.enabled,
    periodKey: doc?.period_key ?? monthKey(),
    requestCount,
    requestLimit: config.requestLimit,
    tokenCount,
    tokenLimit: config.tokenLimit,
    estimatedCostUsd,
    costLimitUsd: config.costLimitUsd,
    warningThresholdPct: config.warningThresholdPct,
    warning,
    blocked,
    message,
  };
}

async function readUsage(periodKey = monthKey()): Promise<GroqUsageDocument | null> {
  await ensureIndexes();
  const db = await getMongoDb();
  return db.collection<GroqUsageDocument>(COLLECTION_NAME).findOne({ _id: periodKey });
}

function wouldExceedLimit(status: GroqBudgetStatus, estimate: { requestIncrement?: number; tokenIncrement?: number; costIncrementUsd?: number }) {
  const requestIncrement = Number(estimate.requestIncrement ?? 0);
  const tokenIncrement = Number(estimate.tokenIncrement ?? 0);
  const costIncrementUsd = Number(estimate.costIncrementUsd ?? 0);

  if (status.requestLimit !== null && status.requestCount + requestIncrement > status.requestLimit) {
    return true;
  }
  if (status.tokenLimit !== null && status.tokenCount + tokenIncrement > status.tokenLimit) {
    return true;
  }
  if (status.costLimitUsd !== null && status.estimatedCostUsd + costIncrementUsd > status.costLimitUsd) {
    return true;
  }
  return false;
}

export const GroqUsageBudgetService = {
  async getStatus(): Promise<GroqBudgetStatus> {
    const doc = await readUsage();
    return buildStatusFromUsage(doc);
  },

  async assertCanStart(estimate?: { requestIncrement?: number; tokenIncrement?: number; costIncrementUsd?: number }) {
    const status = await this.getStatus();
    if (!status.enabled) {
      return status;
    }

    if (status.blocked || wouldExceedLimit(status, estimate ?? {})) {
      throw new AppError(
        "AI_GROQ_BUDGET_EXCEEDED",
        status.message ?? "Groq AI usage is paused for this month to prevent extra billing.",
        429,
      );
    }

    return status;
  },

  async recordUsage(input: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  }) {
    const periodKey = monthKey();
    const now = new Date().toISOString();
    await ensureIndexes();
    const db = await getMongoDb();

    await db.collection<GroqUsageDocument>(COLLECTION_NAME).updateOne(
      { _id: periodKey },
      {
        $setOnInsert: {
          _id: periodKey,
          period_key: periodKey,
          created_at: now,
        },
        $set: {
          updated_at: now,
        },
        $inc: {
          request_count: 1,
          prompt_tokens: Number(input.promptTokens ?? 0),
          completion_tokens: Number(input.completionTokens ?? 0),
          total_tokens: Number(input.totalTokens ?? 0),
          estimated_cost_usd: Number(input.estimatedCostUsd ?? 0),
        },
      },
      { upsert: true },
    );

    return this.getStatus();
  },
};
