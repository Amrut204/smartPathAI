import { PointsRepository } from "../repositories/points.repository.js";

export const PointsService = {
  async awardStudyHoursPoints(params: {
    tenantId: string;
    studentId: string;
    hours: number;
    studyHourId: string;
  }): Promise<number> {
    const pointsToAward = Math.max(1, Math.floor(params.hours * 10));

    await PointsRepository.setStudyHourAward({
      tenantId: params.tenantId,
      studentId: params.studentId,
      studyHourId: params.studyHourId,
      points: pointsToAward,
    });
    await PointsRepository.incrementStudentPoints({
      tenantId: params.tenantId,
      studentId: params.studentId,
      delta: pointsToAward,
    });

    return pointsToAward;
  },

  async awardTestCompletionPoints(params: {
    tenantId: string;
    studentId: string;
    scorePercent: number;
  }): Promise<number> {
    const pointsToAward = Math.max(5, Math.round(params.scorePercent / 2));
    await PointsRepository.incrementStudentPoints({
      tenantId: params.tenantId,
      studentId: params.studentId,
      delta: pointsToAward,
    });

    return pointsToAward;
  },
};
