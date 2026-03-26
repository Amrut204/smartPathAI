import { getMongoDb } from "./mongodb.js";
import { logger } from "./logger.js";

let coreIndexesEnsured = false;

function isIgnorableIndexConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? Number((error as { code?: unknown }).code) : NaN;
  const name = "name" in error ? String((error as { name?: unknown }).name ?? "") : "";
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";

  return code === 85
    || code === 86
    || name === "IndexOptionsConflict"
    || name === "IndexKeySpecsConflict"
    || /already exists with different options/i.test(message)
    || /equivalent index already exists/i.test(message);
}

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? Number((error as { code?: unknown }).code) : NaN;
  const name = "name" in error ? String((error as { name?: unknown }).name ?? "") : "";
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";

  return code === 11000
    || name === "MongoServerError" && /duplicate key/i.test(message)
    || /E11000 duplicate key/i.test(message);
}

async function ensureIndex(params: {
  collection: string;
  keys: Record<string, 1 | -1>;
  options?: Record<string, unknown>;
  tolerateDuplicateData?: boolean;
}) {
  const db = await getMongoDb();

  try {
    await db.collection(params.collection).createIndex(params.keys, params.options ?? {});
  } catch (error) {
    if (isIgnorableIndexConflict(error)) {
      logger.warn("Ignoring legacy index conflict during startup", {
        context: {
          collection: params.collection,
          keys: params.keys,
          options: params.options ?? {},
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return;
    }

    if (params.tolerateDuplicateData && isDuplicateKeyError(error)) {
      logger.warn("Skipping index because existing data violates the constraint", {
        context: {
          collection: params.collection,
          keys: params.keys,
          options: params.options ?? {},
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return;
    }

    throw error;
  }
}

export async function ensureCoreIndexes(): Promise<void> {
  if (coreIndexesEnsured) return;

  // Keep this list small and focused on critical/filtered collections.
  const tasks: Array<Promise<unknown>> = [
    // Tenants
    ensureIndex({ collection: "tenants", keys: { slug: 1 }, options: { unique: true } }),
    ensureIndex({ collection: "tenants", keys: { is_active: 1 } }),

    // Users (email is looked up globally in AuthService, so enforce uniqueness)
    ensureIndex({ collection: "users", keys: { email: 1 }, options: { unique: true } }),
    ensureIndex({ collection: "users", keys: { tenant_id: 1, role: 1 } }),
    ensureIndex({ collection: "users", keys: { tenant_id: 1 } }),
    ensureIndex({
      collection: "users",
      keys: { role: 1 },
      options: {
        unique: true,
        partialFilterExpression: { role: "admin" },
        name: "users_single_admin_role",
      },
      tolerateDuplicateData: true,
    }),
    ensureIndex({ collection: "refresh_sessions", keys: { id: 1 }, options: { unique: true } }),
    ensureIndex({ collection: "refresh_sessions", keys: { user_id: 1, revoked_at: 1 } }),
    ensureIndex({ collection: "refresh_sessions", keys: { expires_at: 1 } }),

    // Students
    ensureIndex({ collection: "students", keys: { tenant_id: 1, user_id: 1 }, options: { unique: true } }),
    ensureIndex({ collection: "students", keys: { tenant_id: 1, created_at: -1 } }),
    ensureIndex({ collection: "students", keys: { tenant_id: 1, branch: 1 } }),
    ensureIndex({ collection: "students", keys: { tenant_id: 1, batch: 1 } }),
    ensureIndex({ collection: "students", keys: { tenant_id: 1, branch: 1, batch: 1 } }),

    // Drives
    ensureIndex({ collection: "drives", keys: { tenant_id: 1, id: 1 }, options: { unique: true } }),
    ensureIndex({ collection: "drives", keys: { tenant_id: 1, status: 1 } }),
    ensureIndex({ collection: "drives", keys: { tenant_id: 1, drive_date: -1 } }),

    ensureIndex({ collection: "drive_results", keys: { tenant_id: 1, drive_id: 1 } }),
    ensureIndex({ collection: "drive_results", keys: { tenant_id: 1, drive_id: 1, status: 1 } }),
    ensureIndex({ collection: "drive_results", keys: { tenant_id: 1, drive_id: 1, student_id: 1 }, options: { unique: true } }),
    ensureIndex({ collection: "drive_results", keys: { tenant_id: 1, student_id: 1, updated_at: -1 } }),
    ensureIndex({ collection: "student_drive_declarations", keys: { tenant_id: 1, student_id: 1, drive_id: 1 }, options: { unique: true } }),

    ensureIndex({ collection: "drive_eligibility_snapshots", keys: { tenant_id: 1, drive_id: 1, version: 1 }, options: { unique: true } }),
    ensureIndex({ collection: "drive_eligibility_snapshots", keys: { tenant_id: 1, drive_id: 1, computed_at: -1 } }),

    // Mock tests + attempts
    ensureIndex({ collection: "mock_tests", keys: { tenant_id: 1, is_active: 1, created_at: -1 } }),
    ensureIndex({ collection: "mock_tests", keys: { is_active: 1, topic_id: 1, created_at: -1 } }),
    ensureIndex({ collection: "mock_tests", keys: { is_active: 1, company_id: 1, created_at: -1 } }),

    ensureIndex({ collection: "student_attempts", keys: { tenant_id: 1, student_id: 1, id: 1 }, options: { unique: true } }),
    ensureIndex({ collection: "student_attempts", keys: { tenant_id: 1, student_id: 1, status: 1, submitted_at: -1 } }),
    ensureIndex({ collection: "student_attempts", keys: { tenant_id: 1, student_id: 1, test_id: 1, submitted_at: -1 } }),
    ensureIndex({
      collection: "student_attempts",
      keys: { tenant_id: 1, student_id: 1, idempotency_key: 1 },
      options: {
        unique: true,
        partialFilterExpression: { idempotency_key: { $type: "string" } },
      },
    }),

    // Resources
    ensureIndex({ collection: "shared_resources", keys: { id: 1 }, options: { unique: true } }),
    ensureIndex({ collection: "shared_resources", keys: { is_active: 1, topic_id: 1, created_at: -1 } }),
    ensureIndex({ collection: "shared_resources", keys: { is_active: 1, created_at: -1 } }),
    ensureIndex({ collection: "resources", keys: { tenant_id: 1, is_active: 1, created_at: -1 } }),
    ensureIndex({ collection: "resources", keys: { tenant_id: 1, topic_id: 1, created_at: -1 } }),
    ensureIndex({ collection: "communications", keys: { tenant_id: 1, created_at: -1 } }),
    ensureIndex({ collection: "admin_ops_jobs", keys: { tenant_id: 1, created_at: -1 } }),
  ];

  try {
    await Promise.all(tasks);
    coreIndexesEnsured = true;
    logger.info("Core database indexes ensured", {
      context: { totalIndexes: tasks.length },
    });
  } catch (error) {
    logger.error("Failed to ensure core database indexes", {
      context: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
