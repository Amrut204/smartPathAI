export interface EligibilityCriteria {
  minCgpa?: number;
  maxBacklogs?: number;
  branches?: string[];
  minAttendance?: number;
}

export function isStudentEligible(
  student: { cgpa: number; backlogs: number; branch: string; attendancePct: number },
  criteria: EligibilityCriteria,
): boolean {
  if (criteria.minCgpa !== undefined && student.cgpa < criteria.minCgpa) {
    return false;
  }
  if (criteria.maxBacklogs !== undefined && student.backlogs > criteria.maxBacklogs) {
    return false;
  }
  if (criteria.branches && criteria.branches.length > 0 && !criteria.branches.includes(student.branch)) {
    return false;
  }
  if (criteria.minAttendance !== undefined && student.attendancePct < criteria.minAttendance) {
    return false;
  }
  return true;
}
