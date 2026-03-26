import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";
import { getMongoDb } from "../utils/mongodb.js";

const SUPPORT_COLLECTION = "support_sessions";

let supportIndexesEnsured = false;

async function ensureSupportIndexes() {
  if (supportIndexesEnsured) return;
  const db = await getMongoDb();
  await Promise.all([
    db.collection(SUPPORT_COLLECTION).createIndex({ tenant_id: 1, status: 1, created_at: -1 }),
    db.collection(SUPPORT_COLLECTION).createIndex({ requested_by_user_id: 1, created_at: -1 }),
    db.collection(SUPPORT_COLLECTION).createIndex({ status: 1, expires_at: 1 }),
  ]);
  supportIndexesEnsured = true;
}

type SupportSessionStatus = "pending" | "approved" | "denied" | "revoked";

export interface SupportSessionRecord {
  id: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  requested_by_user_id: string;
  requested_by_email: string;
  reason: string;
  status: SupportSessionStatus;
  is_expired?: boolean;
  created_at: string;
  decided_at: string | null;
  decided_by_user_id: string | null;
  decided_by_email: string | null;
  decision_note: string | null;
  expires_at: string | null;
  last_started_at: string | null;
  last_stopped_at: string | null;
  revoked_at: string | null;
}

function nowIso() {
  return new Date().toISOString();
}

