import { randomUUID } from "node:crypto";

import type { AppRole, UserProfile } from "../types/domain.types.js";
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

interface UserRecord extends UserProfile {
  password_hash: string;
  created_at?: string;
  updated_at?: string;
}

interface CreateUserInput {
  tenantId: string;
  email: string;
  role: AppRole;
  fullName: string;
  passwordHash: string;
}

interface CreateStudentInput {
  tenantId: string;
  userId: string;
  rollNumber: string;
  branch: string;
  batch: string;
}

const COLLECTIONS = {
  tenants: "tenants",
  users: "users",
  students: "students",
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
    const timestamp = nowIso();
    const user: UserRecord = {
      id: randomUUID(),
      tenant_id: input.tenantId,
      email: input.email.toLowerCase(),
      role: input.role,
      full_name: input.fullName,
      is_active: true,
      password_hash: input.passwordHash,
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
      attendance_pct: 0,
      skills: [],
      points: 0,
      streak_current: 0,
      streak_longest: 0,
      readiness_score: 0,
      profile_data: {},
      created_at: timestamp,
      updated_at: timestamp,
    });
  },
};
