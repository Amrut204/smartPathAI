import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { getMongoDb } from "../utils/mongodb.js";

interface AnalyticsSnapshot {
  readiness: {
    batchAverages: Array<{ batch: string; avgReadiness: number; studentCount: number }>;
    trend: Array<{ date: string; avgScore: number; attempts: number }>;
  };
  topics: {
    summary: Array<{ topicId: string; topicName: string; avgMastery: number; studentsCovered: number }>;
    students: Array<{ studentId: string; studentName: string }>;
    cells: Array<{ studentId: string; topicId: string; topicName: string; masteryLevel: number }>;
  };
  tests: {
    totalStudents: number;
    totalAttempts: number;
    tests: Array<{
      testId: string;
      title: string;
      difficulty: string;
      completedStudents: number;
      completionRate: number;
      averageScore: number;
    }>;
  };
  placement: {
    funnel: Array<{ stage: string; count: number }>;
    outcomes: {
      pending: number;
      shortlisted: number;
      selected: number;
      rejected: number;
    };
  };
  dashboard: {
    totalStudents: number;
    activeDrives: number;
    avgReadiness: number;
    readinessTrend: Array<{ date: string; avgScore: number }>;
    upcomingDrives: Array<{
      id: string;
      company: string;
      role: string | null;
      driveDate: string;
      status: string;
      eligibleCount: number;
    }>;
    actionItems: string[];
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, item) => sum + item, 0) / values.length).toFixed(2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function rankBy<T>(items: T[], scoreOf: (item: T) => number): Map<string, number> {
  const sorted = [...items]
    .sort((a, b) => scoreOf(b) - scoreOf(a));

  const ranks = new Map<string, number>();
  let currentRank = 0;
  let previousScore: number | null = null;
  sorted.forEach((item, index) => {
    const score = scoreOf(item);
    if (previousScore === null || score !== previousScore) {
      currentRank = index + 1;
      previousScore = score;
    }
    ranks.set(String((item as { studentId: string }).studentId), currentRank);
  });
  return ranks;
}

function startDateIso(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function computeSnapshot(tenantId: string): Promise<AnalyticsSnapshot> {
  const db = await getMongoDb();

  const [
    students,
    attempts,
    topics,
    mastery,
    tests,
    driveResults,
    drives,
  ] = await Promise.all([
    db.collection("students").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, id: 1, user_id: 1, batch: 1, readiness_score: 1 } },
    ).toArray(),
    db.collection("student_attempts").find(
      {
        tenant_id: tenantId,
        status: "submitted",
        submitted_at: { $gte: `${startDateIso(30)}T00:00:00.000Z` },
      },
      { projection: { _id: 0, student_id: 1, test_id: 1, score: 1, submitted_at: 1 } },
    ).toArray(),
    db.collection("topics").find(
      { $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
      { projection: { _id: 0, id: 1, name: 1 } },
    ).toArray(),
    db.collection("topic_mastery").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, student_id: 1, topic_id: 1, mastery_level: 1 } },
    ).toArray(),
    db.collection("mock_tests").find(
      { $or: [{ tenant_id: tenantId }, { tenant_id: null }], is_active: true },
      { projection: { _id: 0, id: 1, title: 1, difficulty: 1 } },
    ).toArray(),
    db.collection("drive_results").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, drive_id: 1, outcome: 1, status: 1 } },
    ).toArray(),
    db.collection("drives").find(
      { tenant_id: tenantId, deleted_at: null },
      { projection: { _id: 0, id: 1, company: 1, role: 1, drive_date: 1, status: 1, eligible_count: 1 } },
    ).toArray(),
  ]);

  const userIds = students.map((student) => String(student.user_id));
  let users: Array<{ id: string; full_name: string | null }> = [];
  if (userIds.length > 0) {
    users = await db.collection("users").find(
      { tenant_id: tenantId, id: { $in: userIds } },
      { projection: { _id: 0, id: 1, full_name: 1 } },
    ).toArray() as unknown as Array<{ id: string; full_name: string | null }>;
  }

  const userMap = new Map(users.map((user) => [String(user.id), String(user.full_name ?? "")]));
  const topicMap = new Map(topics.map((topic) => [String(topic.id), String(topic.name)]));

  const batchScores = new Map<string, number[]>();
  students.forEach((student) => {
    const batch = String(student.batch ?? "Unknown");
    const list = batchScores.get(batch) ?? [];
    list.push(Number(student.readiness_score ?? 0));
    batchScores.set(batch, list);
  });

  const batchAverages = [...batchScores.entries()]
    .map(([batch, scores]) => ({
      batch,
      avgReadiness: average(scores),
      studentCount: scores.length,
    }))
    .sort((a, b) => a.batch.localeCompare(b.batch));

  const trendMap = new Map<string, number[]>();
  attempts.forEach((attempt) => {
    const date = String(attempt.submitted_at).slice(0, 10);
    const list = trendMap.get(date) ?? [];
    list.push(Number(attempt.score ?? 0));
    trendMap.set(date, list);
  });

  const trend = [...trendMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, scores]) => ({
      date,
      avgScore: average(scores),
      attempts: scores.length,
    }));

  const topicScores = new Map<string, number[]>();
  mastery.forEach((entry) => {
    const topicId = String(entry.topic_id);
    const list = topicScores.get(topicId) ?? [];
    list.push(Number(entry.mastery_level ?? 0));
    topicScores.set(topicId, list);
  });

  const summary = [...topicScores.entries()]
    .map(([topicId, scores]) => ({
      topicId,
      topicName: topicMap.get(topicId) ?? topicId,
      avgMastery: average(scores),
      studentsCovered: scores.length,
    }))
    .sort((a, b) => b.avgMastery - a.avgMastery);

  const topStudents = students.slice(0, 20);
  const topTopics = summary.slice(0, 8).map((item) => item.topicId);
  const cells = mastery
    .filter((entry) => topTopics.includes(String(entry.topic_id)))
    .map((entry) => ({
      studentId: String(entry.student_id),
      topicId: String(entry.topic_id),
      topicName: topicMap.get(String(entry.topic_id)) ?? String(entry.topic_id),
      masteryLevel: Number(entry.mastery_level ?? 0),
    }));

  const studentList = topStudents.map((student) => ({
    studentId: String(student.id),
    studentName: userMap.get(String(student.user_id)) ?? String(student.id),
  }));

  const totalStudents = students.length;
  const attemptsByTest = new Map<string, { students: Set<string>; scores: number[] }>();
  attempts.forEach((attempt) => {
    const testId = String(attempt.test_id);
    const stat = attemptsByTest.get(testId) ?? { students: new Set<string>(), scores: [] };
    stat.students.add(String(attempt.student_id));
    stat.scores.push(Number(attempt.score ?? 0));
    attemptsByTest.set(testId, stat);
  });

  const testsData = tests.map((test) => {
    const stat = attemptsByTest.get(String(test.id)) ?? { students: new Set<string>(), scores: [] };
    const completedStudents = stat.students.size;
    return {
      testId: String(test.id),
      title: String(test.title),
      difficulty: String(test.difficulty ?? "unknown"),
      completedStudents,
      completionRate: totalStudents > 0 ? Number(((completedStudents / totalStudents) * 100).toFixed(2)) : 0,
      averageScore: average(stat.scores),
    };
  });

  const outcomes = {
    pending: driveResults.filter((row) => String(row.outcome) === "pending").length,
    shortlisted: driveResults.filter((row) => String(row.outcome) === "shortlisted").length,
    selected: driveResults.filter((row) => String(row.outcome) === "selected").length,
    rejected: driveResults.filter((row) => String(row.outcome) === "rejected").length,
  };

  const funnel = [
    {
      stage: "eligible",
      count: driveResults.filter((row) => String(row.status) === "eligible").length,
    },
    {
      stage: "shortlisted",
      count: outcomes.shortlisted,
    },
    {
      stage: "selected",
      count: outcomes.selected,
    },
  ];

  const activeDrives = drives.filter((drive) => String(drive.status) === "active").length;
  const avgReadiness = average(students.map((student) => Number(student.readiness_score ?? 0)));
  const upcomingDrives = drives
    .filter((drive) => String(drive.status) === "upcoming")
    .sort((a, b) => String(a.drive_date).localeCompare(String(b.drive_date)))
    .slice(0, 5)
    .map((drive) => ({
      id: String(drive.id),
      company: String(drive.company),
      role: drive.role ? String(drive.role) : null,
      driveDate: String(drive.drive_date),
      status: String(drive.status),
      eligibleCount: Number(drive.eligible_count ?? 0),
    }));

  const drivesNeedingEligibility = drives.filter(
    (drive) => String(drive.status) === "upcoming" && Number(drive.eligible_count ?? 0) === 0,
  ).length;
  const lowReadiness = students.filter((student) => Number(student.readiness_score ?? 0) < 50).length;
  const actionItems: string[] = [];
  if (drivesNeedingEligibility > 0) {
    actionItems.push(`${drivesNeedingEligibility} upcoming drives need eligibility computation`);
  }
  if (outcomes.pending > 0) {
    actionItems.push(`${outcomes.pending} student outcomes still pending`);
  }
  if (lowReadiness > 0) {
    actionItems.push(`${lowReadiness} students have readiness below 50`);
  }

  return {
    readiness: {
      batchAverages,
      trend,
    },
    topics: {
      summary,
      students: studentList,
      cells,
    },
    tests: {
      totalStudents,
      totalAttempts: attempts.length,
      tests: testsData,
    },
    placement: {
      funnel,
      outcomes,
    },
    dashboard: {
      totalStudents,
      activeDrives,
      avgReadiness,
      readinessTrend: trend.map((item) => ({ date: item.date, avgScore: item.avgScore })),
      upcomingDrives,
      actionItems,
    },
  };
}