function addMinutesIso(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function isExpired(record: SupportSessionRecord) {
  if (!record.expires_at) return false;
  return record.expires_at <= nowIso();
}

export const SupportSessionService = {
  async requestAccess(params: { requestedByUserId: string; requestedByEmail: string; tenantSlug: string; reason: string }) {
    await ensureSupportIndexes();

    const tenant = await MongoAuthRepository.findTenantBySlug(params.tenantSlug);
    if (!tenant) {
      throw new AppError("NOT_FOUND", "College tenant not found", 404);
    }

    const db = await getMongoDb();
    const record: SupportSessionRecord = {
      id: randomUUID(),
      tenant_id: tenant.id,
      tenant_slug: tenant.slug,
      tenant_name: tenant.name,
      requested_by_user_id: params.requestedByUserId,
      requested_by_email: params.requestedByEmail.toLowerCase(),
      reason: params.reason,
      status: "pending",
      created_at: nowIso(),
      decided_at: null,
      decided_by_user_id: null,
      decided_by_email: null,
      decision_note: null,
      expires_at: null,
      last_started_at: null,
      last_stopped_at: null,
      revoked_at: null,
    };

    await db.collection<SupportSessionRecord>(SUPPORT_COLLECTION).insertOne(record);
    return record;
  },

  async listAdminRequests(requestedByUserId: string) {
    await ensureSupportIndexes();
    const db = await getMongoDb();
    const rows = await db
      .collection<SupportSessionRecord>(SUPPORT_COLLECTION)
      .find({ requested_by_user_id: requestedByUserId })
      .sort({ created_at: -1 })
      .limit(200)
      .toArray();

    return rows.map((row) => ({
      ...row,
      is_expired: row.status === "approved" ? isExpired(row) : false,
    }));
  },

  async listTenantInbox(tenantId: string) {
    await ensureSupportIndexes();
    const db = await getMongoDb();
    return db
      .collection<SupportSessionRecord>(SUPPORT_COLLECTION)
      .find({ tenant_id: tenantId, status: "pending" })
      .sort({ created_at: -1 })
      .limit(200)
      .toArray();
  },

  async getById(id: string): Promise<SupportSessionRecord | null> {
    await ensureSupportIndexes();
    const db = await getMongoDb();
    return db.collection<SupportSessionRecord>(SUPPORT_COLLECTION).findOne({ id });
  },

  async approve(params: {
    tenantId: string;
    sessionId: string;
    decidedByUserId: string;
    decidedByEmail: string;
    ttlMinutes: number;
    note?: string;
  }) {
    await ensureSupportIndexes();
    const db = await getMongoDb();
    const existing = await db.collection<SupportSessionRecord>(SUPPORT_COLLECTION).findOne({ id: params.sessionId });
    if (!existing) throw new AppError("NOT_FOUND", "Support request not found", 404);
    if (existing.tenant_id !== params.tenantId) throw new AppError("FORBIDDEN", "Cannot approve request for another tenant", 403);
    if (existing.status !== "pending") throw new AppError("CONFLICT", "Support request is not pending", 409);

    const patch = {
      status: "approved" as const,
      decided_at: nowIso(),
      decided_by_user_id: params.decidedByUserId,
      decided_by_email: params.decidedByEmail.toLowerCase(),
      decision_note: params.note?.trim() || null,
      expires_at: addMinutesIso(params.ttlMinutes),
      revoked_at: null,
    };

    await db.collection<SupportSessionRecord>(SUPPORT_COLLECTION).updateOne({ id: params.sessionId }, { $set: patch });
    return { ...existing, ...patch };
  },

  async deny(params: { tenantId: string; sessionId: string; decidedByUserId: string; decidedByEmail: string; note: string }) {
    await ensureSupportIndexes();
    const db = await getMongoDb();
    const existing = await db.collection<SupportSessionRecord>(SUPPORT_COLLECTION).findOne({ id: params.sessionId });
    if (!existing) throw new AppError("NOT_FOUND", "Support request not found", 404);
    if (existing.tenant_id !== params.tenantId) throw new AppError("FORBIDDEN", "Cannot deny request for another tenant", 403);
    if (existing.status !== "pending") throw new AppError("CONFLICT", "Support request is not pending", 409);

    const patch = {
      status: "denied" as const,
      decided_at: nowIso(),
      decided_by_user_id: params.decidedByUserId,
      decided_by_email: params.decidedByEmail.toLowerCase(),
      decision_note: params.note.trim(),
      expires_at: null,
      revoked_at: null,
    };

    await db.collection<SupportSessionRecord>(SUPPORT_COLLECTION).updateOne({ id: params.sessionId }, { $set: patch });
    return { ...existing, ...patch };
  },

  async revoke(params: { tenantId: string; sessionId: string; decidedByUserId: string; decidedByEmail: string; note: string }) {
    await ensureSupportIndexes();
    const db = await getMongoDb();
    const existing = await db.collection<SupportSessionRecord>(SUPPORT_COLLECTION).findOne({ id: params.sessionId });
    if (!existing) throw new AppError("NOT_FOUND", "Support request not found", 404);
    if (existing.tenant_id !== params.tenantId) throw new AppError("FORBIDDEN", "Cannot revoke request for another tenant", 403);
    if (existing.status !== "approved") throw new AppError("CONFLICT", "Only approved sessions can be revoked", 409);

    const patch = {
      status: "revoked" as const,
      decided_at: nowIso(),
      decided_by_user_id: params.decidedByUserId,
      decided_by_email: params.decidedByEmail.toLowerCase(),
      decision_note: params.note.trim(),
      revoked_at: nowIso(),
    };

    await db.collection<SupportSessionRecord>(SUPPORT_COLLECTION).updateOne({ id: params.sessionId }, { $set: patch });
    return { ...existing, ...patch };
  },

  async markStarted(params: { sessionId: string; actorUserId: string }) {
    await ensureSupportIndexes();
    const db = await getMongoDb();
    const existing = await db.collection<SupportSessionRecord>(SUPPORT_COLLECTION).findOne({ id: params.sessionId });
    if (!existing) throw new AppError("NOT_FOUND", "Support request not found", 404);
    if (existing.requested_by_user_id !== params.actorUserId) throw new AppError("FORBIDDEN", "Cannot start another admin's session", 403);
    if (existing.status !== "approved") throw new AppError("CONFLICT", "Support request is not approved", 409);
    if (isExpired(existing)) throw new AppError("CONFLICT", "Support session has expired", 409);

    const patch = { last_started_at: nowIso() };
    await db.collection<SupportSessionRecord>(SUPPORT_COLLECTION).updateOne({ id: params.sessionId }, { $set: patch });
    return { ...existing, ...patch };
  },

  async markStopped(params: { sessionId: string; actorUserId: string }) {
    await ensureSupportIndexes();
    const db = await getMongoDb();
    const existing = await db.collection<SupportSessionRecord>(SUPPORT_COLLECTION).findOne({ id: params.sessionId });
    if (!existing) throw new AppError("NOT_FOUND", "Support request not found", 404);
    if (existing.requested_by_user_id !== params.actorUserId) throw new AppError("FORBIDDEN", "Cannot stop another admin's session", 403);

    const patch = { last_stopped_at: nowIso() };
    await db.collection<SupportSessionRecord>(SUPPORT_COLLECTION).updateOne({ id: params.sessionId }, { $set: patch });
    return { ...existing, ...patch };
  },
};
