import { DriveRepository } from "../repositories/drive.repository.js";
import type { EligibilityCriteria } from "./eligibility.logic.js";
export { isStudentEligible } from "./eligibility.logic.js";

export const EligibilityService = {
  async compute(tenantId: string, driveId: string) {
    const drive = await DriveRepository.getDriveCriteria(tenantId, driveId);
    const criteria = (drive.criteria ?? {}) as EligibilityCriteria;

    const eligibleStudents = await DriveRepository.listStudentsForEligibility(tenantId, criteria);
    await DriveRepository.replaceDriveResults(
      tenantId,
      driveId,
      eligibleStudents.map((student) => student.id),
    );
    await DriveRepository.updateDriveEligibleCount(tenantId, driveId, eligibleStudents.length);

    return {
      driveId,
      eligibleCount: eligibleStudents.length,
      criteria,
      students: eligibleStudents,
    };
  },
};
