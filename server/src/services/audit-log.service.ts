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
  | "support_access"
  | "drive_eligibility_override_set"
  | "drive_eligibility_override_cleared"
  | "drive_results_released"
  | "drive_result_email_resent"
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
};