export const AnalyticsService = {
  async refresh(tenantId: string) {
    const db = await getMongoDb();
    const snapshot = await computeSnapshot(tenantId);

    await db.collection("tenant_analytics").updateOne(
      { tenant_id: tenantId },
      {
        $set: {
          tenant_id: tenantId,
          readiness: snapshot.readiness,
          topics: snapshot.topics,
          tests: snapshot.tests,
          placement: snapshot.placement,
          dashboard: snapshot.dashboard,
          updated_at: new Date().toISOString(),
        },
        $setOnInsert: {
          id: randomUUID(),
          created_at: new Date().toISOString(),
        },
      },
      { upsert: true },
    );

    return snapshot;
  },

  async getSnapshot(tenantId: string) {
    const db = await getMongoDb();
    const data = await db.collection("tenant_analytics").findOne(
      { tenant_id: tenantId },
      { projection: { _id: 0, readiness: 1, topics: 1, tests: 1, placement: 1, dashboard: 1, updated_at: 1 } },
    );

    const updatedAt = data?.updated_at ? new Date(String(data.updated_at)).getTime() : 0;
    const stale = !updatedAt || Date.now() - updatedAt > 5 * 60 * 1000;

    if (!data || stale) {
      return this.refresh(tenantId);
    }

    const topicsSnapshot = (data.topics ?? { summary: [], students: [], cells: [] }) as AnalyticsSnapshot["topics"];
    const topicNameById = new Map(
      (topicsSnapshot.summary ?? []).map((row) => [String(row.topicId), String(row.topicName)]),
    );
    const normalizedTopics: AnalyticsSnapshot["topics"] = {
      ...topicsSnapshot,
      cells: (topicsSnapshot.cells ?? []).map((cell) => ({
        ...cell,
        topicName: String((cell as { topicName?: string }).topicName ?? topicNameById.get(String(cell.topicId)) ?? String(cell.topicId)),
      })),
    };

    return {
      readiness: (data.readiness ?? { batchAverages: [], trend: [] }) as AnalyticsSnapshot["readiness"],
      topics: normalizedTopics,
      tests: (data.tests ?? { totalStudents: 0, totalAttempts: 0, tests: [] }) as AnalyticsSnapshot["tests"],
      placement: (data.placement ?? {
        funnel: [
          { stage: "eligible", count: 0 },
          { stage: "shortlisted", count: 0 },
          { stage: "selected", count: 0 },
        ],
        outcomes: { pending: 0, shortlisted: 0, selected: 0, rejected: 0 },
      }) as AnalyticsSnapshot["placement"],
      dashboard: (data.dashboard ?? {
        totalStudents: 0,
        activeDrives: 0,
        avgReadiness: 0,
        readinessTrend: [],
        upcomingDrives: [],
        actionItems: [],
      }) as AnalyticsSnapshot["dashboard"],
    };
  },

  async getReadiness(tenantId: string) {
    const snapshot = await this.getSnapshot(tenantId);
    return snapshot.readiness;
  },

  async getTopics(tenantId: string) {
    const snapshot = await this.getSnapshot(tenantId);
    return snapshot.topics;
  },

  async getTests(tenantId: string) {
    const snapshot = await this.getSnapshot(tenantId);
    return snapshot.tests;
  },

  async getPlacement(tenantId: string) {
    const snapshot = await this.getSnapshot(tenantId);
    return snapshot.placement;
  },

  async getStudyTrends(tenantId: string) {
    const db = await getMongoDb();
    const fromDate = startDateIso(30);

    const data = await db.collection("study_hours").find(
      { tenant_id: tenantId, study_date: { $gte: fromDate } },
      { projection: { _id: 0, study_date: 1, hours: 1 } },
    ).sort({ study_date: 1 }).toArray();

    const trendMap = new Map<string, { totalMinutes: number; sessions: number }>();
    data.forEach((entry) => {
      const studyDate = String(entry.study_date);
      const current = trendMap.get(studyDate) ?? { totalMinutes: 0, sessions: 0 };
      current.totalMinutes += Number(entry.hours ?? 0) * 60;
      current.sessions += 1;
      trendMap.set(studyDate, current);
    });

    const trend = [...trendMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({
        date,
        totalMinutes: value.totalMinutes,
        totalHours: Number((value.totalMinutes / 60).toFixed(2)),
        sessions: value.sessions,
      }));

    return {
      range: {
        from: fromDate,
        to: new Date().toISOString().slice(0, 10),
      },
      trend,
    };
  },

  async getDashboard(tenantId: string) {
    const snapshot = await this.getSnapshot(tenantId);
    return snapshot.dashboard;
  },

  async getStudentRankings(tenantId: string, limit = 50, windowDays = 30) {
    const db = await getMongoDb();
    const normalizedLimit = Number.isFinite(limit) ? limit : 50;
    const normalizedWindowDays = Number.isFinite(windowDays) ? windowDays : 30;
    const safeWindowDays = clamp(Math.round(normalizedWindowDays), 7, 180);
    const fromDate = startDateIso(safeWindowDays);
    const cappedLimit = clamp(Math.round(normalizedLimit), 1, 200);

    const [students, attempts, studyHours] = await Promise.all([
      db.collection("students").find(
        { tenant_id: tenantId },
        {
          projection: {
            _id: 0,
            id: 1,
            user_id: 1,
            roll_number: 1,
            branch: 1,
            batch: 1,
            readiness_score: 1,
          },
        },
      ).toArray(),
      db.collection("student_attempts").find(
        {
          tenant_id: tenantId,
          status: "submitted",
          submitted_at: { $gte: `${fromDate}T00:00:00.000Z` },
        },
        { projection: { _id: 0, student_id: 1, score: 1 } },
      ).toArray(),
      db.collection("study_hours").find(
        { tenant_id: tenantId, study_date: { $gte: fromDate } },
        { projection: { _id: 0, student_id: 1, study_date: 1, hours: 1 } },
      ).toArray(),
    ]);

    const userIds = students.map((student) => String(student.user_id));
    const users = userIds.length > 0
      ? await db.collection("users").find(
          { tenant_id: tenantId, id: { $in: userIds } },
          { projection: { _id: 0, id: 1, full_name: 1 } },
        ).toArray()
      : [];

    const userMap = new Map(users.map((user) => [String(user.id), String(user.full_name ?? "")]));

    const attemptsByStudent = new Map<string, number[]>();
    attempts.forEach((attempt) => {
      const key = String(attempt.student_id);
      const list = attemptsByStudent.get(key) ?? [];
      list.push(Number(attempt.score ?? 0));
      attemptsByStudent.set(key, list);
    });

    const studyByStudent = new Map<string, { totalHours: number; activeDays: Set<string> }>();
    studyHours.forEach((entry) => {
      const key = String(entry.student_id);
      const value = studyByStudent.get(key) ?? { totalHours: 0, activeDays: new Set<string>() };
      value.totalHours += Number(entry.hours ?? 0);
      value.activeDays.add(String(entry.study_date));
      studyByStudent.set(key, value);
    });

    const rows = students.map((student) => {
      const studentId = String(student.id);
      const readinessScore = Number(student.readiness_score ?? 0);

      const scores = attemptsByStudent.get(studentId) ?? [];
      const avgMockScore = average(scores);
      const mockAttempts = scores.length;
      const mockAttemptsScore = clamp((mockAttempts / 5) * 100, 0, 100);
      const mockPerformanceScore = Number((avgMockScore * 0.8 + mockAttemptsScore * 0.2).toFixed(2));

      const study = studyByStudent.get(studentId) ?? { totalHours: 0, activeDays: new Set<string>() };
      const studyHoursWindow = Number(study.totalHours.toFixed(2));
      const activeStudyDaysWindow = study.activeDays.size;
      const targetHours = Math.max(8, Math.round((safeWindowDays / 30) * 40));
      const targetDays = Math.max(5, Math.round((safeWindowDays / 30) * 20));
      const hoursNorm = clamp(studyHoursWindow / targetHours, 0, 1);
      const daysNorm = clamp(activeStudyDaysWindow / targetDays, 0, 1);
      const studyConsistencyScore = Number(((hoursNorm * 0.7 + daysNorm * 0.3) * 100).toFixed(2));

      const overallScore = Number((
        readinessScore * 0.45
        + mockPerformanceScore * 0.35
        + studyConsistencyScore * 0.2
      ).toFixed(2));

      return {
        studentId,
        fullName: userMap.get(String(student.user_id)) ?? String(studentId),
        rollNumber: String(student.roll_number ?? ""),
        branch: String(student.branch ?? ""),
        batch: String(student.batch ?? ""),
        metrics: {
          readinessScore: Number(readinessScore.toFixed(2)),
          mockPerformanceScore,
          studyConsistencyScore,
          avgMockScore: Number(avgMockScore.toFixed(2)),
          mockAttempts,
          studyHoursWindow,
          activeStudyDaysWindow,
          studyHours30d: studyHoursWindow,
          activeStudyDays30d: activeStudyDaysWindow,
          overallScore,
        },
      };
    });

    const overallSorted = [...rows]
      .sort((a, b) => b.metrics.overallScore - a.metrics.overallScore || a.fullName.localeCompare(b.fullName));

    const readinessRanks = rankBy(rows, (row) => row.metrics.readinessScore);
    const mockRanks = rankBy(rows, (row) => row.metrics.mockPerformanceScore);
    const consistencyRanks = rankBy(rows, (row) => row.metrics.studyConsistencyScore);

    const items = overallSorted.slice(0, cappedLimit).map((row, index) => ({
      ...row,
      ranks: {
        overall: index + 1,
        readiness: readinessRanks.get(row.studentId) ?? index + 1,
        mockPerformance: mockRanks.get(row.studentId) ?? index + 1,
        studyConsistency: consistencyRanks.get(row.studentId) ?? index + 1,
      },
    }));

    return {
      generatedAt: new Date().toISOString(),
      windowDays: safeWindowDays,
      parameters: [
        { key: "readinessScore", label: "Readiness", weight: 0.45 },
        { key: "mockPerformanceScore", label: "Mock Performance", weight: 0.35 },
        { key: "studyConsistencyScore", label: "Study Consistency", weight: 0.2 },
      ],
      items,
    };
  },
};
