import { randomUUID } from "node:crypto";

import { getMongoDb } from "../utils/mongodb.js";

const AUDIT_COLLECTION = "audit_logs";

let auditIndexesEnsured = false;

async function ensureAuditIndexes() {
  if (auditIndexesEnsured) return;
  const db = await getMongoDb();
  await Promise.all([
    db.collection(AUDIT_COLLECTION).createIndex({ tenant_id: 1, created_at: -1 }),
    db.collection(AUDIT_COLLECTION).createIndex({ support_session_id: 1, created_at: -1 }),
    db.collection(AUDIT_COLLECTION).createIndex({ actor_user_id: 1, created_at: -1 }),
  ]);
  auditIndexesEnsured = true;
}

export type AuditEventType =
  | "support_session_requested"
  | "support_session_approved"
  | "support_session_denied"
  | "support_session_revoked"
  | "support_session_started"
  | "support_session_stopped"
  | "student_support_requested"
  | "student_support_resolved"
  | "support_access"
  | "drive_eligibility_override_set"
  | "drive_eligibility_override_cleared"
  | "drive_created"
  | "drive_updated"
  | "drive_status_changed"
  | "drive_eligibility_recomputed"
  | "drive_results_updated"
  | "drive_application_withdrawn"
  | "drive_results_released"
  | "drive_exported"
  | "drive_result_email_resent"
  | "student_profile_unlock_reviewed"
  | "communication_sent"
  | "announcement_published"
  | "admin_singleton_cleanup"
  | "admin_ops_student_created"
  | "admin_ops_student_updated"
  | "admin_ops_student_deleted"
  | "admin_ops_tpo_created"
  | "admin_ops_tpo_updated"
  | "admin_ops_tpo_credentials_reset"
  | "admin_ops_credentials_queued"
  | "admin_ops_credentials_reset"
  | "admin_ops_mock_test_created"
  | "admin_ops_mock_test_updated"
  | "admin_ops_mock_test_published"
  | "admin_ops_resource_created"
  | "admin_ops_resource_updated"
  | "admin_ops_integrations_updated"
  | "admin_ops_email_settings_updated";

export const AuditLogService = {
  async log(params: {
    tenantId: string;
    actorUserId: string;
    actorRole: string;
    actorTenantId?: string;
    eventType: AuditEventType;
    supportSessionId?: string | null;
    method?: string | null;
    path?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    await ensureAuditIndexes();
    const db = await getMongoDb();
    const now = new Date().toISOString();

    await db.collection(AUDIT_COLLECTION).insertOne({
      id: randomUUID(),
      tenant_id: params.tenantId,
      actor_user_id: params.actorUserId,
      actor_role: params.actorRole,
      actor_tenant_id: params.actorTenantId ?? null,
      event_type: params.eventType,
      support_session_id: params.supportSessionId ?? null,
      method: params.method ?? null,
      path: params.path ?? null,
      ip: params.ip ?? null,
      user_agent: params.userAgent ?? null,
      metadata: params.metadata ?? null,
      created_at: now,
    });
  },

  async list(params: {
    tenantId: string;
    limit?: number;
    driveId?: string;
    studentId?: string;
    studentUserId?: string;
  }) {
    await ensureAuditIndexes();
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { tenant_id: params.tenantId };
    const clauses: Array<Record<string, unknown>> = [];

    if (params.driveId) {
      clauses.push({ "metadata.driveId": params.driveId });
    }

    if (params.studentId) {
      clauses.push({ "metadata.studentId": params.studentId });
    }

    if (params.studentUserId) {
      clauses.push({ actor_user_id: params.studentUserId, actor_role: "student" });
    }

    if (clauses.length === 1) {
      Object.assign(filter, clauses[0]);
    } else if (clauses.length > 1) {
      filter.$or = clauses;
    }

    const rows = await db.collection(AUDIT_COLLECTION)
      .find(filter)
      .sort({ created_at: -1 })
      .limit(Math.max(1, Math.min(100, params.limit ?? 20)))
      .project({
        _id: 0,
        id: 1,
        created_at: 1,
        event_type: 1,
        support_session_id: 1,
        actor_user_id: 1,
        actor_role: 1,
        actor_tenant_id: 1,
        method: 1,
        path: 1,
        ip: 1,
        user_agent: 1,
        metadata: 1,
      })
      .toArray();

    return rows.map((row) => ({
      id: String(row.id ?? ""),
      createdAt: String(row.created_at ?? ""),
      eventType: String(row.event_type ?? ""),
      supportSessionId: row.support_session_id ? String(row.support_session_id) : null,
      actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
      actorRole: row.actor_role ? String(row.actor_role) : null,
      actorTenantId: row.actor_tenant_id ? String(row.actor_tenant_id) : null,
      method: row.method ? String(row.method) : null,
      path: row.path ? String(row.path) : null,
      ip: row.ip ? String(row.ip) : null,
      userAgent: row.user_agent ? String(row.user_agent) : null,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    }));
  },
};
