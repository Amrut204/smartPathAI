import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import {
  RISK_HISTORY_COLLECTION,
  RISK_INTERVENTION_COLLECTION,
  RISK_SCORE_COLLECTION,
  type RiskCategory,
  type RiskFactorBreakdown,
  type RiskInterventionAction,
  type RiskHistoryDocument,
  type RiskScoreDocument,
  type RiskInterventionDocument,
} from "../models/RiskAssessment.js";
import { evaluateStudentEligibility } from "./eligibility.logic.js";
import { getMongoDb } from "../utils/mongodb.js";
import { buildStudentProfileSummary } from "../utils/student-profile.js";

type RiskAssessmentStudentRow = {
  studentId: string;
  fullName: string;
  branch: string;
  batch: string;
  cgpa: number;
  riskScore: number;
  category: RiskCategory;
  riskFactors: string[];
  recommendedActions: string[];
  lastActive: string | null;
  eligibleDrives: number;
  appliedDrives: number;
  mockTestsAttempted: number;
  avgMockScore: number;
  profileCompletenessPct: number;
};

type RiskAssessmentSummary = {
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
  totalStudents: number;
};

type RiskAssessmentComputedRow = RiskAssessmentStudentRow & {
  breakdown: RiskFactorBreakdown;
};

type RiskTrendCounts = {
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
};

type RiskRefreshResult = {
  summary: RiskAssessmentSummary;
  rows: RiskAssessmentStudentRow[];
};

const ACTIVITY_MAX_POINTS = 80;
const PERFORMANCE_MAX_POINTS = 50;
const OPPORTUNITY_MAX_POINTS = 60;
const PEER_MAX_POINTS = 25;
const ACTIVITY_WEIGHT = 0.3;
const PERFORMANCE_WEIGHT = 0.25;
const OPPORTUNITY_WEIGHT = 0.3;
const PEER_WEIGHT = 0.15;

