import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { getMongoDb } from "../utils/mongodb.js";

export interface DriveCriteria {
  minCgpa?: number;
  maxBacklogs?: number;
  branches?: string[];
  minAttendance?: number;
}

interface DriveWriteInput {
  company: string;
  role?: string;
  driveDate: string;
  criteria: DriveCriteria;
  status: "upcoming" | "active" | "completed" | "cancelled";
}

interface DriveListQuery {
  limit: number;
  cursor?: string;
  status?: "upcoming" | "active" | "completed" | "cancelled";
}

interface DriveResultWrite {
  studentId: string;
  outcome: "pending" | "shortlisted" | "selected" | "rejected";
  remarks?: string;
}

async function enrichStudents(
  tenantId: string,
  students: Array<{
    id: string;
    user_id: string;
    roll_number: string | null;
    branch: string;
    batch: string;
    cgpa: number | null;
    backlogs: number;
    attendance_pct: number | null;
    readiness_score: number;
  }>,
) {
  if (students.length === 0) return [];

  const db = await getMongoDb();
  const userIds = students.map((s) => String(s.user_id));
  const users = await db.collection("users").find(
    { tenant_id: tenantId, id: { $in: userIds } },
    { projection: { id: 1, full_name: 1, email: 1 } },
  ).toArray();

  const userMap = new Map(users.map((u) => [String(u.id), u]));

  return students.map((student) => ({
    id: String(student.id),
    userId: String(student.user_id),
    fullName: String(userMap.get(String(student.user_id))?.full_name ?? ""),
    email: String(userMap.get(String(student.user_id))?.email ?? ""),
    rollNumber: student.roll_number ? String(student.roll_number) : "",
    branch: String(student.branch),
    batch: String(student.batch),
    cgpa: Number(student.cgpa ?? 0),
    backlogs: Number(student.backlogs ?? 0),
    attendancePct: Number(student.attendance_pct ?? 0),
    readinessScore: Number(student.readiness_score ?? 0),
  }));
}

