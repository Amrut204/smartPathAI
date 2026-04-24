import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";
import { getMongoDb } from "../utils/mongodb.js";

type AlumniVerificationStatus = "pending" | "verified" | "unverified";
type AlumniOpportunityType = "referral" | "hiring_lead" | "mentorship_session" | "alumni_talk";
type AlumniOpportunityStatus = "draft" | "active" | "closed" | "archived";
type AcademicYear = "first_year" | "second_year" | "third_year" | "final_year";

const CONTACTS_COLLECTION = "alumni_contacts";
const OPPORTUNITIES_COLLECTION = "alumni_opportunities";
const ACTIVITY_COLLECTION = "alumni_activity_log";

function nowIso() {
  return new Date().toISOString();
}

function cleanString(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function deriveAcademicYear(currentSemester: unknown): AcademicYear | null {
  const semester = Number(String(currentSemester ?? "").trim());
  if (!Number.isFinite(semester) || semester <= 0) return null;
  if (semester <= 2) return "first_year";
  if (semester <= 4) return "second_year";
  if (semester <= 6) return "third_year";
  return "final_year";
}

async function ensureIndexes() {
  const db = await getMongoDb();
  await db.collection(CONTACTS_COLLECTION).createIndex({ tenant_id: 1, full_name: 1 });
  await db.collection(CONTACTS_COLLECTION).createIndex({ tenant_id: 1, branch: 1, graduation_year: 1 });
  await db.collection(OPPORTUNITIES_COLLECTION).createIndex({ tenant_id: 1, status: 1, type: 1, updated_at: -1 });
  await db.collection(OPPORTUNITIES_COLLECTION).createIndex({ tenant_id: 1, alumni_contact_id: 1 });
  await db.collection(ACTIVITY_COLLECTION).createIndex({ tenant_id: 1, entity_type: 1, entity_id: 1, created_at: -1 });
}

async function logActivity(params: {
  tenantId: string;
  actorUserId: string;
  entityType: "contact" | "opportunity";
  entityId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}) {
  const db = await getMongoDb();
  await db.collection(ACTIVITY_COLLECTION).insertOne({
    id: randomUUID(),
    tenant_id: params.tenantId,
    actor_user_id: params.actorUserId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    event_type: params.eventType,
    payload: params.payload ?? {},
    created_at: nowIso(),
  });
}

function toContact(doc: Record<string, unknown>) {
  return {
    id: String(doc.id),
    fullName: String(doc.full_name),
    branch: String(doc.branch),
    graduationYear: String(doc.graduation_year),
    company: String(doc.company),
    role: String(doc.role),
    location: doc.location ? String(doc.location) : null,
    linkedinUrl: doc.linkedin_url ? String(doc.linkedin_url) : null,
    email: doc.email ? String(doc.email) : null,
    phone: doc.phone ? String(doc.phone) : null,
    canRefer: Boolean(doc.can_refer),
    canMentor: Boolean(doc.can_mentor),
    isHiring: Boolean(doc.is_hiring),
    notes: doc.notes ? String(doc.notes) : null,
    verificationStatus: String(doc.verification_status) as AlumniVerificationStatus,
    createdAt: String(doc.created_at),
    updatedAt: String(doc.updated_at),
  };
}

function toOpportunity(
  doc: Record<string, unknown>,
  contact?: Record<string, unknown> | null,
  drive?: Record<string, unknown> | null,
) {
  return {
    id: String(doc.id),
    type: String(doc.type) as AlumniOpportunityType,
    title: String(doc.title),
    description: String(doc.description),
    status: String(doc.status) as AlumniOpportunityStatus,
    branches: Array.isArray(doc.branches) ? doc.branches.map((value) => String(value)) : [],
    batches: Array.isArray(doc.batches) ? doc.batches.map((value) => String(value)) : [],
    academicYears: Array.isArray(doc.academic_years) ? doc.academic_years.map((value) => String(value) as AcademicYear) : [],
    driveId: doc.drive_id ? String(doc.drive_id) : null,
    studentIds: Array.isArray(doc.student_ids) ? doc.student_ids.map((value) => String(value)) : [],
    notes: doc.notes ? String(doc.notes) : null,
    createdAt: String(doc.created_at),
    updatedAt: String(doc.updated_at),
    alumniContact: contact ? {
      id: String(contact.id),
      fullName: String(contact.full_name),
      company: String(contact.company),
      role: String(contact.role),
      branch: String(contact.branch),
      graduationYear: String(contact.graduation_year),
      canRefer: Boolean(contact.can_refer),
      canMentor: Boolean(contact.can_mentor),
      isHiring: Boolean(contact.is_hiring),
      verificationStatus: String(contact.verification_status) as AlumniVerificationStatus,
    } : null,
    linkedDrive: drive ? {
      id: String(drive.id),
      company: String(drive.company),
      role: drive.role ? String(drive.role) : null,
      driveDate: drive.drive_date ? String(drive.drive_date) : null,
    } : null,
  };
}

async function resolveContactsById(tenantId: string, ids: string[]) {
  const db = await getMongoDb();
  if (ids.length === 0) return new Map<string, Record<string, unknown>>();
  const rows = await db.collection(CONTACTS_COLLECTION).find(
    { tenant_id: tenantId, id: { $in: ids } },
    { projection: { _id: 0 } },
  ).toArray();
  return new Map(rows.map((row) => [String(row.id), row as Record<string, unknown>]));
}

async function resolveDrivesById(tenantId: string, ids: string[]) {
  const db = await getMongoDb();
  if (ids.length === 0) return new Map<string, Record<string, unknown>>();
  const rows = await db.collection("drives").find(
    { tenant_id: tenantId, id: { $in: ids }, deleted_at: null },
    { projection: { _id: 0, id: 1, company: 1, role: 1, drive_date: 1 } },
  ).toArray();
  return new Map(rows.map((row) => [String(row.id), row as Record<string, unknown>]));
}

export const AlumniService = {
  async listContacts(input: {
    tenantId: string;
    q?: string;
    branch?: string;
    verificationStatus?: AlumniVerificationStatus;
    canRefer?: boolean;
    isHiring?: boolean;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { tenant_id: input.tenantId };
    if (input.branch) filter.branch = input.branch;
    if (input.verificationStatus) filter.verification_status = input.verificationStatus;
    if (input.canRefer !== undefined) filter.can_refer = input.canRefer;
    if (input.isHiring !== undefined) filter.is_hiring = input.isHiring;
    if (input.q) {
      const regex = new RegExp(escapeRegex(input.q), "i");
      filter.$or = [
        { full_name: regex },
        { company: regex },
        { role: regex },
        { email: regex },
      ];
    }
    const rows = await db.collection(CONTACTS_COLLECTION).find(filter, { projection: { _id: 0 } }).sort({ updated_at: -1 }).toArray();
    return rows.map((row) => toContact(row as Record<string, unknown>));
  },

  async createContact(input: {
    tenantId: string;
    actorUserId: string;
    fullName: string;
    branch: string;
    graduationYear: string;
    company: string;
    role: string;
    location?: string;
    linkedinUrl?: string;
    email?: string;
    phone?: string;
    canRefer: boolean;
    canMentor: boolean;
    isHiring: boolean;
    notes?: string;
    verificationStatus: AlumniVerificationStatus;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const now = nowIso();
    const doc = {
      id: randomUUID(),
      tenant_id: input.tenantId,
      full_name: input.fullName.trim(),
      branch: input.branch.trim(),
      graduation_year: input.graduationYear.trim(),
      company: input.company.trim(),
      role: input.role.trim(),
      location: cleanString(input.location),
      linkedin_url: cleanString(input.linkedinUrl),
      email: cleanString(input.email),
      phone: cleanString(input.phone),
      can_refer: input.canRefer,
      can_mentor: input.canMentor,
      is_hiring: input.isHiring,
      notes: cleanString(input.notes),
      verification_status: input.verificationStatus,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
      created_at: now,
      updated_at: now,
    };

    await db.collection(CONTACTS_COLLECTION).insertOne(doc);
    await logActivity({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      entityType: "contact",
      entityId: doc.id,
      eventType: "created",
    });
    return toContact(doc);
  },

  async updateContact(input: {
    tenantId: string;
    actorUserId: string;
    contactId: string;
    fullName?: string;
    branch?: string;
    graduationYear?: string;
    company?: string;
    role?: string;
    location?: string;
    linkedinUrl?: string;
    email?: string;
    phone?: string;
    canRefer?: boolean;
    canMentor?: boolean;
    isHiring?: boolean;
    notes?: string;
    verificationStatus?: AlumniVerificationStatus;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const update: Record<string, unknown> = { updated_at: nowIso(), updated_by: input.actorUserId };
    if (input.fullName !== undefined) update.full_name = input.fullName.trim();
    if (input.branch !== undefined) update.branch = input.branch.trim();
    if (input.graduationYear !== undefined) update.graduation_year = input.graduationYear.trim();
    if (input.company !== undefined) update.company = input.company.trim();
    if (input.role !== undefined) update.role = input.role.trim();
    if (input.location !== undefined) update.location = cleanString(input.location);
    if (input.linkedinUrl !== undefined) update.linkedin_url = cleanString(input.linkedinUrl);
    if (input.email !== undefined) update.email = cleanString(input.email);
    if (input.phone !== undefined) update.phone = cleanString(input.phone);
    if (input.canRefer !== undefined) update.can_refer = input.canRefer;
    if (input.canMentor !== undefined) update.can_mentor = input.canMentor;
    if (input.isHiring !== undefined) update.is_hiring = input.isHiring;
    if (input.notes !== undefined) update.notes = cleanString(input.notes);
    if (input.verificationStatus !== undefined) update.verification_status = input.verificationStatus;

    const result = await db.collection(CONTACTS_COLLECTION).findOneAndUpdate(
      { tenant_id: input.tenantId, id: input.contactId },
      { $set: update },
      { projection: { _id: 0 }, returnDocument: "after" },
    );
    if (!result) {
      throw new AppError("ALUMNI_CONTACT_NOT_FOUND", "Alumni contact not found", 404);
    }
    await logActivity({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      entityType: "contact",
      entityId: input.contactId,
      eventType: "updated",
    });
    return toContact(result as Record<string, unknown>);
  },

  async listOpportunities(input: {
    tenantId: string;
    q?: string;
    type?: AlumniOpportunityType;
    status?: AlumniOpportunityStatus;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { tenant_id: input.tenantId };
    if (input.type) filter.type = input.type;
    if (input.status) filter.status = input.status;
    if (input.q) {
      const regex = new RegExp(escapeRegex(input.q), "i");
      filter.$or = [{ title: regex }, { description: regex }, { notes: regex }];
    }

    const rows = await db.collection(OPPORTUNITIES_COLLECTION).find(filter, { projection: { _id: 0 } }).sort({ updated_at: -1 }).toArray();
    const contactMap = await resolveContactsById(input.tenantId, [...new Set(rows.map((row) => String(row.alumni_contact_id ?? "")).filter(Boolean))]);
    const driveMap = await resolveDrivesById(input.tenantId, [...new Set(rows.map((row) => String(row.drive_id ?? "")).filter(Boolean))]);
    return rows.map((row) => toOpportunity(
      row as Record<string, unknown>,
      contactMap.get(String(row.alumni_contact_id ?? "")) ?? null,
      driveMap.get(String(row.drive_id ?? "")) ?? null,
    ));
  },

  async createOpportunity(input: {
    tenantId: string;
    actorUserId: string;
    type: AlumniOpportunityType;
    title: string;
    description: string;
    alumniContactId: string;
    branches: string[];
    batches: string[];
    academicYears: AcademicYear[];
    driveId?: string | null;
    status: AlumniOpportunityStatus;
    studentIds: string[];
    notes?: string;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const contact = await db.collection(CONTACTS_COLLECTION).findOne(
      { tenant_id: input.tenantId, id: input.alumniContactId },
      { projection: { _id: 0 } },
    );
    if (!contact) {
      throw new AppError("ALUMNI_CONTACT_NOT_FOUND", "Alumni contact not found", 404);
    }

    const now = nowIso();
    const doc = {
      id: randomUUID(),
      tenant_id: input.tenantId,
      type: input.type,
      title: input.title.trim(),
      description: input.description.trim(),
      alumni_contact_id: input.alumniContactId,
      branches: input.branches,
      batches: input.batches,
      academic_years: input.academicYears,
      drive_id: cleanString(input.driveId),
      status: input.status,
      student_ids: input.studentIds,
      notes: cleanString(input.notes),
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
      created_at: now,
      updated_at: now,
    };

    await db.collection(OPPORTUNITIES_COLLECTION).insertOne(doc);
    await logActivity({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      entityType: "opportunity",
      entityId: doc.id,
      eventType: "created",
      payload: { type: input.type, status: input.status },
    });
    return toOpportunity(doc, contact as Record<string, unknown>, null);
  },

  async updateOpportunity(input: {
    tenantId: string;
    actorUserId: string;
    opportunityId: string;
    type?: AlumniOpportunityType;
    title?: string;
    description?: string;
    alumniContactId?: string;
    branches?: string[];
    batches?: string[];
    academicYears?: AcademicYear[];
    driveId?: string | null;
    status?: AlumniOpportunityStatus;
    studentIds?: string[];
    notes?: string;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    if (input.alumniContactId) {
      const contact = await db.collection(CONTACTS_COLLECTION).findOne(
        { tenant_id: input.tenantId, id: input.alumniContactId },
        { projection: { _id: 0, id: 1 } },
      );
      if (!contact) {
        throw new AppError("ALUMNI_CONTACT_NOT_FOUND", "Alumni contact not found", 404);
      }
    }

    const update: Record<string, unknown> = { updated_at: nowIso(), updated_by: input.actorUserId };
    if (input.type !== undefined) update.type = input.type;
    if (input.title !== undefined) update.title = input.title.trim();
    if (input.description !== undefined) update.description = input.description.trim();
    if (input.alumniContactId !== undefined) update.alumni_contact_id = input.alumniContactId;
    if (input.branches !== undefined) update.branches = input.branches;
    if (input.batches !== undefined) update.batches = input.batches;
    if (input.academicYears !== undefined) update.academic_years = input.academicYears;
    if (input.driveId !== undefined) update.drive_id = cleanString(input.driveId);
    if (input.status !== undefined) update.status = input.status;
    if (input.studentIds !== undefined) update.student_ids = input.studentIds;
    if (input.notes !== undefined) update.notes = cleanString(input.notes);

    const result = await db.collection(OPPORTUNITIES_COLLECTION).findOneAndUpdate(
      { tenant_id: input.tenantId, id: input.opportunityId },
      { $set: update },
      { projection: { _id: 0 }, returnDocument: "after" },
    );
    if (!result) {
      throw new AppError("ALUMNI_OPPORTUNITY_NOT_FOUND", "Alumni opportunity not found", 404);
    }

    await logActivity({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      entityType: "opportunity",
      entityId: input.opportunityId,
      eventType: "updated",
    });

    const [contactMap, driveMap] = await Promise.all([
      resolveContactsById(input.tenantId, [String(result.alumni_contact_id ?? "")].filter(Boolean)),
      resolveDrivesById(input.tenantId, [String(result.drive_id ?? "")].filter(Boolean)),
    ]);
    return toOpportunity(
      result as Record<string, unknown>,
      contactMap.get(String(result.alumni_contact_id ?? "")) ?? null,
      driveMap.get(String(result.drive_id ?? "")) ?? null,
    );
  },

  async listStudentOpportunities(tenantId: string, userId: string) {
    await ensureIndexes();
    const db = await getMongoDb();
    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, user_id: userId },
      { projection: { _id: 0, id: 1, branch: 1, batch: 1, profile_data: 1 } },
    );
    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student record not found", 404);
    }

    const academicYear = deriveAcademicYear((student.profile_data as Record<string, unknown> | undefined)?.currentSemester);
    const rows = await db.collection(OPPORTUNITIES_COLLECTION).find(
      { tenant_id: tenantId, status: "active" },
      { projection: { _id: 0 } },
    ).sort({ updated_at: -1 }).toArray();

    const filtered = rows.filter((row) => {
      const branches = Array.isArray(row.branches) ? row.branches.map((value) => String(value)) : [];
      const batches = Array.isArray(row.batches) ? row.batches.map((value) => String(value)) : [];
      const academicYears = Array.isArray(row.academic_years) ? row.academic_years.map((value) => String(value)) : [];
      const studentIds = Array.isArray(row.student_ids) ? row.student_ids.map((value) => String(value)) : [];

      const branchAllowed = branches.length === 0 || branches.includes(String(student.branch ?? ""));
      const batchAllowed = batches.length === 0 || batches.includes(String(student.batch ?? ""));
      const yearAllowed = academicYears.length === 0 || (academicYear !== null && academicYears.includes(academicYear));
      const studentAllowed = studentIds.length === 0 || studentIds.includes(String(student.id));
      return branchAllowed && batchAllowed && yearAllowed && studentAllowed;
    });

    const contactMap = await resolveContactsById(tenantId, [...new Set(filtered.map((row) => String(row.alumni_contact_id ?? "")).filter(Boolean))]);
    const driveMap = await resolveDrivesById(tenantId, [...new Set(filtered.map((row) => String(row.drive_id ?? "")).filter(Boolean))]);

    return filtered.map((row) => toOpportunity(
      row as Record<string, unknown>,
      contactMap.get(String(row.alumni_contact_id ?? "")) ?? null,
      driveMap.get(String(row.drive_id ?? "")) ?? null,
    ));
  },
};