let indexesEnsured = false;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function daysBetween(isoDate: string | null | undefined, now = new Date()) {
  if (!isoDate) return null;
  const time = new Date(isoDate).getTime();
  if (!Number.isFinite(time)) return null;
  const diff = Math.floor((now.getTime() - time) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? diff : 0;
}

function daysUntil(isoDate: string | null | undefined, now = new Date()) {
  if (!isoDate) return null;
  const time = new Date(isoDate).getTime();
  if (!Number.isFinite(time)) return null;
  const diff = Math.ceil((time - now.getTime()) / (1000 * 60 * 60 * 24));
  return diff;
}

function computeProfileCompleteness(
  student: Record<string, unknown>,
  user: { fullName: string; email: string },
) {
  const summary = buildStudentProfileSummary({
    student,
    user: {
      full_name: user.fullName,
      email: user.email,
    },
  });

  return {
    pct: summary.profileCompleteness.pct,
    missing: summary.missingRequiredFields.map((item) => item.label),
  };
}

function categorizeRisk(score: number): RiskCategory {
  if (score >= 70) return "HIGH_RISK";
  if (score >= 40) return "MEDIUM_RISK";
  return "LOW_RISK";
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function computeActivityPoints(params: {
  daysSinceLogin: number | null;
  mockTestsAttempted: number;
  resourcesViewed: number;
  profileCompletenessPct: number;
}) {
  let points = 0;
  const reasons: string[] = [];
  const days = params.daysSinceLogin ?? 999;

  if (days <= 7) {
    points += 0;
  } else if (days <= 14) {
    points += 15;
    reasons.push(`No login in ${days} days`);
  } else {
    points += 30;
    reasons.push("No activity in 14+ days");
  }

  if (params.mockTestsAttempted === 0) {
    points += 20;
    reasons.push("No mock tests taken");
  } else if (params.mockTestsAttempted < 2) {
    points += 15;
    reasons.push("Only 1 mock test taken");
  } else if (params.mockTestsAttempted <= 5) {
    points += 5;
  }

  if (params.resourcesViewed === 0) {
    points += 10;
    reasons.push("No resources viewed recently");
  } else if (params.resourcesViewed <= 3) {
    points += 5;
  }

  if (params.profileCompletenessPct < 50) {
    points += 20;
    reasons.push(`Profile only ${params.profileCompletenessPct}% complete`);
  } else if (params.profileCompletenessPct < 80) {
    points += 10;
    reasons.push(`Profile at ${params.profileCompletenessPct}% completion`);
  }

  return { points, reasons };
}

function computePerformancePoints(params: {
  avgMockScore: number;
  trend: "declining" | "improving" | "stable";
  cgpaBelowThreshold: boolean;
}) {
  let points = 0;
  const reasons: string[] = [];

  if (params.avgMockScore < 50) {
    points += 25;
    reasons.push(`Average mock score ${params.avgMockScore.toFixed(0)}%`);
  } else if (params.avgMockScore < 70) {
    points += 15;
    reasons.push(`Average mock score ${params.avgMockScore.toFixed(0)}%`);
  }

  if (params.trend === "declining") {
    points += 10;
    reasons.push("Mock scores trending down");
  } else if (params.trend === "improving") {
    points -= 5;
  }

  if (params.cgpaBelowThreshold) {
    points += 15;
    reasons.push("CGPA below drive eligibility");
  }

  return { points, reasons };
}

function computeOpportunityPoints(params: {
  eligibleDrives: number;
  appliedDrives: number;
  deadlineSoon: boolean;
}) {
  let points = 0;
  const reasons: string[] = [];

  if (params.eligibleDrives === 0) {
    points += 30;
    reasons.push("Not eligible for upcoming drives");
  } else if (params.eligibleDrives <= 2) {
    points += 20;
  } else if (params.eligibleDrives <= 5) {
    points += 10;
  }

  if (params.eligibleDrives > 0) {
    if (params.appliedDrives === 0) {
      points += 20;
      reasons.push(`Eligible for ${params.eligibleDrives} drives but applied to 0`);
    } else if (params.appliedDrives / params.eligibleDrives < 0.5) {
      points += 10;
      reasons.push(`Applied to ${params.appliedDrives}/${params.eligibleDrives} eligible drives`);
    }
  }

  if (params.deadlineSoon) {
    points += 10;
    reasons.push("Drive deadline in next 3 days");
  }

  return { points, reasons };
}

function computePeerPoints(params: {
  activityPercentile: number;
  belowPeerAverage: boolean;
  branchLabel: string;
}) {
  let points = 0;
  const reasons: string[] = [];

  if (params.activityPercentile <= 0.25) {
    points += 15;
    reasons.push(`Bottom 25% activity in ${params.branchLabel}`);
  } else if (params.activityPercentile <= 0.5) {
    points += 10;
    reasons.push(`Below average activity in ${params.branchLabel}`);
  }

  if (params.belowPeerAverage) {
    points += 10;
    reasons.push("Preparation below similar CGPA peers");
  }

  return { points, reasons };
}

function normalizeScore(points: number, max: number) {
  if (max <= 0) return 0;
  return clamp(Math.round((points / max) * 100), 0, 100);
}

function getRecommendedActions(input: {
  daysSinceLogin: number | null;
  mockTestsAttempted: number;
  avgMockScore: number;
  eligibleDrives: number;
  appliedDrives: number;
  profileCompletenessPct: number;
  resourcesViewed: number;
  deadlineSoon: boolean;
  belowPeerAverage: boolean;
}) {
  const actions = new Set<string>();
  if ((input.daysSinceLogin ?? 99) > 14) actions.add("Personal call/meeting");
  if (input.mockTestsAttempted === 0) actions.add("Assign mock test immediately");
  if (input.avgMockScore > 0 && input.avgMockScore < 50) actions.add("Review mock test failures together");
  if (input.eligibleDrives > 0 && input.appliedDrives === 0) actions.add("Push drive applications today");
  if (input.profileCompletenessPct < 80) actions.add("Complete student profile details");
  if (input.resourcesViewed === 0) actions.add("Share 2 prep resources");
  if (input.deadlineSoon) actions.add("Send urgent deadline reminder");
  if (input.belowPeerAverage) actions.add("Assign peer mentor");

  return [...actions].slice(0, 4);
}

function estimateActivityScore(params: {
  daysSinceLogin: number | null;
  mockTestsAttempted: number;
  resourcesViewed: number;
  profileCompletenessPct: number;
}) {
  let score = 0;
  const days = params.daysSinceLogin ?? 999;
  if (days <= 7) score += 5;
  if (days > 7 && days <= 14) score += 2;
  score += Math.min(params.mockTestsAttempted, 6) * 2;
  score += Math.min(params.resourcesViewed, 6);
  score += Math.round(params.profileCompletenessPct / 25);
  return score;
}

function computeTrend(scores: number[]): "declining" | "improving" | "stable" {
  if (scores.length < 4) return "stable";
  const last = scores.slice(-3);
  const prev = scores.slice(Math.max(0, scores.length - 6), Math.max(0, scores.length - 3));
  const avgLast = last.reduce((sum, value) => sum + value, 0) / last.length;
  const avgPrev = prev.reduce((sum, value) => sum + value, 0) / prev.length;
  if (avgLast <= avgPrev - 5) return "declining";
  if (avgLast >= avgPrev + 5) return "improving";
  return "stable";
}

async function ensureIndexes() {
  if (indexesEnsured) return;
  const db = await getMongoDb();
  await Promise.all([
    db.collection(RISK_SCORE_COLLECTION).createIndex({ tenant_id: 1, student_id: 1 }, { unique: true }),
    db.collection(RISK_SCORE_COLLECTION).createIndex({ tenant_id: 1, category: 1 }),
    db.collection(RISK_HISTORY_COLLECTION).createIndex({ tenant_id: 1, student_id: 1, date: 1 }, { unique: true }),
    db.collection(RISK_HISTORY_COLLECTION).createIndex({ tenant_id: 1, date: 1 }),
    db.collection(RISK_INTERVENTION_COLLECTION).createIndex({ tenant_id: 1, student_id: 1, created_at: -1 }),
  ]);
  indexesEnsured = true;
}

function buildRiskFactors(factors: RiskFactorBreakdown) {
  return factors.reasons.slice(0, 4);
}

function buildBreakdown(
  activity: ReturnType<typeof computeActivityPoints>,
  performance: ReturnType<typeof computePerformancePoints>,
  opportunity: ReturnType<typeof computeOpportunityPoints>,
  peer: ReturnType<typeof computePeerPoints>,
): RiskFactorBreakdown {
  return {
    activityScore: normalizeScore(activity.points, ACTIVITY_MAX_POINTS),
    performanceScore: normalizeScore(performance.points, PERFORMANCE_MAX_POINTS),
    opportunityScore: normalizeScore(opportunity.points, OPPORTUNITY_MAX_POINTS),
    peerScore: normalizeScore(peer.points, PEER_MAX_POINTS),
    activityPoints: activity.points,
    performancePoints: performance.points,
    opportunityPoints: opportunity.points,
    peerPoints: peer.points,
    reasons: [
      ...activity.reasons,
      ...performance.reasons,
      ...opportunity.reasons,
      ...peer.reasons,
    ],
  };
}

function computeRiskScore(breakdown: RiskFactorBreakdown) {
  const weighted =
    breakdown.activityScore * ACTIVITY_WEIGHT
    + breakdown.performanceScore * PERFORMANCE_WEIGHT
    + breakdown.opportunityScore * OPPORTUNITY_WEIGHT
    + breakdown.peerScore * PEER_WEIGHT;
  return clamp(Math.round(weighted), 0, 100);
}

function riskSummaryFromRows(rows: RiskAssessmentStudentRow[]): RiskAssessmentSummary {
  return {
    highRisk: rows.filter((row) => row.category === "HIGH_RISK").length,
    mediumRisk: rows.filter((row) => row.category === "MEDIUM_RISK").length,
    lowRisk: rows.filter((row) => row.category === "LOW_RISK").length,
    totalStudents: rows.length,
  };
}

async function fetchRiskData(tenantId: string) {
  const db = await getMongoDb();
  const todayIso = toIsoDate(new Date());
  const start30 = new Date();
  start30.setUTCDate(start30.getUTCDate() - 30);
  const start90 = new Date();
  start90.setUTCDate(start90.getUTCDate() - 90);

  const [students, users, drives, driveResults, attempts, resourceViews, logins] = await Promise.all([
    db.collection("students").find(
      { tenant_id: tenantId },
      {
        projection: {
          _id: 0,
          id: 1,
          user_id: 1,
          branch: 1,
          batch: 1,
          cgpa: 1,
          backlogs: 1,
          attendance_pct: 1,
          profile_data: 1,
          skills: 1,
        },
      },
    ).toArray(),
    db.collection("users").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, id: 1, full_name: 1, email: 1 } },
    ).toArray(),
    db.collection("drives").find(
      { tenant_id: tenantId, deleted_at: null, status: { $in: ["upcoming", "active"] }, drive_date: { $gte: todayIso } },
      { projection: { _id: 0, id: 1, company: 1, role: 1, drive_date: 1, criteria: 1, status: 1 } },
    ).toArray(),
    db.collection("drive_results").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, drive_id: 1, student_id: 1, status: 1, outcome: 1, updated_at: 1, created_at: 1 } },
    ).toArray(),
    db.collection("student_attempts").find(
      { tenant_id: tenantId, status: "submitted", submitted_at: { $gte: start90.toISOString() } },
      { projection: { _id: 0, id: 1, student_id: 1, score: 1, submitted_at: 1 } },
    ).toArray(),
    db.collection("resource_view_events").find(
      { tenant_id: tenantId, event_type: { $in: ["open", "external_redirect"] }, created_at: { $gte: start30.toISOString() } },
      { projection: { _id: 0, student_id: 1, created_at: 1 } },
    ).toArray(),
    db.collection("student_activity_events").find(
      { tenant_id: tenantId, event_type: "login" },
      { projection: { _id: 0, student_id: 1, created_at: 1 } },
    ).toArray(),
  ]);

  return {
    students,
    users,
    drives,
    driveResults,
    attempts,
    resourceViews,
    logins,
    todayIso,
  };
}

