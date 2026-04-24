import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { getMongoDb } from "../utils/mongodb.js";
import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";

type NotificationRecipientRole = "student" | "tpo" | "hod" | "admin";
type NotificationPriority = "normal" | "important" | "urgent";
type NotificationKind = "announcement" | "action";
type NotificationType =
  | "announcement_published"
  | "drive_published"
  | "drive_deadline_reminder"
  | "result_released"
  | "grievance_created"
  | "grievance_updated"
  | "feedback_assigned"
  | "feedback_response_received"
  | "report_pack_ready"
  | "automation_review_ready";

const NOTIFICATIONS_COLLECTION = "notifications";

let indexesEnsured = false;

function nowIso() {
  return new Date().toISOString();
}

async function ensureIndexes() {
  if (indexesEnsured) return;
  const db = await getMongoDb();
  await db.collection(NOTIFICATIONS_COLLECTION).createIndex({ tenant_id: 1, recipient_user_id: 1, created_at: -1 });
  await db.collection(NOTIFICATIONS_COLLECTION).createIndex({ tenant_id: 1, recipient_user_id: 1, read_at: 1, created_at: -1 });
  await db.collection(NOTIFICATIONS_COLLECTION).createIndex(
    { tenant_id: 1, recipient_user_id: 1, source_type: 1, source_id: 1 },
    {
      unique: true,
      partialFilterExpression: {
        source_type: { $exists: true, $type: "string" },
        source_id: { $exists: true, $type: "string" },
      },
    },
  );
  indexesEnsured = true;
}

