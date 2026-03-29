import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";
import { getMongoDb } from "../utils/mongodb.js";

const STUDENT_SUPPORT_COLLECTION = "student_support_requests";

let studentSupportIndexesEnsured = false;

async function ensureStudentSupportIndexes() {
  if (studentSupportIndexesEnsured) return;
  const db = await getMongoDb();
  await Promise.all([
    db.collection(STUDENT_SUPPORT_COLLECTION).createIndex({ tenant_id: 1, status: 1, created_at: -1 }),
    db.collection(STUDENT_SUPPORT_COLLECTION).createIndex({ student_id: 1, created_at: -1 }),
  ]);
  studentSupportIndexesEnsured = true;
}

type StudentSupportStatus = "open" | "resolved";

export interface StudentSupportRequestRecord {
  id: string;
  tenant_id: string;
  student_id: string;
  student_email: string;
  student_name: string;
  subject: string;
  message: string;
  status: StudentSupportStatus;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  resolved_by_email: string | null;
  resolution_note: string | null;
}

function nowIso() {
  return new Date().toISOString();
}

export const StudentSupportService = {
  async create(params: { tenantId: string; studentId: string; subject: string; message: string }) {
    await ensureStudentSupportIndexes();

    const user = await MongoAuthRepository.findUserById(params.studentId);
    if (!user || user.role !== "student" || user.tenant_id !== params.tenantId) {
      throw new AppError("NOT_FOUND", "Student profile not found", 404);
    }

    const db = await getMongoDb();
    const timestamp = nowIso();
    const record: StudentSupportRequestRecord = {
      id: randomUUID(),
      tenant_id: params.tenantId,
      student_id: params.studentId,
      student_email: user.email,
      student_name: String(user.full_name ?? "Student"),
      subject: params.subject.trim(),
      message: params.message.trim(),
      status: "open",
      created_at: timestamp,
      updated_at: timestamp,
      resolved_at: null,
      resolved_by_user_id: null,
      resolved_by_email: null,
      resolution_note: null,
    };

    await db.collection<StudentSupportRequestRecord>(STUDENT_SUPPORT_COLLECTION).insertOne(record);
    return record;
  },

  async listForStudent(studentId: string) {
    await ensureStudentSupportIndexes();
    const db = await getMongoDb();
    return db
      .collection<StudentSupportRequestRecord>(STUDENT_SUPPORT_COLLECTION)
      .find({ student_id: studentId })
      .sort({ created_at: -1 })
      .limit(100)
      .toArray();
  },

  async listTenantInbox(tenantId: string) {
    await ensureStudentSupportIndexes();
    const db = await getMongoDb();
    return db
      .collection<StudentSupportRequestRecord>(STUDENT_SUPPORT_COLLECTION)
      .find({ tenant_id: tenantId })
      .sort({ status: 1, created_at: -1 })
      .limit(200)
      .toArray();
  },

  async resolve(params: { tenantId: string; requestId: string; resolvedByUserId: string; resolvedByEmail: string; note: string }) {
    await ensureStudentSupportIndexes();
    const db = await getMongoDb();
    const existing = await db.collection<StudentSupportRequestRecord>(STUDENT_SUPPORT_COLLECTION).findOne({ id: params.requestId });
    if (!existing) throw new AppError("NOT_FOUND", "Student support request not found", 404);
    if (existing.tenant_id !== params.tenantId) {
      throw new AppError("FORBIDDEN", "Cannot resolve a request for another tenant", 403);
    }
    if (existing.status !== "open") {
      throw new AppError("CONFLICT", "Student support request is already resolved", 409);
    }

    const patch = {
      status: "resolved" as const,
      updated_at: nowIso(),
      resolved_at: nowIso(),
      resolved_by_user_id: params.resolvedByUserId,
      resolved_by_email: params.resolvedByEmail.toLowerCase(),
      resolution_note: params.note.trim(),
    };

    await db.collection<StudentSupportRequestRecord>(STUDENT_SUPPORT_COLLECTION).updateOne(
      { id: params.requestId },
      { $set: patch },
    );
    return { ...existing, ...patch };
  },
};
