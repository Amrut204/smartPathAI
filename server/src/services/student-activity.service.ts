import { randomUUID } from "node:crypto";

import { getMongoDb } from "../utils/mongodb.js";

export type ActivityImpactLabel = "Low" | "Medium" | "High";

interface StudentSnapshot {
  studentId: string;
  fullName: string;
  email: string;
  rollNumber: string;
  branch: string;
  batch: string;
}

interface StudentActivityWriteInput {
  id?: string;
  tenantId: string;
  studentId: string;
  eventType: string;
  eventSource: string;
  entityId?: string | null;
  entityType?: string | null;
  title: string;
  description: string;
  metadata?: Record<string, unknown>;
  impactScore?: number;
  createdAt?: string;
  module?: string;
  studentSnapshot?: Partial<StudentSnapshot>;
}

interface StudentActivityListInput {
  tenantId: string;
  studentId?: string;
  page?: number;
  limit?: number;
  search?: string;
  eventType?: string;
  branch?: string;
  batch?: string;
}

let indexesEnsured = false;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function inferModule(eventType: string, eventSource: string): string {
  const normalized = `${eventType} ${eventSource}`.toLowerCase();
  if (normalized.includes("auth") || normalized.includes("login") || normalized.includes("signup")) return "Auth";
  if (normalized.includes("study") || normalized.includes("topic")) return "Study";
  if (normalized.includes("mock")) return "Mocks";
  if (normalized.includes("ai")) return "AI Assistant";
  if (normalized.includes("drive")) return "Drives";
  if (normalized.includes("profile")) return "Profile";
  if (normalized.includes("interview")) return "Interview";
  if (normalized.includes("coding")) return "Coding";
  if (normalized.includes("mentorship")) return "Mentorship";
  if (normalized.includes("wallet")) return "Wallet";
  return "Activity";
}

