import type { Request, Response, NextFunction } from "express";

import { AppError } from "./error-handler.js";
import { StudentRepository } from "../repositories/student.repository.js";
import { getMongoDb } from "../utils/mongodb.js";
import { buildStudentProfileSummary } from "../utils/student-profile.js";

async function getStudentProfileGateState(tenantId: string, userId: string) {
  const db = await getMongoDb();
  const [student, user] = await Promise.all([
    StudentRepository.getStudentByUserId(tenantId, userId),
    db.collection("users").findOne(
      { tenant_id: tenantId, id: userId },
      { projection: { _id: 0, full_name: 1, email: 1 } },
    ),
  ]);

  return buildStudentProfileSummary({
    student,
    user: {
      full_name: user?.full_name,
      email: user?.email,
    },
  });
}

export async function requireCompletedStudentProfile(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth || req.auth.role !== "student") {
    next();
    return;
  }

  const profile = await getStudentProfileGateState(req.auth.tenantId, req.auth.userId);
  if (profile.profileCompleteness.isComplete) {
    next();
    return;
  }

  throw new AppError(
    "PROFILE_INCOMPLETE",
    "Complete your profile to unlock resources and mock tests.",
    403,
    [
      ...profile.missingRequiredFields.map((field) => ({ field: field.key, message: `${field.label} is required.` })),
      { field: "completionPct", message: String(profile.profileCompleteness.pct) },
      { field: "nextStepUrl", message: "/profile" },
    ],
  );
}
