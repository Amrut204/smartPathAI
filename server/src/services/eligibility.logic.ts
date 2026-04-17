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
  tenthMarksMin?: number;
  tenthMarksMax?: number;
  twelfthMarksMin?: number;
  twelfthMarksMax?: number;
  diplomaMarksMin?: number;
  diplomaMarksMax?: number;
  minAttendance?: number;
  readinessMin?: number;
  profileCompletenessMin?: number;
  hasResume?: boolean;
  isCertified?: boolean;
  canAccessResources?: boolean;
  canAccessMockTests?: boolean;
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
  | "tenth_marks_below_min"
  | "tenth_marks_above_max"
  | "twelfth_marks_below_min"
  | "twelfth_marks_above_max"
  | "diploma_marks_below_min"
  | "diploma_marks_above_max"
  | "attendance_below_min"
  | "readiness_below_min"
  | "profile_completeness_below_min"
  | "resume_requirement_not_met"
  | "certification_requirement_not_met"
  | "resource_access_requirement_not_met"
  | "mock_test_access_requirement_not_met"
  | "already_placed"
  | "manual_override_ineligible";

export const ELIGIBILITY_REASON_LABELS: Record<EligibilityReasonCode, string> = {
  cgpa_below_min: "CGPA below minimum",
  active_backlogs_above_max: "Active backlogs above maximum",
  total_backlogs_above_max: "Total backlogs above maximum",
  branch_not_allowed: "Branch not in allowed list",
  tenth_marks_below_min: "10th marks below minimum",
  tenth_marks_above_max: "10th marks above maximum",
  twelfth_marks_below_min: "12th marks below minimum",
  twelfth_marks_above_max: "12th marks above maximum",
  diploma_marks_below_min: "Diploma marks below minimum",
  diploma_marks_above_max: "Diploma marks above maximum",
  attendance_below_min: "Attendance below minimum",
  readiness_below_min: "Readiness score below minimum",
  profile_completeness_below_min: "Profile completeness below minimum",
  resume_requirement_not_met: "Resume requirement not met",
  certification_requirement_not_met: "Profile certification requirement not met",
  resource_access_requirement_not_met: "Resource access requirement not met",
  mock_test_access_requirement_not_met: "Mock test access requirement not met",
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
    tenthMarks?: number;
    twelfthMarks?: number;
    diplomaMarks?: number;
    attendancePct: number;
    readinessScore?: number;
    profileCompletenessPct?: number;
    hasResumeReady?: boolean;
    isProfileCertified?: boolean;
    canAccessResources?: boolean;
    canAccessMockTests?: boolean;
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
  if (criteria.tenthMarksMin !== undefined && (student.tenthMarks === undefined || student.tenthMarks < criteria.tenthMarksMin)) {
    reasons.push("tenth_marks_below_min");
  }
  if (criteria.tenthMarksMax !== undefined && (student.tenthMarks === undefined || student.tenthMarks > criteria.tenthMarksMax)) {
    reasons.push("tenth_marks_above_max");
  }
  if (criteria.twelfthMarksMin !== undefined && (student.twelfthMarks === undefined || student.twelfthMarks < criteria.twelfthMarksMin)) {
    reasons.push("twelfth_marks_below_min");
  }
  if (criteria.twelfthMarksMax !== undefined && (student.twelfthMarks === undefined || student.twelfthMarks > criteria.twelfthMarksMax)) {
    reasons.push("twelfth_marks_above_max");
  }
  if (criteria.diplomaMarksMin !== undefined && (student.diplomaMarks === undefined || student.diplomaMarks < criteria.diplomaMarksMin)) {
    reasons.push("diploma_marks_below_min");
  }
  if (criteria.diplomaMarksMax !== undefined && (student.diplomaMarks === undefined || student.diplomaMarks > criteria.diplomaMarksMax)) {
    reasons.push("diploma_marks_above_max");
  }
  if (criteria.minAttendance !== undefined && student.attendancePct < criteria.minAttendance) {
    reasons.push("attendance_below_min");
  }
  if (
    criteria.readinessMin !== undefined
    && student.readinessScore !== undefined
    && student.readinessScore < criteria.readinessMin
  ) {
    reasons.push("readiness_below_min");
  }
  if (
    criteria.profileCompletenessMin !== undefined
    && student.profileCompletenessPct !== undefined
    && student.profileCompletenessPct < criteria.profileCompletenessMin
  ) {
    reasons.push("profile_completeness_below_min");
  }
  if (
    criteria.hasResume !== undefined
    && student.hasResumeReady !== undefined
    && student.hasResumeReady !== criteria.hasResume
  ) {
    reasons.push("resume_requirement_not_met");
  }
  if (
    criteria.isCertified !== undefined
    && student.isProfileCertified !== undefined
    && student.isProfileCertified !== criteria.isCertified
  ) {
    reasons.push("certification_requirement_not_met");
  }
  if (
    criteria.canAccessResources !== undefined
    && student.canAccessResources !== undefined
    && student.canAccessResources !== criteria.canAccessResources
  ) {
    reasons.push("resource_access_requirement_not_met");
  }
  if (
    criteria.canAccessMockTests !== undefined
    && student.canAccessMockTests !== undefined
    && student.canAccessMockTests !== criteria.canAccessMockTests
  ) {
    reasons.push("mock_test_access_requirement_not_met");
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
