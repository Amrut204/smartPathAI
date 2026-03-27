import { randomUUID } from "node:crypto";

import type { AppRole, UserProfile } from "../types/domain.types.js";
import { AppError } from "../middleware/error-handler.js";
import { getMongoDb } from "../utils/mongodb.js";

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  domain?: string | null;
  subscription_tier?: string | null;
  is_active: boolean;
  config?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface TenantEmailSettings {
  fromName?: string;
  fromEmail?: string;
  replyToEmail?: string;
}

export interface TenantConfigPatchInput {
  config: Record<string, unknown>;
}

export interface RefreshSessionRecord {
  id: string;
  user_id: string;
  tenant_id: string;
  issued_at: string;
  expires_at: string;
  rotated_from?: string | null;
  revoked_at?: string | null;
  revoked_reason?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface UserRecord extends UserProfile {
  password_hash: string;
  password_issued_at?: string;
  onboarding_batch_id?: string;
  password_version?: number;
  created_at?: string;
  updated_at?: string;
}

interface CreateUserInput {
  tenantId: string;
  email: string;
  role: AppRole;
  fullName: string;
  passwordHash: string;
  mustChangePassword?: boolean;
  passwordIssuedAt?: string;
  onboardingBatchId?: string;
  passwordVersion?: number;
}

interface CreateStudentInput {
  tenantId: string;
  userId: string;
  rollNumber: string;
  branch: string;
  batch: string;
}

interface CreateTenantInput {
  name: string;
  slug: string;
  domain?: string | null;
  subscriptionTier?: string | null;
  config?: Record<string, unknown>;
}

const COLLECTIONS = {
  tenants: "tenants",
  users: "users",
  students: "students",
  refreshSessions: "refresh_sessions",
} as const;

function nowIso(): string {
  return new Date().toISOString();
}

export const MongoAuthRepository = {
  async findTenantBySlug(slug: string): Promise<TenantRecord | null> {
    const db = await getMongoDb();
    return db.collection<TenantRecord>(COLLECTIONS.tenants).findOne({ slug });
  },

  async findTenantById(tenantId: string): Promise<TenantRecord | null> {
    const db = await getMongoDb();
    return db.collection<TenantRecord>(COLLECTIONS.tenants).findOne({ id: tenantId });
  },

  async listTenants(): Promise<TenantRecord[]> {
    const db = await getMongoDb();
    return db.collection<TenantRecord>(COLLECTIONS.tenants).find(
      {},
      { projection: { _id: 0, id: 1, name: 1, slug: 1, domain: 1, subscription_tier: 1, is_active: 1, config: 1, created_at: 1, updated_at: 1 } },
    ).sort({ name: 1 }).toArray();
  },

  async createTenant(input: CreateTenantInput): Promise<TenantRecord> {
    const db = await getMongoDb();
    const existing = await db.collection<TenantRecord>(COLLECTIONS.tenants).findOne(
      { $or: [{ slug: input.slug }, { name: input.name }] },
      { projection: { _id: 0, id: 1, slug: 1, name: 1 } },
    );

    if (existing?.slug === input.slug) {
      throw new AppError("TENANT_SLUG_EXISTS", "A college with this slug already exists.", 409);
    }
    if (existing?.name === input.name) {
      throw new AppError("TENANT_NAME_EXISTS", "A college with this name already exists.", 409);
    }

    const timestamp = nowIso();
    const tenant: TenantRecord = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      domain: input.domain ?? null,
      subscription_tier: input.subscriptionTier ?? null,
      is_active: true,
      config: input.config ?? {},
      created_at: timestamp,
      updated_at: timestamp,
    };

    await db.collection<TenantRecord>(COLLECTIONS.tenants).insertOne(tenant);
    return tenant;
  },

