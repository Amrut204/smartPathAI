import { getMongoDb } from "../utils/mongodb.js";
import { computeReadinessScore } from "./readiness.logic.js";

export const ReadinessService = {
  async calculate(tenantId: string, studentId: string): Promise<number> {
    const db = await getMongoDb();

    const [attempts, mastery, studyHours, student] = await Promise.all([
      db.collection("student_attempts").find(
        { tenant_id: tenantId, student_id: studentId, status: "submitted" },
        { projection: { score: 1 } },
      ).toArray(),
      db.collection("topic_mastery").find(
        { tenant_id: tenantId, student_id: studentId },
        { projection: { mastery_level: 1 } },
      ).toArray(),
      db.collection("study_hours").find(
        { tenant_id: tenantId, student_id: studentId },
        { projection: { hours: 1 } },
      ).toArray(),
      db.collection("students").findOne(
        { tenant_id: tenantId, id: studentId },
        { projection: { points: 1 } },
      ),
    ]);

    const avgTestScore =
      attempts.reduce((sum, row) => sum + Number(row.score ?? 0), 0) /
      Math.max(attempts.length, 1);

    const avgMastery =
      mastery.reduce((sum, row) => sum + Number(row.mastery_level ?? 0), 0) /
      Math.max(mastery.length, 1);

    const totalStudyHours = studyHours.reduce((sum, row) => sum + Number(row.hours ?? 0), 0);
    const points = Number(student?.points ?? 0);
    const normalized = computeReadinessScore({
      avgTestScore,
      avgMastery,
      totalStudyHours,
      points,
    });

    await db.collection("students").updateOne(
      { tenant_id: tenantId, id: studentId },
      { $set: { readiness_score: normalized } },
    );

    return normalized;
  },
};
