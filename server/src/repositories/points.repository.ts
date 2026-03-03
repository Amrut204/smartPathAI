import { AppError } from "../middleware/error-handler.js";
import { getMongoDb } from "../utils/mongodb.js";

export const PointsRepository = {
  async getCurrentPoints(tenantId: string, studentId: string): Promise<number> {
    const db = await getMongoDb();
    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, id: studentId },
      { projection: { points: 1 } },
    );

    if (!student) {
      throw new AppError("POINTS_READ_FAILED", "Unable to read points", 500);
    }

    return Number(student.points ?? 0);
  },

  async setStudyHourAward(params: { tenantId: string; studentId: string; studyHourId: string; points: number }) {
    const db = await getMongoDb();
    const result = await db.collection("study_hours").updateOne(
      { tenant_id: params.tenantId, student_id: params.studentId, id: params.studyHourId },
      { $set: { points_awarded: params.points } },
    );

    if (result.matchedCount === 0) {
      throw new AppError("POINTS_UPDATE_FAILED", "Study hour entry not found", 500);
    }
  },

  async incrementStudentPoints(params: { tenantId: string; studentId: string; delta: number }) {
    const db = await getMongoDb();
    const result = await db.collection("students").updateOne(
      { tenant_id: params.tenantId, id: params.studentId },
      { $inc: { points: params.delta } },
    );

    if (result.matchedCount === 0) {
      throw new AppError("POINTS_UPDATE_FAILED", "Student not found", 500);
    }
  },
};
