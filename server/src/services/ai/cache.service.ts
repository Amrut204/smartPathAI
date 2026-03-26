import { createHash } from "node:crypto";

import { getMongoDb } from "../../utils/mongodb.js";

interface CachePayload {
  response: string;
  provider: string;
  model: string;
}

interface CacheRecord extends CachePayload {
  key: string;
  expiresAt: number;
}

const localCache = new Map<string, CacheRecord>();
let indexesEnsured = false;

function nowMs(): number {
  return Date.now();
}

function cleanupLocalCache() {
  const now = nowMs();
  for (const [key, item] of localCache.entries()) {
    if (item.expiresAt <= now) {
      localCache.delete(key);
    }
  }
}

async function ensureIndexes() {
  if (indexesEnsured) return;
  const db = await getMongoDb();
  await db.collection("ai_response_cache").createIndex({ key: 1 }, { unique: true });
  await db.collection("ai_response_cache").createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
  indexesEnsured = true;
}

export const AICacheService = {
  buildKey(input: {
    tenantId: string;
    prompt: string;
    topic: string;
  }): string {
    const normalizedPrompt = input.prompt.trim().toLowerCase().replace(/\s+/g, " ");
    const canonical = `${input.tenantId}|${input.topic}|${normalizedPrompt}`;
    return createHash("sha256").update(canonical).digest("hex");
  },

  async get(key: string): Promise<CachePayload | null> {
    cleanupLocalCache();

    const local = localCache.get(key);
    if (local && local.expiresAt > nowMs()) {
      return {
        response: local.response,
        provider: local.provider,
        model: local.model,
      };
    }

    await ensureIndexes();
    const db = await getMongoDb();
    const doc = await db.collection("ai_response_cache").findOne(
      { key, expires_at: { $gt: new Date().toISOString() } },
      { projection: { _id: 0, response: 1, provider: 1, model: 1, expires_at: 1 } },
    );

    if (!doc) return null;

    const expiresAt = new Date(String(doc.expires_at)).getTime();
    localCache.set(key, {
      key,
      response: String(doc.response ?? ""),
      provider: String(doc.provider ?? "unknown"),
      model: String(doc.model ?? "unknown"),
      expiresAt,
    });

    return {
      response: String(doc.response ?? ""),
      provider: String(doc.provider ?? "unknown"),
      model: String(doc.model ?? "unknown"),
    };
  },

  async set(key: string, payload: CachePayload, ttlSeconds: number): Promise<void> {
    const expiresAtDate = new Date(Date.now() + ttlSeconds * 1000);
    localCache.set(key, {
      key,
      response: payload.response,
      provider: payload.provider,
      model: payload.model,
      expiresAt: expiresAtDate.getTime(),
    });

    await ensureIndexes();
    const db = await getMongoDb();
    const nowIso = new Date().toISOString();

    await db.collection("ai_response_cache").updateOne(
      { key },
      {
        $set: {
          key,
          response: payload.response,
          provider: payload.provider,
          model: payload.model,
          expires_at: expiresAtDate.toISOString(),
          updated_at: nowIso,
        },
        $setOnInsert: {
          created_at: nowIso,
        },
      },
      { upsert: true },
    );
  },
};

