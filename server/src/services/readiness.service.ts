import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";
import { getMongoDb } from "../utils/mongodb.js";
import { buildStudentDeclarationStatus } from "../utils/student-declaration.js";
import { buildStudentProfileSummary, normalizeStudentProfileData } from "../utils/student-profile.js";
import { evaluateStudentEligibility } from "./eligibility.logic.js";
import { computeReadinessScore } from "./readiness.logic.js";

function inferAcademicYear(currentSemester: unknown): "first_year" | "second_year" | "third_year" | "final_year" | undefined {
  const raw = String(currentSemester ?? "").trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return undefined;
  if (parsed >= 1 && parsed <= 2) return "first_year";
  if (parsed >= 3 && parsed <= 4) return "second_year";
  if (parsed >= 5 && parsed <= 6) return "third_year";
  if (parsed >= 7 && parsed <= 8) return "final_year";
  return undefined;
}

export const ReadinessService = {
  async calculate(tenantId: string, studentId: string): Promise<number> {
    const db = await getMongoDb();
    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, id: studentId },
      {
        projection: {
          id: 1,
          user_id: 1,
          full_name: 1,
          college_email: 1,
          cgpa: 1,
          backlogs: 1,
          backlogs_total: 1,
          branch: 1,
          attendance_pct: 1,
          profile_data: 1,
        },
      },
    );

    if (!student) {
      return 0;
    }

    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const recentMockThreshold = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const recentApplicationThreshold = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString();

    const [user, attempts, mastery, driveResults, upcomingDrives, tenant] = await Promise.all([
      student.user_id
        ? db.collection("users").findOne(
            { tenant_id: tenantId, id: String(student.user_id) },
            { projection: { _id: 0, full_name: 1, email: 1 } },
          )
        : Promise.resolve(null),
      db.collection("student_attempts").find(
        { tenant_id: tenantId, student_id: studentId, status: "submitted" },
        { projection: { score: 1, submitted_at: 1 } },
      ).toArray(),
      db.collection("topic_mastery").find(
        { tenant_id: tenantId, student_id: studentId },
        { projection: { mastery_level: 1 } },
      ).toArray(),
      db.collection("drive_results").find(
        {
          tenant_id: tenantId,
          student_id: studentId,
          $or: [
            { created_at: { $gte: recentApplicationThreshold } },
            { updated_at: { $gte: recentApplicationThreshold } },
          ],
        },
        { projection: { status: 1, outcome: 1 } },
      ).toArray(),
      db.collection("drives").find(
        {
          tenant_id: tenantId,
          deleted_at: null,
          status: { $in: ["published", "upcoming"] },
          drive_date: { $gte: todayIso },
        },
        { projection: { criteria: 1 } },
      ).toArray(),
      MongoAuthRepository.findTenantById(tenantId),
    ]);

    const userLike = {
      full_name: user?.full_name ?? student.full_name,
      email: user?.email ?? student.college_email,
    };
    const profileSummary = buildStudentProfileSummary({
      student,
      user: userLike,
    });
    const declarationStatus = buildStudentDeclarationStatus({
      student,
      user: userLike,
    });
    const normalizedProfile = normalizeStudentProfileData(student.profile_data);
    const academicYear = inferAcademicYear(normalizedProfile.currentSemester);
    const hasResume = Boolean(
      profileSummary.studentEditableProfile.resumeDriveWebLink
      || profileSummary.studentEditableProfile.resumeUrl,
    );
    const tenantConfig = tenant?.config && typeof tenant.config === "object"
      ? tenant.config as Record<string, unknown>
      : {};
    const placementPolicy = tenantConfig.placementPolicy && typeof tenantConfig.placementPolicy === "object"
      ? tenantConfig.placementPolicy as Record<string, unknown>
      : {};
    const excludePlacedStudentsByDefault = placementPolicy.excludePlacedStudentsByDefault === true;
    const placementStatus = student.profile_data && typeof student.profile_data === "object"
      ? (student.profile_data as Record<string, unknown>).placementStatus
      : null;
    const isPlaced = Boolean(
      placementStatus
      && typeof placementStatus === "object"
      && (placementStatus as Record<string, unknown>).isPlaced === true,
    );

    const avgTestScore =
      attempts.reduce((sum, row) => sum + Number(row.score ?? 0), 0) /
      Math.max(attempts.length, 1);
    const avgMastery =
      mastery.reduce((sum, row) => sum + Number(row.mastery_level ?? 0), 0) /
      Math.max(mastery.length, 1);
    const recentMockAttempts14d = attempts.filter((row) => {
      const submittedAt = String(row.submitted_at ?? "");
      return submittedAt.length > 0 && submittedAt >= recentMockThreshold;
    }).length;
    const eligibleUpcomingDrives = upcomingDrives.filter((drive) => {
      const criteria = drive.criteria && typeof drive.criteria === "object"
        ? drive.criteria as Record<string, unknown>
        : {};
      return evaluateStudentEligibility(
        {
          cgpa: Number(student.cgpa ?? 0),
          activeBacklogs: Number(student.backlogs ?? 0),
          totalBacklogs: Number(student.backlogs_total ?? 0),
          branch: String(student.branch ?? ""),
          academicYear,
          attendancePct: Number(student.attendance_pct ?? 0),
          isPlaced,
        },
        {
          minCgpa: criteria.minCgpa === undefined ? undefined : Number(criteria.minCgpa),
          maxBacklogs: criteria.maxBacklogs === undefined ? undefined : Number(criteria.maxBacklogs),
          maxActiveBacklogs: criteria.maxActiveBacklogs === undefined ? undefined : Number(criteria.maxActiveBacklogs),
          maxTotalBacklogs: criteria.maxTotalBacklogs === undefined ? undefined : Number(criteria.maxTotalBacklogs),
          branches: Array.isArray(criteria.branches) ? criteria.branches.map((value) => String(value)) : undefined,
          academicYears: Array.isArray(criteria.academicYears) ? criteria.academicYears.map((value) => String(value) as "first_year" | "second_year" | "third_year" | "final_year") : undefined,
          minAttendance: criteria.minAttendance === undefined ? undefined : Number(criteria.minAttendance),
          excludePlacedStudents: excludePlacedStudentsByDefault || criteria.excludePlacedStudents === true,
        },
      ).eligible;
    }).length;
    const appliedRecently = driveResults.some((row) => {
      const status = String(row.status ?? "").toLowerCase();
      const outcome = String(row.outcome ?? "").toLowerCase();
      return ["applied", "shortlisted", "selected", "waitlisted"].includes(status)
        || ["applied", "shortlisted", "selected", "waitlisted"].includes(outcome);
    });

    const normalized = computeReadinessScore({
      profileCompletenessPct: profileSummary.profileCompleteness.pct,
      isCertified: declarationStatus.profileCertification.isCertified,
      hasResume,
      avgTestScore: attempts.length > 0 ? avgTestScore : null,
      avgMastery: mastery.length > 0 ? avgMastery : null,
      totalSubmittedAttempts: attempts.length,
      recentMockAttempts14d,
      eligibleUpcomingDrives,
      appliedRecently,
    });

    await db.collection("students").updateOne(
      { tenant_id: tenantId, id: studentId },
      { $set: { readiness_score: normalized } },
    );

    return normalized;
  },
};
