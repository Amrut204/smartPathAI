// Points feature has been disabled and removed from the product.
// This service is kept as a no-op stub because mock-test.service.ts
// and student.service.ts still call it. The calls are harmless — they
// return 0 and write nothing to the database.

export const PointsService = {
  async awardStudyHoursPoints(_params: {
    tenantId: string;
    studentId: string;
    hours: number;
    studyHourId: string;
  }): Promise<number> {
    return 0;
  },

  async awardTestCompletionPoints(_params: {
    tenantId: string;
    studentId: string;
    scorePercent: number;
  }): Promise<number> {
    return 0;
  },
};