export const DriveRepository = {
  async listDrives(tenantId: string, query: DriveListQuery) {
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { tenant_id: tenantId, deleted_at: null };

    if (query.status) filter.status = query.status;
    if (query.cursor) filter.id = { $lt: query.cursor };

    const data = await db.collection("drives").find(
      filter,
      { projection: { _id: 0, id: 1, company: 1, role: 1, drive_date: 1, criteria: 1, status: 1, eligible_count: 1, created_at: 1 } },
    ).sort({ drive_date: -1, id: -1 }).limit(query.limit + 1).toArray();

    const hasMore = data.length > query.limit;
    const items = hasMore ? data.slice(0, query.limit) : data;

    return {
      items: items.map((drive) => ({
        id: String(drive.id),
        company: String(drive.company),
        role: drive.role ? String(drive.role) : null,
        driveDate: String(drive.drive_date),
        criteria: (drive.criteria ?? {}) as DriveCriteria,
        status: String(drive.status),
        eligibleCount: Number(drive.eligible_count ?? 0),
        createdAt: String(drive.created_at),
      })),
      hasMore,
      nextCursor: hasMore ? String(items[items.length - 1]?.id) : null,
    };
  },

  async createDrive(tenantId: string, createdBy: string, input: DriveWriteInput) {
    const db = await getMongoDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    await db.collection("drives").insertOne({
      id,
      tenant_id: tenantId,
      company: input.company,
      role: input.role ?? null,
      drive_date: input.driveDate,
      criteria: input.criteria,
      status: input.status,
      eligible_count: 0,
      created_by: createdBy,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });

    return this.getDriveById(tenantId, id);
  },

  async getDriveById(tenantId: string, driveId: string) {
    const db = await getMongoDb();
    const drive = await db.collection("drives").findOne(
      { tenant_id: tenantId, id: driveId, deleted_at: null },
      { projection: { _id: 0, id: 1, company: 1, role: 1, drive_date: 1, criteria: 1, status: 1, eligible_count: 1, created_at: 1, updated_at: 1 } },
    );

    if (!drive) {
      throw new AppError("DRIVE_NOT_FOUND", "Drive not found", 404);
    }

    const results = await this.listDriveResults(tenantId, driveId);

    return {
      id: String(drive.id),
      company: String(drive.company),
      role: drive.role ? String(drive.role) : null,
      driveDate: String(drive.drive_date),
      criteria: (drive.criteria ?? {}) as DriveCriteria,
      status: String(drive.status),
      eligibleCount: Number(drive.eligible_count ?? 0),
      createdAt: String(drive.created_at),
      updatedAt: drive.updated_at ? String(drive.updated_at) : String(drive.created_at),
      results,
    };
  },

  async updateDrive(
    tenantId: string,
    driveId: string,
    updates: Partial<{
      company: string;
      role: string;
      driveDate: string;
      criteria: DriveCriteria;
      status: "upcoming" | "active" | "completed" | "cancelled";
    }>,
  ) {
    const db = await getMongoDb();
    const payload: Record<string, unknown> = {};

    if (updates.company !== undefined) payload.company = updates.company;
    if (updates.role !== undefined) payload.role = updates.role;
    if (updates.driveDate !== undefined) payload.drive_date = updates.driveDate;
    if (updates.criteria !== undefined) payload.criteria = updates.criteria;
    if (updates.status !== undefined) payload.status = updates.status;
    payload.updated_at = new Date().toISOString();

    const result = await db.collection("drives").updateOne(
      { tenant_id: tenantId, id: driveId, deleted_at: null },
      { $set: payload },
    );

    if (result.matchedCount === 0) {
      throw new AppError("DRIVE_UPDATE_FAILED", "Drive not found", 500);
    }

    return this.getDriveById(tenantId, driveId);
  },

  async softDeleteDrive(tenantId: string, driveId: string) {
    const db = await getMongoDb();
    const result = await db.collection("drives").updateOne(
      { tenant_id: tenantId, id: driveId, deleted_at: null },
      { $set: { status: "cancelled", deleted_at: new Date().toISOString() } },
    );

    if (result.matchedCount === 0) {
      throw new AppError("DRIVE_DELETE_FAILED", "Drive not found", 500);
    }
  },

  async getDriveCriteria(tenantId: string, driveId: string) {
    const db = await getMongoDb();
    const data = await db.collection("drives").findOne(
      { tenant_id: tenantId, id: driveId, deleted_at: null },
      { projection: { _id: 0, id: 1, criteria: 1 } },
    );

    if (!data) {
      throw new AppError("DRIVE_NOT_FOUND", "Drive not found", 404);
    }

    return {
      id: String(data.id),
      criteria: (data.criteria ?? {}) as DriveCriteria,
    };
  },

  async listStudentsForEligibility(tenantId: string, criteria: DriveCriteria) {
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { tenant_id: tenantId };

    if (criteria.minCgpa !== undefined) {
      filter.cgpa = { ...(filter.cgpa as Record<string, unknown> ?? {}), $gte: criteria.minCgpa };
    }
    if (criteria.maxBacklogs !== undefined) {
      filter.backlogs = { $lte: criteria.maxBacklogs };
    }
    if (criteria.minAttendance !== undefined) {
      filter.attendance_pct = { $gte: criteria.minAttendance };
    }
    if (criteria.branches && criteria.branches.length > 0) {
      filter.branch = { $in: criteria.branches };
    }

    const students = await db.collection("students").find(
      filter,
      { projection: { _id: 0, id: 1, user_id: 1, roll_number: 1, branch: 1, batch: 1, cgpa: 1, backlogs: 1, attendance_pct: 1, readiness_score: 1 } },
    ).sort({ cgpa: -1, id: 1 }).toArray();

    return enrichStudents(tenantId, students as unknown as Array<{
      id: string; user_id: string; roll_number: string | null; branch: string; batch: string;
      cgpa: number | null; backlogs: number; attendance_pct: number | null; readiness_score: number;
    }>);
  },

  async replaceDriveResults(tenantId: string, driveId: string, studentIds: string[]) {
    const db = await getMongoDb();

    await db.collection("drive_results").deleteMany({ tenant_id: tenantId, drive_id: driveId });

    if (studentIds.length > 0) {
      const now = new Date().toISOString();
      await db.collection("drive_results").insertMany(
        studentIds.map((studentId) => ({
          id: randomUUID(),
          tenant_id: tenantId,
          drive_id: driveId,
          student_id: studentId,
          status: "eligible",
          outcome: "pending",
          remarks: null,
          created_at: now,
          updated_at: now,
        })),
      );
    }
  },

  async updateDriveEligibleCount(tenantId: string, driveId: string, count: number) {
    const db = await getMongoDb();
    const result = await db.collection("drives").updateOne(
      { tenant_id: tenantId, id: driveId, deleted_at: null },
      { $set: { eligible_count: count } },
    );

    if (result.matchedCount === 0) {
      throw new AppError("DRIVE_COUNT_UPDATE_FAILED", "Drive not found", 500);
    }
  },

  async listDriveResults(tenantId: string, driveId: string) {
    const db = await getMongoDb();
    const rows = await db.collection("drive_results").find(
      { tenant_id: tenantId, drive_id: driveId },
      { projection: { _id: 0, student_id: 1, status: 1, outcome: 1, remarks: 1, created_at: 1, updated_at: 1 } },
    ).sort({ updated_at: -1 }).toArray();

    const studentIds = rows.map((row) => String(row.student_id));
    if (studentIds.length === 0) return [];

    const students = await db.collection("students").find(
      { tenant_id: tenantId, id: { $in: studentIds } },
      { projection: { _id: 0, id: 1, user_id: 1, roll_number: 1, branch: 1, batch: 1, cgpa: 1, backlogs: 1, attendance_pct: 1, readiness_score: 1 } },
    ).toArray();

    const enrichedStudents = await enrichStudents(
      tenantId,
      students as unknown as Array<{
        id: string; user_id: string; roll_number: string | null; branch: string; batch: string;
        cgpa: number | null; backlogs: number; attendance_pct: number | null; readiness_score: number;
      }>,
    );
    const studentMap = new Map(enrichedStudents.map((s) => [s.id, s]));

    return rows
      .map((row) => {
        const student = studentMap.get(String(row.student_id));
        if (!student) return null;
        return {
          ...student,
          status: String(row.status),
          outcome: String(row.outcome),
          remarks: row.remarks ? String(row.remarks) : null,
          updatedAt: row.updated_at ? String(row.updated_at) : String(row.created_at ?? ""),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  },

  async upsertDriveResults(tenantId: string, driveId: string, updates: DriveResultWrite[]) {
    const db = await getMongoDb();
    const now = new Date().toISOString();
    const bulkOps = updates.map((update) => ({
      updateOne: {
        filter: { tenant_id: tenantId, drive_id: driveId, student_id: update.studentId },
        update: {
          $set: {
            status: "eligible",
            outcome: update.outcome,
            remarks: update.remarks ?? null,
            updated_at: now,
          },
          $setOnInsert: {
            id: randomUUID(),
            tenant_id: tenantId,
            drive_id: driveId,
            student_id: update.studentId,
            created_at: now,
          },
        },
        upsert: true,
      },
    }));

    if (bulkOps.length > 0) {
      await db.collection("drive_results").bulkWrite(bulkOps);
    }
  },

  async updateDriveStatus(
    tenantId: string,
    driveId: string,
    status: "upcoming" | "active" | "completed" | "cancelled",
  ) {
    const db = await getMongoDb();
    const result = await db.collection("drives").updateOne(
      { tenant_id: tenantId, id: driveId, deleted_at: null },
      { $set: { status, updated_at: new Date().toISOString() } },
    );

    if (result.matchedCount === 0) {
      throw new AppError("DRIVE_STATUS_UPDATE_FAILED", "Drive not found", 500);
    }
  },
};