  async updateTenantEmailSettings(tenantId: string, input: TenantEmailSettings): Promise<TenantRecord | null> {
    const db = await getMongoDb();
    const existing = await db.collection<TenantRecord>(COLLECTIONS.tenants).findOne(
      { id: tenantId },
      { projection: { _id: 0, config: 1 } },
    );

    const currentConfig = existing?.config && typeof existing.config === "object"
      ? existing.config as Record<string, unknown>
      : {};
    const currentEmailSettings = currentConfig.emailSettings && typeof currentConfig.emailSettings === "object"
      ? currentConfig.emailSettings as Record<string, unknown>
      : {};

    const nextEmailSettings = {
      ...currentEmailSettings,
      ...(input.fromName !== undefined ? { fromName: input.fromName } : {}),
      ...(input.fromEmail !== undefined ? { fromEmail: input.fromEmail.toLowerCase() } : {}),
      ...(input.replyToEmail !== undefined ? { replyToEmail: input.replyToEmail.toLowerCase() } : {}),
    };

    const result = await db.collection<TenantRecord>(COLLECTIONS.tenants).findOneAndUpdate(
      { id: tenantId },
      {
        $set: {
          config: {
            ...currentConfig,
            emailSettings: nextEmailSettings,
          },
          updated_at: nowIso(),
        },
      },
      { returnDocument: "after" },
    );

    return result;
  },

