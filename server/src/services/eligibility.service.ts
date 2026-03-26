import {
  DriveRepository,
  type DriveCriteria,
  type EligibilityReasonCount,
} from "../repositories/drive.repository.js";
import {
  ELIGIBILITY_REASON_LABELS,
  evaluateStudentEligibility,
  type EligibilityCriteria,
  type EligibilityReasonCode,
} from "./eligibility.logic.js";

export { isStudentEligible } from "./eligibility.logic.js";

function emptyReasonCounts(): Record<EligibilityReasonCode, number> {
  return {
    cgpa_below_min: 0,
    active_backlogs_above_max: 0,
    total_backlogs_above_max: 0,
    branch_not_allowed: 0,
    attendance_below_min: 0,
    already_placed: 0,
    manual_override_ineligible: 0,
  };
}

function toReasonSummary(reasonCounts: Record<EligibilityReasonCode, number>): EligibilityReasonCount[] {
  return (Object.keys(reasonCounts) as EligibilityReasonCode[])
    .map((code) => ({
      code,
      label: ELIGIBILITY_REASON_LABELS[code],
      count: reasonCounts[code],
    }))
    .filter((item) => item.count > 0);
}

async function buildEligibilityReport(tenantId: string, criteria: EligibilityCriteria, driveId?: string) {
  const students = await DriveRepository.listStudentsForEligibilityPool(tenantId);

  // Manual overrides are drive-specific, not part of the preview flow.
  const overrideMap = driveId
    ? await DriveRepository.getEligibilityOverrideMap(tenantId, driveId)
    : new Map<string, "eligible" | "not_eligible">();

  // "Already placed" is tenant policy / drive policy.
  // We interpret outcome==="selected" as "placed" for now (offer secured).
  const placedStudentIds = criteria.excludePlacedStudents
    ? new Set(
        (await DriveRepository.listPlacedStudentIds(tenantId)).map(String),
      )
    : new Set<string>();

  const reasonCounts = emptyReasonCounts();
  const eligibleStudents = [];

  for (const student of students) {
    const override = overrideMap.get(student.id);
    if (override === "eligible") {
      eligibleStudents.push(student);
      continue;
    }
    if (override === "not_eligible") {
      reasonCounts.manual_override_ineligible += 1;
      continue;
    }

    if (criteria.excludePlacedStudents && placedStudentIds.has(student.id)) {
      reasonCounts.already_placed += 1;
      continue;
    }

    const evaluation = evaluateStudentEligibility(
      {
        cgpa: student.cgpa,
        activeBacklogs: student.backlogs,
        totalBacklogs: student.backlogsTotal,
        branch: student.branch,
        attendancePct: student.attendancePct,
      },
      criteria,
    );

    if (evaluation.eligible) {
      eligibleStudents.push(student);
      continue;
    }

    evaluation.reasons.forEach((reason) => {
      reasonCounts[reason] += 1;
    });
  }

  const totalStudents = students.length;
  const eligibleCount = eligibleStudents.length;
  const ineligibleCount = Math.max(0, totalStudents - eligibleCount);

  return {
    criteria: criteria as DriveCriteria,
    totalStudents,
    eligibleCount,
    ineligibleCount,
    eligibleRate: totalStudents > 0 ? Number(((eligibleCount / totalStudents) * 100).toFixed(2)) : 0,
    reasons: toReasonSummary(reasonCounts),
    eligibleStudents,
    topEligibleStudents: eligibleStudents.slice(0, 10),
  };
}

export const EligibilityService = {
  async preview(tenantId: string, criteria: EligibilityCriteria) {
    const report = await buildEligibilityReport(tenantId, criteria);

    return {
      criteria: report.criteria,
      totalStudents: report.totalStudents,
      eligibleCount: report.eligibleCount,
      ineligibleCount: report.ineligibleCount,
      eligibleRate: report.eligibleRate,
      reasons: report.reasons,
      topEligibleStudents: report.topEligibleStudents,
    };
  },

  async compute(tenantId: string, driveId: string, computedBy: string) {
    const drive = await DriveRepository.getDriveCriteria(tenantId, driveId);
    const criteria = (drive.criteria ?? {}) as EligibilityCriteria;
    const report = await buildEligibilityReport(tenantId, criteria, driveId);
    const eligibleStudents = report.eligibleStudents;

    await DriveRepository.syncDriveEligibility(
      tenantId,
      driveId,
      eligibleStudents.map((student) => student.id),
    );
    await DriveRepository.updateDriveEligibleCount(tenantId, driveId, eligibleStudents.length);
    const snapshot = await DriveRepository.createEligibilitySnapshot(tenantId, driveId, {
      criteria: report.criteria,
      totalStudents: report.totalStudents,
      eligibleCount: report.eligibleCount,
      ineligibleCount: report.ineligibleCount,
      reasons: report.reasons,
      computedBy,
    });

    return {
      driveId,
      eligibleCount: report.eligibleCount,
      totalStudents: report.totalStudents,
      ineligibleCount: report.ineligibleCount,
      eligibleRate: report.eligibleRate,
      reasons: report.reasons,
      snapshot,
      criteria: report.criteria,
      students: eligibleStudents,
    };
  },
};