function normalizeListLimit(value: number | undefined) {
  const parsed = Number(value ?? 20);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

function parseView(view: string | undefined) {
  const value = String(view ?? "all").trim().toLowerCase();
  if (value === "unread" || value === "announcements" || value === "actions") {
    return value;
  }
  return "all";
}

async function resolveStudentByUserId(tenantId: string, userId: string) {
  const db = await getMongoDb();
  const row = await db.collection("students").findOne(
    { tenant_id: tenantId, user_id: userId },
    { projection: { _id: 0, id: 1 } },
  );
  return row?.id ? String(row.id) : null;
}

async function resolveStudentUserIds(tenantId: string, studentIds: string[]) {
  const db = await getMongoDb();
  const ids = [...new Set(studentIds.map((value) => String(value).trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  const rows = await db.collection("students").find(
    { tenant_id: tenantId, id: { $in: ids } },
    { projection: { _id: 0, user_id: 1 } },
  ).toArray();
  return rows.map((row) => String(row.user_id ?? "").trim()).filter(Boolean);
}

async function resolveUsersByRole(params: {
  tenantId: string;
  role: NotificationRecipientRole;
  department?: string | null;
}) {
  const db = await getMongoDb();
  const filter: Record<string, unknown> = {
    tenant_id: params.tenantId,
    role: params.role,
    is_active: true,
  };
  if (params.role === "hod" && params.department) {
    filter.department = params.department;
  }
  const rows = await db.collection("users").find(
    filter,
    { projection: { _id: 0, id: 1 } },
  ).toArray();
  return rows.map((row) => String(row.id)).filter(Boolean);
}

function toNotificationItem(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    type: String(row.type) as NotificationType,
    kind: String(row.kind) as NotificationKind,
    priority: String(row.priority) as NotificationPriority,
    title: String(row.title ?? ""),
    message: String(row.message ?? ""),
    targetPath: row.target_path ? String(row.target_path) : null,
    targetEntityId: row.target_entity_id ? String(row.target_entity_id) : null,
    sourceType: row.source_type ? String(row.source_type) : null,
    sourceId: row.source_id ? String(row.source_id) : null,
    metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {},
    readAt: row.read_at ? String(row.read_at) : null,
    seenAt: row.seen_at ? String(row.seen_at) : null,
    dismissedAt: row.dismissed_at ? String(row.dismissed_at) : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? row.created_at ?? ""),
  };
}

async function upsertForUser(params: {
  tenantId: string;
  recipientUserId: string;
  recipientRole: NotificationRecipientRole;
  type: NotificationType;
  kind: NotificationKind;
  priority: NotificationPriority;
  title: string;
  message: string;
  targetPath?: string | null;
  targetEntityId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const db = await getMongoDb();
  const now = nowIso();
  const baseSet = {
    recipient_role: params.recipientRole,
    type: params.type,
    kind: params.kind,
    priority: params.priority,
    title: params.title,
    message: params.message,
    target_path: params.targetPath ?? null,
    target_entity_id: params.targetEntityId ?? null,
    source_type: params.sourceType ?? null,
    source_id: params.sourceId ?? null,
    metadata: params.metadata ?? {},
    updated_at: now,
  };

  if (params.sourceType && params.sourceId) {
    await db.collection(NOTIFICATIONS_COLLECTION).updateOne(
      {
        tenant_id: params.tenantId,
        recipient_user_id: params.recipientUserId,
        source_type: params.sourceType,
        source_id: params.sourceId,
      },
      {
        $set: baseSet,
        $setOnInsert: {
          id: randomUUID(),
          tenant_id: params.tenantId,
          recipient_user_id: params.recipientUserId,
          created_at: now,
          read_at: null,
          seen_at: null,
          dismissed_at: null,
        },
      },
      { upsert: true },
    );
    return;
  }

  await db.collection(NOTIFICATIONS_COLLECTION).insertOne({
    id: randomUUID(),
    tenant_id: params.tenantId,
    recipient_user_id: params.recipientUserId,
    created_at: now,
    read_at: null,
    seen_at: null,
    dismissed_at: null,
    ...baseSet,
  });
}

function deriveAnnouncementNotificationType(systemKey: string | undefined, relatedDriveId: string | undefined) {
  const key = String(systemKey ?? "");
  if (key.startsWith("drive-results-published:")) return "result_released" as const;
  if (key.startsWith("drive-deadline-")) return "drive_deadline_reminder" as const;
  if (key.startsWith("drive-eligible-") || relatedDriveId) return "drive_published" as const;
  return "announcement_published" as const;
}

function deriveAnnouncementTargetPath(systemKey: string | undefined, relatedDriveId: string | undefined) {
  const key = String(systemKey ?? "");
  if (key.startsWith("drive-results-published:") && relatedDriveId) {
    return `/drives`;
  }
  if (key.startsWith("drive-") || relatedDriveId) {
    return `/drives`;
  }
  return `/announcements`;
}

export const NotificationService = {
  async createAnnouncementNotifications(input: {
    tenantId: string;
    announcementId: string;
    studentIds: string[];
    title: string;
    message: string;
    priority: NotificationPriority;
    relatedDriveId?: string | null;
    systemKey?: string | null;
  }) {
    await ensureIndexes();
    const userIds = await resolveStudentUserIds(input.tenantId, input.studentIds);
    if (userIds.length === 0) return;

    const type = deriveAnnouncementNotificationType(input.systemKey ?? undefined, input.relatedDriveId ?? undefined);
    const targetPath = deriveAnnouncementTargetPath(input.systemKey ?? undefined, input.relatedDriveId ?? undefined);

    await Promise.all(userIds.map((userId) =>
      upsertForUser({
        tenantId: input.tenantId,
        recipientUserId: userId,
        recipientRole: "student",
        type,
        kind: "announcement",
        priority: input.priority,
        title: input.title,
        message: input.message,
        targetPath,
        targetEntityId: input.relatedDriveId ?? input.announcementId,
        sourceType: "announcement",
        sourceId: input.announcementId,
        metadata: {
          relatedDriveId: input.relatedDriveId ?? null,
          systemKey: input.systemKey ?? null,
        },
      })));
  },

  async createRoleNotifications(input: {
    tenantId: string;
    recipientRole: "student" | "tpo" | "hod";
    recipientUserIds?: string[];
    department?: string | null;
    type: NotificationType;
    kind: NotificationKind;
    priority: NotificationPriority;
    title: string;
    message: string;
    targetPath?: string | null;
    targetEntityId?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    await ensureIndexes();
    const userIds = input.recipientUserIds && input.recipientUserIds.length > 0
      ? [...new Set(input.recipientUserIds.map((value) => String(value).trim()).filter(Boolean))]
      : await resolveUsersByRole({
        tenantId: input.tenantId,
        role: input.recipientRole,
        department: input.department ?? null,
      });

    if (userIds.length === 0) return;

    await Promise.all(userIds.map((userId) =>
      upsertForUser({
        tenantId: input.tenantId,
        recipientUserId: userId,
        recipientRole: input.recipientRole,
        type: input.type,
        kind: input.kind,
        priority: input.priority,
        title: input.title,
        message: input.message,
        targetPath: input.targetPath,
        targetEntityId: input.targetEntityId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        metadata: input.metadata,
      })));
  },

  async listForUser(input: {
    tenantId: string;
    userId: string;
    role: NotificationRecipientRole;
    view?: string;
    limit?: number;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const view = parseView(input.view);
    const filter: Record<string, unknown> = {
      tenant_id: input.tenantId,
      recipient_user_id: input.userId,
    };
    if (view === "unread") filter.read_at = null;
    if (view === "announcements") filter.kind = "announcement";
    if (view === "actions") filter.kind = "action";

    const [items, unreadCount] = await Promise.all([
      db.collection(NOTIFICATIONS_COLLECTION).find(
        filter,
        { projection: { _id: 0 } },
      ).sort({ read_at: 1, created_at: -1 }).limit(normalizeListLimit(input.limit)).toArray(),
      db.collection(NOTIFICATIONS_COLLECTION).countDocuments({
        tenant_id: input.tenantId,
        recipient_user_id: input.userId,
        read_at: null,
      }),
    ]);

    return {
      unreadCount,
      items: items.map((item) => toNotificationItem(item as Record<string, unknown>)),
    };
  },

  async markRead(input: {
    tenantId: string;
    userId: string;
    role: NotificationRecipientRole;
    notificationId: string;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const row = await db.collection(NOTIFICATIONS_COLLECTION).findOne(
      { tenant_id: input.tenantId, recipient_user_id: input.userId, id: input.notificationId },
      { projection: { _id: 0, id: 1, source_type: 1, source_id: 1, read_at: 1 } },
    );
    if (!row) {
      throw new AppError("NOTIFICATION_NOT_FOUND", "Notification not found", 404);
    }

    const now = nowIso();
    await db.collection(NOTIFICATIONS_COLLECTION).updateOne(
      { tenant_id: input.tenantId, recipient_user_id: input.userId, id: input.notificationId },
      { $set: { read_at: now, seen_at: now, updated_at: now } },
    );

    if (String(row.source_type ?? "") === "announcement" && row.source_id && input.role === "student") {
      const studentId = await resolveStudentByUserId(input.tenantId, input.userId);
      if (studentId) {
        await db.collection("announcement_reads").updateOne(
          { tenant_id: input.tenantId, student_id: studentId, announcement_id: String(row.source_id) },
          {
            $set: {
              read_at: now,
              seen_on_dashboard_at: now,
              updated_at: now,
            },
            $setOnInsert: {
              id: randomUUID(),
              tenant_id: input.tenantId,
              student_id: studentId,
              announcement_id: String(row.source_id),
              created_at: now,
              dismissed_popup_at: null,
            },
          },
          { upsert: true },
        );
      }
    }

    return { notificationId: input.notificationId, readAt: now };
  },

  async markAllRead(input: {
    tenantId: string;
    userId: string;
    role: NotificationRecipientRole;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const now = nowIso();
    const unreadRows = await db.collection(NOTIFICATIONS_COLLECTION).find(
      { tenant_id: input.tenantId, recipient_user_id: input.userId, read_at: null },
      { projection: { _id: 0, source_type: 1, source_id: 1 } },
    ).toArray();

    await db.collection(NOTIFICATIONS_COLLECTION).updateMany(
      { tenant_id: input.tenantId, recipient_user_id: input.userId, read_at: null },
      { $set: { read_at: now, seen_at: now, updated_at: now } },
    );

    if (input.role === "student") {
      const announcementIds = unreadRows
        .filter((row) => String(row.source_type ?? "") === "announcement" && row.source_id)
        .map((row) => String(row.source_id));
      const studentId = announcementIds.length > 0
        ? await resolveStudentByUserId(input.tenantId, input.userId)
        : null;
      if (studentId && announcementIds.length > 0) {
        await db.collection("announcement_reads").bulkWrite(
          announcementIds.map((announcementId) => ({
            updateOne: {
              filter: { tenant_id: input.tenantId, student_id: studentId, announcement_id: announcementId },
              update: {
                $set: { read_at: now, seen_on_dashboard_at: now, updated_at: now },
                $setOnInsert: {
                  id: randomUUID(),
                  tenant_id: input.tenantId,
                  student_id: studentId,
                  announcement_id: announcementId,
                  created_at: now,
                  dismissed_popup_at: null,
                },
              },
              upsert: true,
            },
          })),
          { ordered: false },
        );
      }
    }

    return { readAt: now };
  },

  async markAnnouncementSeen(input: {
    tenantId: string;
    userId: string;
    announcementIds: string[];
  }) {
    await ensureIndexes();
    const ids = [...new Set(input.announcementIds.map((value) => String(value).trim()).filter(Boolean))];
    if (ids.length === 0) return;
    const now = nowIso();
    const db = await getMongoDb();
    await db.collection(NOTIFICATIONS_COLLECTION).updateMany(
      {
        tenant_id: input.tenantId,
        recipient_user_id: input.userId,
        source_type: "announcement",
        source_id: { $in: ids },
      },
      { $set: { seen_at: now, updated_at: now } },
    );
  },

  async markAnnouncementDismissed(input: {
    tenantId: string;
    userId: string;
    announcementId: string;
  }) {
    await ensureIndexes();
    const now = nowIso();
    const db = await getMongoDb();
    await db.collection(NOTIFICATIONS_COLLECTION).updateMany(
      {
        tenant_id: input.tenantId,
        recipient_user_id: input.userId,
        source_type: "announcement",
        source_id: input.announcementId,
      },
      { $set: { dismissed_at: now, updated_at: now } },
    );
  },
};
