import { getMongoDb } from "../utils/mongodb.js";
import { AuditLogService } from "./audit-log.service.js";

function nowIso() {
  return new Date().toISOString();
}

type AdminUserRow = {
  id: string;
  email: string;
  full_name?: string | null;
  tenant_id: string;
  role: "admin";
  is_active: boolean;
  created_at?: string;
};

function sortAdmins(rows: AdminUserRow[]) {
  return [...rows].sort((left, right) => {
    const leftTime = Date.parse(String(left.created_at ?? ""));
    const rightTime = Date.parse(String(right.created_at ?? ""));
    if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return String(left.id).localeCompare(String(right.id));
  });
}

export const AdminSingletonService = {
  async preview() {
    const db = await getMongoDb();
    const admins = await db.collection<AdminUserRow>("users").find(
      { role: "admin" },
      { projection: { _id: 0, id: 1, email: 1, full_name: 1, tenant_id: 1, role: 1, is_active: 1, created_at: 1 } },
    ).toArray();

    const ordered = sortAdmins(admins);
    const keeper = ordered.find((row) => row.is_active) ?? ordered[0] ?? null;
    const duplicates = keeper ? ordered.filter((row) => row.id !== keeper.id) : [];

    return {
      totalAdmins: ordered.length,
      keeper,
      duplicates,
    };
  },

  async cleanupDuplicateAdmins() {
    const db = await getMongoDb();
    const preview = await this.preview();
    const keeper = preview.keeper;
    if (!keeper) {
      return {
        totalAdmins: 0,
        keptAdminId: null,
        deactivatedAdminIds: [],
      };
    }

    const duplicates = preview.duplicates.filter((row) => row.is_active);
    if (duplicates.length === 0) {
      return {
        totalAdmins: preview.totalAdmins,
        keptAdminId: keeper.id,
        deactivatedAdminIds: [],
      };
    }

    const timestamp = nowIso();
    const duplicateIds = duplicates.map((row) => row.id);
    await db.collection("users").updateMany(
      { id: { $in: duplicateIds }, role: "admin" },
      {
        $set: {
          is_active: false,
          updated_at: timestamp,
        },
      },
    );

    await Promise.all(duplicates.map((duplicate) => AuditLogService.log({
      tenantId: duplicate.tenant_id,
      actorUserId: keeper.id,
      actorRole: "admin",
      actorTenantId: keeper.tenant_id,
      eventType: "admin_singleton_cleanup",
      method: "SCRIPT",
      path: "scripts/cleanup-duplicate-admins.mjs",
      metadata: {
        keptAdminId: keeper.id,
        keptAdminEmail: keeper.email,
        deactivatedAdminId: duplicate.id,
        deactivatedAdminEmail: duplicate.email,
      },
    })));

    return {
      totalAdmins: preview.totalAdmins,
      keptAdminId: keeper.id,
      deactivatedAdminIds: duplicateIds,
    };
  },
};
