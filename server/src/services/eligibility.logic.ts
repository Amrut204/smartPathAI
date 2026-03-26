export interface EligibilityCriteria {
  minCgpa?: number;
  /**
   * Legacy field: historically we used a single "maxBacklogs".
   * Treat it as "maxActiveBacklogs" for backwards compatibility.
   */
  maxBacklogs?: number;
  /** Active backlogs (current/ongoing). */
  maxActiveBacklogs?: number;
  /** Total/historical backlogs (lifetime). */
  maxTotalBacklogs?: number;
  branches?: string[];
  minAttendance?: number;
  /**
   * College policy (or per-drive policy): once a student is placed (selected),
   * they should not be allowed to participate in future drives.
   */
  excludePlacedStudents?: boolean;
}

export type EligibilityReasonCode =
  | "cgpa_below_min"
  | "active_backlogs_above_max"
  | "total_backlogs_above_max"
  | "branch_not_allowed"
  | "attendance_below_min"
  | "already_placed"
  | "manual_override_ineligible";

export const ELIGIBILITY_REASON_LABELS: Record<EligibilityReasonCode, string> = {
  cgpa_below_min: "CGPA below minimum",
  active_backlogs_above_max: "Active backlogs above maximum",
  total_backlogs_above_max: "Total backlogs above maximum",
  branch_not_allowed: "Branch not in allowed list",
  attendance_below_min: "Attendance below minimum",
  already_placed: "Student already placed",
  manual_override_ineligible: "Manually marked not eligible",
};

export interface EligibilityEvaluation {
  eligible: boolean;
  reasons: EligibilityReasonCode[];
}

export function evaluateStudentEligibility(
  student: {
    cgpa: number;
    activeBacklogs: number;
    totalBacklogs: number;
    branch: string;
    attendancePct: number;
    isPlaced?: boolean;
  },
  criteria: EligibilityCriteria,
): EligibilityEvaluation {
  const reasons: EligibilityReasonCode[] = [];

  const maxActiveBacklogs = criteria.maxActiveBacklogs ?? criteria.maxBacklogs;

  if (criteria.minCgpa !== undefined && student.cgpa < criteria.minCgpa) {
    reasons.push("cgpa_below_min");
  }
  if (maxActiveBacklogs !== undefined && student.activeBacklogs > maxActiveBacklogs) {
    reasons.push("active_backlogs_above_max");
  }
  if (criteria.maxTotalBacklogs !== undefined && student.totalBacklogs > criteria.maxTotalBacklogs) {
    reasons.push("total_backlogs_above_max");
  }
  if (criteria.branches && criteria.branches.length > 0 && !criteria.branches.includes(student.branch)) {
    reasons.push("branch_not_allowed");
  }
  if (criteria.minAttendance !== undefined && student.attendancePct < criteria.minAttendance) {
    reasons.push("attendance_below_min");
  }
  if (criteria.excludePlacedStudents && student.isPlaced) {
    reasons.push("already_placed");
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

export function isStudentEligible(
  student: { cgpa: number; activeBacklogs: number; totalBacklogs: number; branch: string; attendancePct: number; isPlaced?: boolean },
  criteria: EligibilityCriteria,
): boolean {
  return evaluateStudentEligibility(student, criteria).eligible;
}