function computeTrendCounts(rows: RiskHistoryDocument[], category: RiskCategory): number {
  return rows.filter((row) => row.category === category).length;
}

export const RiskAssessmentService = {
  async refreshRiskScores(tenantId: string): Promise<RiskRefreshResult> {
    await ensureIndexes();
    const db = await getMongoDb();
    const now = new Date();
    const todayIso = toIsoDate(now);

    const data = await fetchRiskData(tenantId);

    const userMap = new Map(
      data.users.map((user) => [
        String(user.id),
        {
          fullName: String(user.full_name ?? ""),
          email: String(user.email ?? ""),
        },
      ]),
    );

    const attemptsByStudent = new Map<string, Array<{ score: number; submittedAt: string }>>();
    data.attempts.forEach((attempt) => {
      const studentId = String(attempt.student_id ?? "");
      const list = attemptsByStudent.get(studentId) ?? [];
      list.push({
        score: Number(attempt.score ?? 0),
        submittedAt: String(attempt.submitted_at ?? ""),
      });
      attemptsByStudent.set(studentId, list);
    });
    attemptsByStudent.forEach((list) => list.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)));

    const resourceViewsByStudent = new Map<string, number>();
    data.resourceViews.forEach((view) => {
      const studentId = String(view.student_id ?? "");
      resourceViewsByStudent.set(studentId, Number(resourceViewsByStudent.get(studentId) ?? 0) + 1);
    });

    const lastLoginByStudent = new Map<string, string>();
    data.logins.forEach((login) => {
      const studentId = String(login.student_id ?? "");
      const timestamp = String(login.created_at ?? "");
      if (!lastLoginByStudent.has(studentId) || timestamp > String(lastLoginByStudent.get(studentId))) {
        lastLoginByStudent.set(studentId, timestamp);
      }
    });

    const driveResultsByStudent = new Map<string, Array<Record<string, unknown>>>();
    data.driveResults.forEach((row) => {
      const studentId = String(row.student_id ?? "");
      const list = driveResultsByStudent.get(studentId) ?? [];
      list.push(row as Record<string, unknown>);
      driveResultsByStudent.set(studentId, list);
    });

    const branchScores = new Map<string, number[]>();
    const activityScoreByStudent = new Map<string, number>();

    const studentRows = data.students.map((student) => {
      const studentId = String(student.id);
      const user = userMap.get(String(student.user_id)) ?? { fullName: "", email: "" };
      const attempts = attemptsByStudent.get(studentId) ?? [];
      const scores = attempts.map((item) => item.score);
      const avgMockScore = scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
      const trend = computeTrend(scores);
      const lastLogin = lastLoginByStudent.get(studentId) ?? null;
      const daysSinceLogin = daysBetween(lastLogin, now);
      const resourcesViewed = resourceViewsByStudent.get(studentId) ?? 0;
      const profileCompleteness = computeProfileCompleteness(student as Record<string, unknown>, user);

      const studentActivityScore = estimateActivityScore({
        daysSinceLogin,
        mockTestsAttempted: attempts.length,
        resourcesViewed,
        profileCompletenessPct: profileCompleteness.pct,
      });
      activityScoreByStudent.set(studentId, studentActivityScore);
      const branch = String(student.branch ?? "Unknown");
      const scoresList = branchScores.get(branch) ?? [];
      scoresList.push(studentActivityScore);
      branchScores.set(branch, scoresList);

      return {
        studentId,
        user,
        branch,
        batch: String(student.batch ?? ""),
        cgpa: Number(student.cgpa ?? 0),
        backlogs: Number(student.backlogs ?? 0),
        attendancePct: Number(student.attendance_pct ?? 0),
        attempts,
        avgMockScore: Number(avgMockScore.toFixed(1)),
        trend,
        lastLogin,
        daysSinceLogin,
        resourcesViewed,
        profileCompleteness,
      };
    });

    branchScores.forEach((scores, branch) => {
      scores.sort((a, b) => a - b);
      branchScores.set(branch, scores);
    });

    const computedRows: RiskAssessmentComputedRow[] = studentRows.map((row) => {
      const eligibleDrives = data.drives.filter((drive) => {
        const criteria = (drive.criteria ?? {}) as {
          minCgpa?: number;
          maxBacklogs?: number;
          branches?: string[];
          minAttendance?: number;
        };
        const eligibility = evaluateStudentEligibility(
          {
            cgpa: row.cgpa,
            activeBacklogs: row.backlogs,
            totalBacklogs: 0,
            branch: row.branch,
            attendancePct: row.attendancePct,
          },
          criteria,
        );
        return eligibility.eligible;
      });

      const eligibleDriveCount = eligibleDrives.length;
      const deadlineSoon = eligibleDrives.some((drive) => {
        const driveDate = String(drive.drive_date ?? drive.driveDate ?? "");
        if (!driveDate) return false;
        const diff = daysUntil(driveDate, now);
        return diff !== null && diff >= 0 && diff <= 3;
      });

      const driveResults = driveResultsByStudent.get(row.studentId) ?? [];
      const appliedDrives = driveResults.filter((item) => {
        const outcome = String(item.outcome ?? "");
        const status = String(item.status ?? "");
        return status === "applied" || (outcome && outcome !== "pending");
      }).length;

      const cgpaBelowThreshold = eligibleDriveCount === 0
        && data.drives.some((drive) => {
          const minCgpa = Number((drive.criteria ?? {}).minCgpa ?? 0);
          return minCgpa > 0 && row.cgpa < minCgpa;
        });

      const activity = computeActivityPoints({
        daysSinceLogin: row.daysSinceLogin,
        mockTestsAttempted: row.attempts.length,
        resourcesViewed: row.resourcesViewed,
        profileCompletenessPct: row.profileCompleteness.pct,
      });

      const performance = computePerformancePoints({
        avgMockScore: row.avgMockScore,
        trend: row.trend,
        cgpaBelowThreshold,
      });

      const opportunity = computeOpportunityPoints({
        eligibleDrives: eligibleDriveCount,
        appliedDrives,
        deadlineSoon,
      });

      const branchScoresList = branchScores.get(row.branch) ?? [0];
      const activityScore = activityScoreByStudent.get(row.studentId) ?? 0;
      const belowOrEqual = branchScoresList.filter((score) => score <= activityScore).length;
      const activityPercentile = branchScoresList.length > 0 ? belowOrEqual / branchScoresList.length : 1;

      const peerScores = studentRows
        .filter((peer) => peer.branch === row.branch && Math.abs(peer.cgpa - row.cgpa) <= 0.5)
        .map((peer) => peer.avgMockScore)
        .filter((value) => Number.isFinite(value));
      const peerAverage = peerScores.length > 0
        ? peerScores.reduce((sum, value) => sum + value, 0) / peerScores.length
        : 0;
      const belowPeerAverage = peerAverage > 0 && row.avgMockScore < peerAverage;

      const peer = computePeerPoints({
        activityPercentile,
        belowPeerAverage,
        branchLabel: row.branch || "their branch",
      });

      const breakdown = buildBreakdown(activity, performance, opportunity, peer);
      const riskScore = computeRiskScore(breakdown);
      const category = categorizeRisk(riskScore);

      const recommendedActions = getRecommendedActions({
        daysSinceLogin: row.daysSinceLogin,
        mockTestsAttempted: row.attempts.length,
        avgMockScore: row.avgMockScore,
        eligibleDrives: eligibleDriveCount,
        appliedDrives,
        profileCompletenessPct: row.profileCompleteness.pct,
        resourcesViewed: row.resourcesViewed,
        deadlineSoon,
        belowPeerAverage,
      });

      return {
        studentId: row.studentId,
        fullName: row.user.fullName || "Student",
        branch: row.branch,
        batch: row.batch,
        cgpa: row.cgpa,
        riskScore,
        category,
        riskFactors: buildRiskFactors(breakdown),
        recommendedActions,
        lastActive: row.lastLogin,
        eligibleDrives: eligibleDriveCount,
        appliedDrives,
        mockTestsAttempted: row.attempts.length,
        avgMockScore: row.avgMockScore,
        profileCompletenessPct: row.profileCompleteness.pct,
        breakdown,
      };
    });

    const summary = riskSummaryFromRows(computedRows);

    const existingScores = await db.collection(RISK_SCORE_COLLECTION).find(
      { tenant_id: tenantId },
      { projection: { _id: 0, id: 1, student_id: 1 } },
    ).toArray();
    const existingMap = new Map(existingScores.map((row) => [String(row.student_id), String(row.id)]));

    const bulkScores = computedRows.map((row) => {
      const id = existingMap.get(row.studentId) ?? randomUUID();
      const doc: RiskScoreDocument = {
        id,
        tenant_id: tenantId,
        student_id: row.studentId,
        risk_score: row.riskScore,
        category: row.category,
        factors: row.breakdown,
        recommended_actions: row.recommendedActions,
        last_active_at: row.lastActive,
        eligible_drives: row.eligibleDrives,
        applied_drives: row.appliedDrives,
        mock_tests_attempted: row.mockTestsAttempted,
        avg_mock_score: row.avgMockScore,
        profile_completeness_pct: row.profileCompletenessPct,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };

      return {
        updateOne: {
          filter: { tenant_id: tenantId, student_id: row.studentId },
          update: {
            $set: {
              risk_score: doc.risk_score,
              category: doc.category,
              factors: doc.factors,
              recommended_actions: doc.recommended_actions,
              last_active_at: doc.last_active_at,
              eligible_drives: doc.eligible_drives,
              applied_drives: doc.applied_drives,
              mock_tests_attempted: doc.mock_tests_attempted,
              avg_mock_score: doc.avg_mock_score,
              profile_completeness_pct: doc.profile_completeness_pct,
              updated_at: doc.updated_at,
            },
            $setOnInsert: {
              id: doc.id,
              tenant_id: doc.tenant_id,
              student_id: doc.student_id,
              created_at: doc.created_at,
            },
          },
          upsert: true,
        },
      };
    });

    const bulkHistory = computedRows.map((row) => {
      const history: RiskHistoryDocument = {
        id: randomUUID(),
        tenant_id: tenantId,
        student_id: row.studentId,
        date: todayIso,
        risk_score: row.riskScore,
        category: row.category,
        factors: row.breakdown,
        created_at: now.toISOString(),
      };

      return {
        updateOne: {
          filter: { tenant_id: tenantId, student_id: row.studentId, date: todayIso },
          update: { $setOnInsert: history },
          upsert: true,
        },
      };
    });

    if (bulkScores.length > 0) {
      await db.collection(RISK_SCORE_COLLECTION).bulkWrite(bulkScores, { ordered: false });
    }

    if (bulkHistory.length > 0) {
      await db.collection(RISK_HISTORY_COLLECTION).bulkWrite(bulkHistory, { ordered: false });
    }

    const rows = computedRows.map(({ breakdown, ...rest }) => rest);
    return { summary, rows };
  },

  async listRiskAssessment(tenantId: string, limit?: number) {
    await ensureIndexes();
    const db = await getMongoDb();
    const rows = await db.collection<RiskScoreDocument>(RISK_SCORE_COLLECTION).find(
      { tenant_id: tenantId },
      { projection: { _id: 0 } },
    ).sort({ risk_score: -1, updated_at: -1 }).toArray();

    const studentIds = rows.map((row) => row.student_id);
    const students = studentIds.length > 0
      ? await db.collection("students").find(
          { tenant_id: tenantId, id: { $in: studentIds } },
          { projection: { _id: 0, id: 1, user_id: 1, branch: 1, batch: 1, cgpa: 1 } },
        ).toArray()
      : [];
    const users = students.length > 0
      ? await db.collection("users").find(
          { tenant_id: tenantId, id: { $in: students.map((row) => String(row.user_id)) } },
          { projection: { _id: 0, id: 1, full_name: 1 } },
        ).toArray()
      : [];

    const userMap = new Map(users.map((user) => [String(user.id), String(user.full_name ?? "")]));
    const studentMap = new Map(students.map((student) => [String(student.id), student]));

    const mappedRows = rows.map((row) => {
      const student = studentMap.get(String(row.student_id));
      const fullName = student ? userMap.get(String(student.user_id)) ?? "Student" : "Student";
      return {
        studentId: String(row.student_id),
        fullName,
        branch: student ? String(student.branch ?? "") : "",
        batch: student ? String(student.batch ?? "") : "",
        cgpa: student ? Number(student.cgpa ?? 0) : 0,
        riskScore: Number(row.risk_score ?? 0),
        category: row.category,
        riskFactors: Array.isArray(row.factors?.reasons) ? row.factors.reasons.slice(0, 4) : [],
        recommendedActions: Array.isArray(row.recommended_actions) ? row.recommended_actions : [],
        lastActive: row.last_active_at ? String(row.last_active_at) : null,
        eligibleDrives: Number(row.eligible_drives ?? 0),
        appliedDrives: Number(row.applied_drives ?? 0),
        mockTestsAttempted: Number(row.mock_tests_attempted ?? 0),
        avgMockScore: Number(row.avg_mock_score ?? 0),
        profileCompletenessPct: Number(row.profile_completeness_pct ?? 0),
      } satisfies RiskAssessmentStudentRow;
    });

    return limit ? mappedRows.slice(0, limit) : mappedRows;
  },

  async getRiskAssessmentSummary(tenantId: string) {
    await ensureIndexes();
    const db = await getMongoDb();
    const rows = await db.collection<RiskScoreDocument>(RISK_SCORE_COLLECTION).find(
      { tenant_id: tenantId },
      { projection: { _id: 0, risk_score: 1, category: 1 } },
    ).toArray();

    const summary = riskSummaryFromRows(rows.map((row) => ({
      studentId: "",
      fullName: "",
      branch: "",
      batch: "",
      cgpa: 0,
      riskScore: Number(row.risk_score ?? 0),
      category: row.category,
      riskFactors: [],
      recommendedActions: [],
      lastActive: null,
      eligibleDrives: 0,
      appliedDrives: 0,
      mockTestsAttempted: 0,
      avgMockScore: 0,
      profileCompletenessPct: 0,
    })));

    return summary;
  },

  async getRiskAssessmentTrends(tenantId: string) {
    await ensureIndexes();
    const db = await getMongoDb();
    const today = new Date();
    const todayIso = toIsoDate(today);
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayIso = toIsoDate(yesterday);

    const [todayRows, yesterdayRows] = await Promise.all([
      db.collection<RiskHistoryDocument>(RISK_HISTORY_COLLECTION).find(
        { tenant_id: tenantId, date: todayIso },
        { projection: { _id: 0, category: 1 } },
      ).toArray(),
      db.collection<RiskHistoryDocument>(RISK_HISTORY_COLLECTION).find(
        { tenant_id: tenantId, date: yesterdayIso },
        { projection: { _id: 0, category: 1 } },
      ).toArray(),
    ]);

    const todayCounts: RiskTrendCounts = {
      highRisk: computeTrendCounts(todayRows, "HIGH_RISK"),
      mediumRisk: computeTrendCounts(todayRows, "MEDIUM_RISK"),
      lowRisk: computeTrendCounts(todayRows, "LOW_RISK"),
    };
    const yesterdayCounts: RiskTrendCounts = {
      highRisk: computeTrendCounts(yesterdayRows, "HIGH_RISK"),
      mediumRisk: computeTrendCounts(yesterdayRows, "MEDIUM_RISK"),
      lowRisk: computeTrendCounts(yesterdayRows, "LOW_RISK"),
    };

    return {
      weeklyChange: {
        highRisk: todayCounts.highRisk - yesterdayCounts.highRisk,
        mediumRisk: todayCounts.mediumRisk - yesterdayCounts.mediumRisk,
        lowRisk: todayCounts.lowRisk - yesterdayCounts.lowRisk,
      },
    };
  },

  async getRiskAssessmentForStudent(tenantId: string, studentId: string) {
    await ensureIndexes();
    const db = await getMongoDb();
    const risk = await db.collection<RiskScoreDocument>(RISK_SCORE_COLLECTION).findOne(
      { tenant_id: tenantId, student_id: studentId },
      { projection: { _id: 0 } },
    );

    if (!risk) {
      throw new AppError("RISK_NOT_FOUND", "Risk score not found. Refresh the risk assessment first.", 404);
    }

    return {
      studentId: String(risk.student_id),
      riskScore: Number(risk.risk_score ?? 0),
      category: risk.category,
      factors: risk.factors,
      recommendedActions: Array.isArray(risk.recommended_actions) ? risk.recommended_actions : [],
      lastActive: risk.last_active_at ? String(risk.last_active_at) : null,
      eligibleDrives: Number(risk.eligible_drives ?? 0),
      appliedDrives: Number(risk.applied_drives ?? 0),
      mockTestsAttempted: Number(risk.mock_tests_attempted ?? 0),
      avgMockScore: Number(risk.avg_mock_score ?? 0),
      profileCompletenessPct: Number(risk.profile_completeness_pct ?? 0),
    };
  },

  async getStudentRiskScore(tenantId: string, userId: string) {
    await ensureIndexes();
    const db = await getMongoDb();
    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, user_id: userId },
      { projection: { _id: 0, id: 1, cgpa: 1, branch: 1 } },
    );
    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student not found", 404);
    }

    let risk = await db.collection<RiskScoreDocument>(RISK_SCORE_COLLECTION).findOne(
      { tenant_id: tenantId, student_id: String(student.id) },
      { projection: { _id: 0 } },
    );

    if (!risk) {
      await this.refreshRiskScores(tenantId);
      risk = await db.collection<RiskScoreDocument>(RISK_SCORE_COLLECTION).findOne(
        { tenant_id: tenantId, student_id: String(student.id) },
        { projection: { _id: 0 } },
      );
    }

    if (!risk) {
      throw new AppError("RISK_NOT_FOUND", "Risk score not found. Ask your TPO to refresh.", 404);
    }

    const branch = String(student.branch ?? "your branch");
    const allScores = await db.collection<RiskScoreDocument>(RISK_SCORE_COLLECTION).find(
      { tenant_id: tenantId },
      { projection: { _id: 0, avg_mock_score: 1, mock_tests_attempted: 1, student_id: 1 } },
    ).toArray();

    const branchStudents = await db.collection("students").find(
      { tenant_id: tenantId, branch },
      { projection: { _id: 0, id: 1 } },
    ).toArray();
    const branchIds = new Set(branchStudents.map((row) => String(row.id)));
    const branchScores = allScores.filter((row) => branchIds.has(String(row.student_id)));

    const avgMockScore = Number(risk.avg_mock_score ?? 0);
    const avgBranchScore = branchScores.length > 0
      ? branchScores.reduce((sum, row) => sum + Number(row.avg_mock_score ?? 0), 0) / branchScores.length
      : 0;
    const avgBranchMocks = branchScores.length > 0
      ? branchScores.reduce((sum, row) => sum + Number(row.mock_tests_attempted ?? 0), 0) / branchScores.length
      : 0;

    const category = risk.category;
    const message = category === "HIGH_RISK"
      ? "You are falling behind right now. The good news: small actions this week can bring your score back."
      : category === "MEDIUM_RISK"
        ? "You are close, but a few gaps can hurt your placement chances. Focus on the actions below."
        : "You are on track. Keep the momentum and stay consistent.";

    return {
      score: Number(risk.risk_score ?? 0),
      category,
      message,
      recommendations: Array.isArray(risk.recommended_actions) ? risk.recommended_actions : [],
      comparisonToPeers: {
        yourMockTests: Number(risk.mock_tests_attempted ?? 0),
        avgInYourBranch: Number(avgBranchMocks.toFixed(1)),
        yourScore: Number(avgMockScore.toFixed(1)),
        avgScoreInYourBranch: Number(avgBranchScore.toFixed(1)),
      },
    };
  },

  async logIntervention(tenantId: string, userId: string, input: {
    studentId: string;
    action: RiskInterventionAction;
    notes?: string | null;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, id: input.studentId },
      { projection: { _id: 0, id: 1 } },
    );
    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student not found", 404);
    }

    const doc: RiskInterventionDocument = {
      id: randomUUID(),
      tenant_id: tenantId,
      student_id: input.studentId,
      action: input.action,
      notes: input.notes ? String(input.notes) : null,
      created_by: userId,
      created_at: new Date().toISOString(),
    };

    await db.collection<RiskInterventionDocument>(RISK_INTERVENTION_COLLECTION).insertOne(doc);

    return {
      id: doc.id,
      studentId: doc.student_id,
      action: doc.action,
      notes: doc.notes,
      createdAt: doc.created_at,
    };
  },

  async getRiskAssessmentSnapshot(tenantId: string, limit?: number) {
    const rows = await this.listRiskAssessment(tenantId, limit);
    const summary = riskSummaryFromRows(rows);
    const trends = await this.getRiskAssessmentTrends(tenantId);

    return {
      summary,
      highRiskStudents: rows.filter((row) => row.category === "HIGH_RISK"),
      mediumRiskStudents: rows.filter((row) => row.category === "MEDIUM_RISK"),
      trends,
    };
  },
};
