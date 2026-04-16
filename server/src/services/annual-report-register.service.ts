import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { getMongoDb } from "../utils/mongodb.js";

export type AnnualRegisterType =
  | "training_activities"
  | "industrial_inplant_training"
  | "higher_education_abroad"
  | "industrial_visit";

export interface TrainingActivityPayload {
  programName: string;
  date: string;
  conductedBy: string;
}

export interface IndustrialInplantTrainingPayload {
  studentName: string;
  companyName: string;
  mode: "online" | "offline";
  fromDate: string;
  toDate: string;
  programme: string;
}

export interface HigherEducationPayload {
  studentName: string;
  programme: string;
  coursePursuing: string;
  instituteName: string;
  country: string;
}

export interface IndustrialVisitPayload {
  companyName: string;
  studentCount: number;
  visitDate: string;
}

export type AnnualRegisterPayload =
  | TrainingActivityPayload
  | IndustrialInplantTrainingPayload
  | HigherEducationPayload
  | IndustrialVisitPayload;

interface AnnualRegisterDocument {
  id: string;
  tenant_id: string;
  register_type: AnnualRegisterType;
  academic_year: string;
  branch: string | null;
  payload: AnnualRegisterPayload;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnnualRegisterEntry {
  id: string;
  registerType: AnnualRegisterType;
  academicYear: string;
  branch: string | null;
  payload: AnnualRegisterPayload;
  createdAt: string;
  updatedAt: string;
}

export type SaveAnnualRegisterInput =
  | {
      registerType: "training_activities";
      academicYear: string;
      branch?: string | null;
      payload: TrainingActivityPayload;
    }
  | {
      registerType: "industrial_inplant_training";
      academicYear: string;
      branch?: string | null;
      payload: IndustrialInplantTrainingPayload;
    }
  | {
      registerType: "higher_education_abroad";
      academicYear: string;
      branch?: string | null;
      payload: HigherEducationPayload;
    }
  | {
      registerType: "industrial_visit";
      academicYear: string;
      branch?: string | null;
      payload: IndustrialVisitPayload;
    };

const COLLECTION = "annual_report_register_entries";

function normalizeOptionalText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeDate(value: string) {
  return String(value).slice(0, 10);
}

function normalizePayload(input: SaveAnnualRegisterInput): AnnualRegisterPayload {
  switch (input.registerType) {
    case "training_activities":
      return {
        programName: input.payload.programName.trim(),
        date: normalizeDate(input.payload.date),
        conductedBy: input.payload.conductedBy.trim(),
      };
    case "industrial_inplant_training":
      return {
        studentName: input.payload.studentName.trim(),
        companyName: input.payload.companyName.trim(),
        mode: input.payload.mode,
        fromDate: normalizeDate(input.payload.fromDate),
        toDate: normalizeDate(input.payload.toDate),
        programme: input.payload.programme.trim(),
      };
    case "higher_education_abroad":
      return {
        studentName: input.payload.studentName.trim(),
        programme: input.payload.programme.trim(),
        coursePursuing: input.payload.coursePursuing.trim(),
        instituteName: input.payload.instituteName.trim(),
        country: input.payload.country.trim(),
      };
    case "industrial_visit":
      return {
        companyName: input.payload.companyName.trim(),
        studentCount: Number(input.payload.studentCount),
        visitDate: normalizeDate(input.payload.visitDate),
      };
  }
}

function mapDocument(doc: AnnualRegisterDocument): AnnualRegisterEntry {
  return {
    id: doc.id,
    registerType: doc.register_type,
    academicYear: doc.academic_year,
    branch: doc.branch,
    payload: doc.payload,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
  };
}

function sortKey(entry: AnnualRegisterEntry) {
  switch (entry.registerType) {
    case "training_activities":
      return (entry.payload as TrainingActivityPayload).date;
    case "industrial_inplant_training":
      return (entry.payload as IndustrialInplantTrainingPayload).fromDate;
    case "industrial_visit":
      return (entry.payload as IndustrialVisitPayload).visitDate;
    case "higher_education_abroad":
      return entry.updatedAt;
  }
}

export const AnnualReportRegisterService = {
  async listEntries(
    tenantId: string,
    query: { academicYear?: string; branch?: string; registerType?: AnnualRegisterType },
  ) {
    const db = await getMongoDb();
    const normalizedBranch = normalizeOptionalText(query.branch);
    const filter: Record<string, unknown> = { tenant_id: tenantId };

    if (query.academicYear) {
      filter.academic_year = query.academicYear.trim();
    }

    if (query.registerType) {
      filter.register_type = query.registerType;
    }

    if (normalizedBranch) {
      filter.$or = [
        { branch: normalizedBranch },
        { branch: null },
      ];
    }

    const docs = await db.collection(COLLECTION).find(
      filter,
      { projection: { _id: 0 } },
    ).toArray() as unknown as AnnualRegisterDocument[];

    return docs
      .map(mapDocument)
      .sort((a, b) => {
        const byType = a.registerType.localeCompare(b.registerType);
        if (byType !== 0) return byType;
        const byDate = sortKey(a).localeCompare(sortKey(b));
        if (byDate !== 0) return byDate;
        return a.createdAt.localeCompare(b.createdAt);
      });
  },

  async createEntry(tenantId: string, actorUserId: string, input: SaveAnnualRegisterInput) {
    const db = await getMongoDb();
    const now = new Date().toISOString();
    const doc: AnnualRegisterDocument = {
      id: randomUUID(),
      tenant_id: tenantId,
      register_type: input.registerType,
      academic_year: input.academicYear.trim(),
      branch: normalizeOptionalText(input.branch),
      payload: normalizePayload(input),
      created_by: actorUserId,
      updated_by: actorUserId,
      created_at: now,
      updated_at: now,
    };

    await db.collection(COLLECTION).insertOne(doc);
    return mapDocument(doc);
  },

  async updateEntry(tenantId: string, entryId: string, actorUserId: string, input: SaveAnnualRegisterInput) {
    const db = await getMongoDb();
    const existing = await db.collection(COLLECTION).findOne(
      { tenant_id: tenantId, id: entryId },
      { projection: { _id: 0 } },
    ) as unknown as AnnualRegisterDocument | null;

    if (!existing) {
      throw new AppError("ANNUAL_REGISTER_ENTRY_NOT_FOUND", "Annual report register entry not found.", 404);
    }

    const updatedAt = new Date().toISOString();
    const patch = {
      register_type: input.registerType,
      academic_year: input.academicYear.trim(),
      branch: normalizeOptionalText(input.branch),
      payload: normalizePayload(input),
      updated_by: actorUserId,
      updated_at: updatedAt,
    };

    await db.collection(COLLECTION).updateOne(
      { tenant_id: tenantId, id: entryId },
      { $set: patch },
    );

    return mapDocument({
      ...existing,
      id: entryId,
      register_type: patch.register_type,
      academic_year: patch.academic_year,
      branch: patch.branch,
      payload: patch.payload,
      updated_by: actorUserId,
      updated_at: updatedAt,
    });
  },

  async deleteEntry(tenantId: string, entryId: string) {
    const db = await getMongoDb();
    const result = await db.collection(COLLECTION).deleteOne({ tenant_id: tenantId, id: entryId });
    if (result.deletedCount === 0) {
      throw new AppError("ANNUAL_REGISTER_ENTRY_NOT_FOUND", "Annual report register entry not found.", 404);
    }
    return { id: entryId, deleted: true };
  },
};