  async updateTenantConfig(tenantId: string, input: TenantConfigPatchInput): Promise<TenantRecord | null> {
    const db = await getMongoDb();
    const existing = await db.collection<TenantRecord>(COLLECTIONS.tenants).findOne(
      { id: tenantId },
      { projection: { _id: 0, config: 1 } },
    );

    const currentConfig = existing?.config && typeof existing.config === "object"
      ? existing.config as Record<string, unknown>
      : {};

    const result = await db.collection<TenantRecord>(COLLECTIONS.tenants).findOneAndUpdate(
      { id: tenantId },
      {
        $set: {
          config: {
            ...currentConfig,
            ...input.config,
          },
          updated_at: nowIso(),
        },
      },
      { returnDocument: "after" },
    );

    return result;
  },

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const db = await getMongoDb();
    return db.collection<UserRecord>(COLLECTIONS.users).findOne({ email: email.toLowerCase() });
  },

  async findUserById(userId: string): Promise<UserRecord | null> {
    const db = await getMongoDb();
    return db.collection<UserRecord>(COLLECTIONS.users).findOne({ id: userId });
  },

  async createUser(input: CreateUserInput): Promise<UserProfile & { password_hash: string }> {
    const db = await getMongoDb();
    if (input.role === "admin") {
      const existingAdmin = await db.collection<UserRecord>(COLLECTIONS.users).findOne(
        { role: "admin" },
        { projection: { _id: 0, id: 1, email: 1 } },
      );
      if (existingAdmin) {
        throw new AppError(
          "ADMIN_SINGLETON_ENFORCED",
          `A platform admin already exists (${existingAdmin.email}). Create TPO accounts instead of additional admins.`,
          409,
        );
      }
    }

    const timestamp = nowIso();
    const user: UserRecord = {
      id: randomUUID(),
      tenant_id: input.tenantId,
      email: input.email.toLowerCase(),
      role: input.role,
      full_name: input.fullName,
      is_active: true,
      must_change_password: Boolean(input.mustChangePassword),
      password_hash: input.passwordHash,
      password_issued_at: input.passwordIssuedAt,
      onboarding_batch_id: input.onboardingBatchId,
      password_version: input.passwordVersion,
      created_at: timestamp,
      updated_at: timestamp,
    };

    await db.collection<UserRecord>(COLLECTIONS.users).insertOne(user);
    return user;
  },

  async createStudent(input: CreateStudentInput): Promise<void> {
    const db = await getMongoDb();
    const timestamp = nowIso();

    await db.collection(COLLECTIONS.students).insertOne({
      id: randomUUID(),
      tenant_id: input.tenantId,
      user_id: input.userId,
      roll_number: input.rollNumber,
      branch: input.branch,
      batch: input.batch,
      cgpa: 0,
      backlogs: 0,
      backlogs_total: 0,
      attendance_pct: 0,
      skills: [],
      points: 0,
      streak_current: 0,
      streak_longest: 0,
      readiness_score: 0,
      profile_data: {
        totalHistoricalBacklogs: 0,
      },
      created_at: timestamp,
      updated_at: timestamp,
    });
  },

  async updateInitialPassword(userId: string, passwordHash: string, passwordVersion?: number): Promise<UserRecord | null> {
    const db = await getMongoDb();
    const timestamp = nowIso();

    const result = await db.collection<UserRecord>(COLLECTIONS.users).findOneAndUpdate(
      { id: userId, is_active: true },
      {
        $set: {
          password_hash: passwordHash,
          must_change_password: false,
          updated_at: timestamp,
          ...(passwordVersion !== undefined ? { password_version: passwordVersion } : {}),
        },
        $unset: {
          password_issued_at: "",
          onboarding_batch_id: "",
        },
      },
      { returnDocument: "after" },
    );

    return result;
  },

  async setPasswordForAdmin(
    userId: string,
    input: {
      passwordHash: string;
      mustChangePassword: boolean;
      passwordIssuedAt?: string;
      onboardingBatchId?: string | null;
      passwordVersion?: number;
    },
  ): Promise<UserRecord | null> {
    const db = await getMongoDb();
    const timestamp = nowIso();

    const update: Record<string, unknown> = {
      password_hash: input.passwordHash,
      must_change_password: input.mustChangePassword,
      updated_at: timestamp,
    };

    if (input.passwordIssuedAt !== undefined) {
      update.password_issued_at = input.passwordIssuedAt;
    }
    if (input.onboardingBatchId !== undefined) {
      update.onboarding_batch_id = input.onboardingBatchId;
    }
    if (input.passwordVersion !== undefined) {
      update.password_version = input.passwordVersion;
    }

    return db.collection<UserRecord>(COLLECTIONS.users).findOneAndUpdate(
      { id: userId, is_active: true },
      { $set: update },
      { returnDocument: "after" },
    );
  },

  async createRefreshSession(input: {
    userId: string;
    tenantId: string;
    expiresAt: string;
    rotatedFrom?: string | null;
  }): Promise<RefreshSessionRecord> {
    const db = await getMongoDb();
    const timestamp = nowIso();
    const session: RefreshSessionRecord = {
      id: randomUUID(),
      user_id: input.userId,
      tenant_id: input.tenantId,
      issued_at: timestamp,
      expires_at: input.expiresAt,
      rotated_from: input.rotatedFrom ?? null,
      revoked_at: null,
      revoked_reason: null,
      created_at: timestamp,
      updated_at: timestamp,
    };

    await db.collection<RefreshSessionRecord>(COLLECTIONS.refreshSessions).insertOne(session);
    return session;
  },

  async findRefreshSessionById(sessionId: string): Promise<RefreshSessionRecord | null> {
    const db = await getMongoDb();
    return db.collection<RefreshSessionRecord>(COLLECTIONS.refreshSessions).findOne({ id: sessionId });
  },

  async revokeRefreshSession(sessionId: string, reason: string): Promise<void> {
    const db = await getMongoDb();
    const timestamp = nowIso();
    await db.collection<RefreshSessionRecord>(COLLECTIONS.refreshSessions).updateOne(
      { id: sessionId, revoked_at: null },
      {
        $set: {
          revoked_at: timestamp,
          revoked_reason: reason,
          updated_at: timestamp,
        },
      },
    );
  },

  async revokeAllRefreshSessionsForUser(userId: string, reason: string): Promise<void> {
    const db = await getMongoDb();
    const timestamp = nowIso();
    await db.collection<RefreshSessionRecord>(COLLECTIONS.refreshSessions).updateMany(
      { user_id: userId, revoked_at: null },
      {
        $set: {
          revoked_at: timestamp,
          revoked_reason: reason,
          updated_at: timestamp,
        },
      },
    );
  },
};