export function activityImpactLabel(score: number): ActivityImpactLabel {
  if (score >= 75) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

export function mapActivityEventDoc(doc: Record<string, unknown>) {
  return {
    id: String(doc.id ?? ""),
    timestamp: String(doc.created_at ?? ""),
    studentId: String(doc.student_id ?? ""),
    studentName: String(doc.student_name ?? ""),
    branch: String(doc.branch ?? ""),
    batch: String(doc.batch ?? ""),
    eventType: String(doc.event_type ?? ""),
    title: String(doc.title ?? ""),
    description: String(doc.description ?? ""),
    module: String(doc.module ?? inferModule(String(doc.event_type ?? ""), String(doc.event_source ?? ""))),
    impactLabel: activityImpactLabel(Number(doc.impact_score ?? 0)),
  };
}

async function ensureIndexes() {
  if (indexesEnsured) return;
  const db = await getMongoDb();
  await Promise.all([
    db.collection("student_activity_events").createIndex({ tenant_id: 1, id: 1 }, { unique: true }),
    db.collection("student_activity_events").createIndex({ tenant_id: 1, created_at: -1 }),
    db.collection("student_activity_events").createIndex({ tenant_id: 1, student_id: 1, created_at: -1 }),
    db.collection("student_activity_events").createIndex({ tenant_id: 1, event_type: 1, created_at: -1 }),
  ]);
  indexesEnsured = true;
}

async function getStudentSnapshots(tenantId: string, studentIds: string[]) {
  if (studentIds.length === 0) {
    return new Map<string, StudentSnapshot>();
  }

  const db = await getMongoDb();
  const students = await db.collection("students").find(
    { tenant_id: tenantId, id: { $in: studentIds } },
    {
      projection: {
        _id: 0,
        id: 1,
        user_id: 1,
        roll_number: 1,
        branch: 1,
        batch: 1,
      },
    },
  ).toArray();

  const userIds = students.map((student) => String(student.user_id ?? ""));
  const users = userIds.length > 0
    ? await db.collection("users").find(
        { tenant_id: tenantId, id: { $in: userIds } },
        { projection: { _id: 0, id: 1, full_name: 1, email: 1 } },
      ).toArray()
    : [];

  const userMap = new Map(
    users.map((user) => [
      String(user.id),
      {
        fullName: String(user.full_name ?? ""),
        email: String(user.email ?? ""),
      },
    ]),
  );

  return new Map(
    students.map((student) => {
      const user = userMap.get(String(student.user_id ?? "")) ?? { fullName: "", email: "" };
      return [
        String(student.id),
        {
          studentId: String(student.id),
          fullName: user.fullName,
          email: user.email,
          rollNumber: String(student.roll_number ?? ""),
          branch: String(student.branch ?? ""),
          batch: String(student.batch ?? ""),
        } satisfies StudentSnapshot,
      ];
    }),
  );
}

async function getStudentSnapshotByUserId(tenantId: string, userId: string) {
  const db = await getMongoDb();
  const student = await db.collection("students").findOne(
    { tenant_id: tenantId, user_id: userId },
    {
      projection: {
        _id: 0,
        id: 1,
        roll_number: 1,
        branch: 1,
        batch: 1,
      },
    },
  );

  if (!student) return null;

  const user = await db.collection("users").findOne(
    { tenant_id: tenantId, id: userId },
    { projection: { _id: 0, full_name: 1, email: 1 } },
  );

  return {
    studentId: String(student.id),
    fullName: String(user?.full_name ?? ""),
    email: String(user?.email ?? ""),
    rollNumber: String(student.roll_number ?? ""),
    branch: String(student.branch ?? ""),
    batch: String(student.batch ?? ""),
  } satisfies StudentSnapshot;
}

export const StudentActivityService = {
  async logEvent(input: StudentActivityWriteInput) {
    const [eventId] = await this.logEvents([input]);
    return eventId ?? null;
  },

  async logEvents(inputs: StudentActivityWriteInput[]) {
    if (inputs.length === 0) return [] as string[];

    await ensureIndexes();
    const db = await getMongoDb();
    const snapshotMap = await getStudentSnapshots(
      inputs[0].tenantId,
      [...new Set(inputs.filter((item) => !item.studentSnapshot).map((item) => item.studentId))],
    );

    const now = new Date().toISOString();
    const docs = inputs.map((input) => {
      const snapshot = {
        ...snapshotMap.get(input.studentId),
        ...input.studentSnapshot,
      };
      const id = input.id ?? randomUUID();

      return {
        id,
        tenant_id: input.tenantId,
        student_id: input.studentId,
        student_name: String(snapshot.fullName ?? ""),
        student_email: String(snapshot.email ?? ""),
        roll_number: String(snapshot.rollNumber ?? ""),
        branch: String(snapshot.branch ?? ""),
        batch: String(snapshot.batch ?? ""),
        event_type: input.eventType,
        event_source: input.eventSource,
        entity_id: input.entityId ?? null,
        entity_type: input.entityType ?? null,
        title: input.title,
        description: input.description,
        metadata: input.metadata ?? {},
        module: input.module ?? inferModule(input.eventType, input.eventSource),
        impact_score: Number(input.impactScore ?? 0),
        created_at: input.createdAt ?? now,
        updated_at: now,
      };
    });

    await db.collection("student_activity_events").bulkWrite(
      docs.map((doc) => ({
        updateOne: {
          filter: { tenant_id: doc.tenant_id, id: doc.id },
          update: { $set: doc },
          upsert: true,
        },
      })),
      { ordered: false },
    );

    return docs.map((doc) => String(doc.id));
  },

  async logEventForUser(
    tenantId: string,
    userId: string,
    input: Omit<StudentActivityWriteInput, "tenantId" | "studentId" | "studentSnapshot">,
  ) {
    const snapshot = await getStudentSnapshotByUserId(tenantId, userId);
    if (!snapshot) return null;

    return this.logEvent({
      ...input,
      tenantId,
      studentId: snapshot.studentId,
      studentSnapshot: snapshot,
    });
  },

  async listEvents(input: StudentActivityListInput) {
    await ensureIndexes();
    const db = await getMongoDb();
    const page = Math.max(1, Number(input.page ?? 1));
    const limit = clamp(Number(input.limit ?? 20), 1, 100);
    const filter: Record<string, unknown> = { tenant_id: input.tenantId };

    if (input.studentId) filter.student_id = input.studentId;
    if (input.eventType && input.eventType !== "all") filter.event_type = input.eventType;
    if (input.branch && input.branch !== "all") filter.branch = input.branch;
    if (input.batch && input.batch !== "all") filter.batch = input.batch;

    const normalizedSearch = input.search?.trim();
    if (normalizedSearch) {
      const regex = { $regex: normalizedSearch, $options: "i" };
      filter.$or = [
        { student_name: regex },
        { roll_number: regex },
        { title: regex },
        { description: regex },
        { branch: regex },
        { batch: regex },
      ];
    }

    const total = await db.collection("student_activity_events").countDocuments(filter);
    const rows = await db.collection("student_activity_events").find(
      filter,
      {
        projection: {
          _id: 0,
          id: 1,
          student_id: 1,
          student_name: 1,
          branch: 1,
          batch: 1,
          event_type: 1,
          event_source: 1,
          title: 1,
          description: 1,
          module: 1,
          impact_score: 1,
          created_at: 1,
        },
      },
    ).sort({ created_at: -1, id: -1 }).skip((page - 1) * limit).limit(limit).toArray();

    return {
      items: rows.map((row) => mapActivityEventDoc(row as Record<string, unknown>)),
      pagination: {
        page,
        limit,
        total,
        totalPages: total > 0 ? Math.ceil(total / limit) : 1,
        hasMore: page * limit < total,
      },
    };
  },
};
