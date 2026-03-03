import { randomUUID } from "node:crypto";
import { hash as bcryptHash } from "bcryptjs";

import { AppError } from "../middleware/error-handler.js";
import { getMongoDb } from "../utils/mongodb.js";

function startOfWeekIso(today: Date): string {
  const day = today.getUTCDay();
  const distanceToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - distanceToMonday);
  return monday.toISOString().slice(0, 10);
}

function previousDateIso(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toResourceDto(resource: Record<string, unknown>) {
  return {
    id: String(resource.id),
    title: String(resource.title),
    description: resource.description ? String(resource.description) : "",
    url: String(resource.url),
    resourceType: String(resource.resource_type),
    thumbnailUrl: resource.thumbnail_url ? String(resource.thumbnail_url) : null,
    durationSec: Number(resource.duration_sec ?? 0),
    topicId: resource.topic_id ? String(resource.topic_id) : null,
    sourcePdf: resource.source_pdf ? String(resource.source_pdf) : null,
  };
}

type TopicProgressStatus = "incomplete" | "in_progress" | "complete";

export const StudentRepository = {
  async getStudentByUserId(tenantId: string, userId: string) {
    const db = await getMongoDb();
    const data = await db.collection("students").findOne(
      { tenant_id: tenantId, user_id: userId },
      { projection: { _id: 0, id: 1, tenant_id: 1, user_id: 1, points: 1, streak_current: 1, streak_longest: 1, readiness_score: 1, profile_data: 1, skills: 1 } },
    );

    if (!data) {
      throw new AppError("STUDENT_NOT_FOUND", "Student profile not found", 404);
    }

    return data;
  },

  async getDashboardData(tenantId: string, studentId: string) {
    const db = await getMongoDb();
    const todayIso = new Date().toISOString().slice(0, 10);
    const weekStartIso = startOfWeekIso(new Date());

    const [studyToday, studyWeek, student, weakAreas, recommendedTest, upcomingDrives] = await Promise.all([
      db.collection("study_hours").find(
        { tenant_id: tenantId, student_id: studentId, study_date: todayIso },
        { projection: { hours: 1 } },
      ).toArray(),
      db.collection("study_hours").find(
        { tenant_id: tenantId, student_id: studentId, study_date: { $gte: weekStartIso, $lte: todayIso } },
        { projection: { hours: 1 } },
      ).toArray(),
      db.collection("students").findOne(
        { tenant_id: tenantId, id: studentId },
        { projection: { points: 1, readiness_score: 1, streak_current: 1, streak_longest: 1 } },
      ),
      db.collection("topic_mastery").find(
        { tenant_id: tenantId, student_id: studentId },
        { projection: { topic_id: 1, mastery_level: 1 } },
      ).sort({ mastery_level: 1 }).limit(3).toArray(),
      db.collection("mock_tests").findOne(
        { is_active: true, $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
        { projection: { id: 1, title: 1, difficulty: 1, duration_sec: 1 }, sort: { created_at: -1 } },
      ),
      db.collection("drives").find(
        { tenant_id: tenantId, drive_date: { $gte: todayIso }, deleted_at: null },
        { projection: { id: 1, company: 1, role: 1, drive_date: 1, status: 1 } },
      ).sort({ drive_date: 1 }).limit(3).toArray(),
    ]);

    if (!student) {
      throw new AppError("DASHBOARD_DATA_ERROR", "Missing student data", 500);
    }

    const studentPoints = Number(student.points ?? 0);
    const [totalStudents, betterRankedCount, studiedTopicRows] = await Promise.all([
      db.collection("students").countDocuments({ tenant_id: tenantId }),
      db.collection("students").countDocuments({
        tenant_id: tenantId,
        $or: [
          { points: { $gt: studentPoints } },
          { points: studentPoints, id: { $lt: studentId } },
        ],
      }),
      db.collection("study_hours").aggregate([
        { $match: { tenant_id: tenantId, student_id: studentId } },
        {
          $group: {
            _id: "$topic_id",
            totalHours: { $sum: "$hours" },
            sessions: { $sum: 1 },
            lastStudied: { $max: "$study_date" },
          },
        },
        { $sort: { lastStudied: -1, totalHours: -1 } },
        { $limit: 8 },
      ]).toArray(),
    ]);

    const topicIds = new Set<string>();
    weakAreas.forEach((item) => topicIds.add(String(item.topic_id)));
    studiedTopicRows.forEach((row) => topicIds.add(String(row._id)));

    const topics = topicIds.size > 0
      ? await db.collection("topics").find(
          { id: { $in: [...topicIds] } },
          { projection: { _id: 0, id: 1, name: 1 } },
        ).toArray()
      : [];
    const topicNameMap = new Map(topics.map((topic) => [String(topic.id), String(topic.name)]));

    const studyHoursToday = studyToday.reduce((sum, row) => sum + Number(row.hours ?? 0), 0);
    const studyHoursWeek = studyWeek.reduce((sum, row) => sum + Number(row.hours ?? 0), 0);

    return {
      studyHoursToday,
      studyHoursWeek,
      studentRank: betterRankedCount + 1,
      totalStudents,
      totalPoints: Number(student.points ?? 0),
      readinessScore: Number(student.readiness_score ?? 0),
      streakCurrent: Number(student.streak_current ?? 0),
      streakLongest: Number(student.streak_longest ?? 0),
      weakAreas: weakAreas.map((item) => ({
        topicId: String(item.topic_id),
        topicName: topicNameMap.get(String(item.topic_id)) ?? String(item.topic_id),
        masteryLevel: Number(item.mastery_level ?? 0),
      })),
      studiedTopics: studiedTopicRows.map((row) => {
        const topicId = String(row._id);
        return {
          topicId,
          topicName: topicNameMap.get(topicId) ?? topicId,
          totalHours: Number(Number(row.totalHours ?? 0).toFixed(2)),
          sessions: Number(row.sessions ?? 0),
          lastStudied: String(row.lastStudied ?? ""),
        };
      }),
      recommendedTest: recommendedTest
        ? {
            id: String(recommendedTest.id),
            title: String(recommendedTest.title),
            difficulty: String(recommendedTest.difficulty),
            durationSec: Number(recommendedTest.duration_sec ?? 0),
          }
        : null,
      upcomingDrives: upcomingDrives.map((drive) => ({
        id: String(drive.id),
        company: String(drive.company),
        role: String(drive.role ?? ""),
        driveDate: String(drive.drive_date),
        status: String(drive.status),
      })),
    };
  },

  async createStudyHourEntry(params: {
    tenantId: string;
    studentId: string;
    topicId: string;
    studyDate: string;
    hours: number;
  }) {
    const db = await getMongoDb();

    const existingSameDay = await db.collection("study_hours").findOne(
      { tenant_id: params.tenantId, student_id: params.studentId, study_date: params.studyDate },
      { projection: { id: 1 } },
    );
    const isFirstEntryForDate = !existingSameDay;

    const id = randomUUID();
    const now = new Date().toISOString();
    await db.collection("study_hours").insertOne({
      id,
      tenant_id: params.tenantId,
      student_id: params.studentId,
      topic_id: params.topicId,
      study_date: params.studyDate,
      hours: params.hours,
      points_awarded: 0,
      created_at: now,
    });

    return {
      row: { id, study_date: params.studyDate, hours: params.hours, points_awarded: 0 },
      isFirstEntryForDate,
    };
  },

  async getStudyHoursHistory(tenantId: string, studentId: string, limit = 30) {
    const db = await getMongoDb();
    const data = await db.collection("study_hours").find(
      { tenant_id: tenantId, student_id: studentId },
      { projection: { _id: 0, id: 1, topic_id: 1, study_date: 1, hours: 1, points_awarded: 1 } },
    ).sort({ study_date: -1 }).limit(limit).toArray();

    return data.map((row) => ({
      id: String(row.id),
      topicId: String(row.topic_id),
      studyDate: String(row.study_date),
      hours: Number(row.hours ?? 0),
      pointsAwarded: Number(row.points_awarded ?? 0),
    }));
  },

  async getPointsHistory(tenantId: string, studentId: string, limit = 20) {
    const db = await getMongoDb();

    const [student, studyData, attemptData] = await Promise.all([
      db.collection("students").findOne(
        { tenant_id: tenantId, id: studentId },
        { projection: { points: 1 } },
      ),
      db.collection("study_hours").find(
        { tenant_id: tenantId, student_id: studentId },
        { projection: { id: 1, study_date: 1, points_awarded: 1 } },
      ).sort({ study_date: -1 }).limit(limit).toArray(),
      db.collection("student_attempts").find(
        { tenant_id: tenantId, student_id: studentId, status: "submitted" },
        { projection: { id: 1, submitted_at: 1, score: 1 } },
      ).sort({ submitted_at: -1 }).limit(limit).toArray(),
    ]);

    if (!student) {
      throw new AppError("POINTS_READ_FAILED", "Unable to read points", 500);
    }

    const items = [
      ...studyData.map((entry) => ({
        id: String(entry.id),
        source: "study_hours" as const,
        points: Number(entry.points_awarded ?? 0),
        at: `${String(entry.study_date)}T00:00:00.000Z`,
      })),
      ...attemptData.map((entry) => ({
        id: String(entry.id),
        source: "mock_test" as const,
        points: Math.max(5, Math.round(Number(entry.score ?? 0) / 2)),
        at: entry.submitted_at ? String(entry.submitted_at) : new Date().toISOString(),
      })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);

    return { totalPoints: Number(student.points ?? 0), items };
  },

  async updateStreak(params: { tenantId: string; studentId: string; studyDate: string }) {
    const db = await getMongoDb();

    const student = await db.collection("students").findOne(
      { tenant_id: params.tenantId, id: params.studentId },
      { projection: { streak_current: 1, streak_longest: 1 } },
    );

    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Unable to update streak", 404);
    }

    const yesterday = previousDateIso(params.studyDate);
    const previousDayEntry = await db.collection("study_hours").findOne(
      { tenant_id: params.tenantId, student_id: params.studentId, study_date: yesterday },
      { projection: { id: 1 } },
    );

    const current = Number(student.streak_current ?? 0);
    const longest = Number(student.streak_longest ?? 0);
    const nextCurrent = previousDayEntry ? current + 1 : 1;
    const nextLongest = Math.max(longest, nextCurrent);

    await db.collection("students").updateOne(
      { tenant_id: params.tenantId, id: params.studentId },
      { $set: { streak_current: nextCurrent, streak_longest: nextLongest } },
    );

    return { streakCurrent: nextCurrent, streakLongest: nextLongest };
  },

  async getLeaderboard(tenantId: string, limit: number, cursor?: string) {
    const db = await getMongoDb();

    const filter: Record<string, unknown> = { tenant_id: tenantId };
    if (cursor) {
      filter.id = { $gt: cursor };
    }

    const data = await db.collection("students").find(
      filter,
      { projection: { _id: 0, id: 1, user_id: 1, points: 1, readiness_score: 1 } },
    ).sort({ points: -1, id: 1 }).limit(limit + 1).toArray();

    const hasMore = data.length > limit;
    const items = hasMore ? data.slice(0, limit) : data;

    return {
      items: items.map((row) => ({
        id: String(row.id),
        userId: String(row.user_id),
        points: Number(row.points ?? 0),
        readinessScore: Number(row.readiness_score ?? 0),
      })),
      nextCursor: hasMore ? String(items[items.length - 1]?.id) : null,
      hasMore,
    };
  },

  async getStudentProfile(tenantId: string, userId: string) {
    const db = await getMongoDb();
    const data = await db.collection("students").findOne(
      { tenant_id: tenantId, user_id: userId },
      { projection: { _id: 0, id: 1, tenant_id: 1, user_id: 1, roll_number: 1, branch: 1, batch: 1, cgpa: 1, backlogs: 1, attendance_pct: 1, skills: 1, profile_data: 1 } },
    );

    if (!data) {
      throw new AppError("STUDENT_NOT_FOUND", "Student profile not found", 404);
    }

    return data;
  },

  async updateStudentProfile(params: {
    tenantId: string;
    userId: string;
    fullName?: string;
    skills?: string[];
    profileData?: Record<string, unknown>;
  }) {
    const db = await getMongoDb();

    if (params.fullName) {
      await db.collection("users").updateOne(
        { tenant_id: params.tenantId, id: params.userId },
        { $set: { full_name: params.fullName } },
      );
    }

    const studentUpdates: Record<string, unknown> = {};
    if (params.skills) studentUpdates.skills = params.skills;
    if (params.profileData) studentUpdates.profile_data = params.profileData;

    if (Object.keys(studentUpdates).length > 0) {
      const result = await db.collection("students").updateOne(
        { tenant_id: params.tenantId, user_id: params.userId },
        { $set: studentUpdates },
      );
      if (result.matchedCount === 0) {
        throw new AppError("PROFILE_UPDATE_FAILED", "Student not found", 500);
      }
    }

    return this.getStudentProfile(params.tenantId, params.userId);
  },

  async getMastery(tenantId: string, studentId: string) {
    const db = await getMongoDb();
    const data = await db.collection("topic_mastery").find(
      { tenant_id: tenantId, student_id: studentId },
      { projection: { _id: 0, topic_id: 1, mastery_level: 1, total_attempts: 1, correct_attempts: 1, confidence_score: 1 } },
    ).sort({ mastery_level: -1 }).toArray();

    const topicIds = data.map((row) => String(row.topic_id));
    const topics = topicIds.length > 0
      ? await db.collection("topics").find(
          {
            id: { $in: topicIds },
            $or: [{ tenant_id: tenantId }, { tenant_id: null }],
          },
          { projection: { _id: 0, id: 1, name: 1 } },
        ).toArray()
      : [];
    const topicNameMap = new Map(topics.map((topic) => [String(topic.id), String(topic.name)]));

    return data.map((row) => ({
      topicId: String(row.topic_id),
      topicName: topicNameMap.get(String(row.topic_id)) ?? String(row.topic_id),
      masteryLevel: Number(row.mastery_level ?? 0),
      totalAttempts: Number(row.total_attempts ?? 0),
      correctAttempts: Number(row.correct_attempts ?? 0),
      confidenceScore: Number(row.confidence_score ?? 0),
    }));
  },

  async getTopicProgress(tenantId: string, studentId: string) {
    const db = await getMongoDb();

    const [topics, progressRows] = await Promise.all([
      db.collection("topics").find(
        { $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
        { projection: { _id: 0, id: 1, name: 1 } },
      ).sort({ name: 1 }).toArray(),
      db.collection("student_topic_progress").find(
        { tenant_id: tenantId, student_id: studentId },
        { projection: { _id: 0, topic_id: 1, status: 1, updated_at: 1, completed_at: 1 } },
      ).toArray(),
    ]);

    const progressMap = new Map(
      progressRows.map((row) => [
        String(row.topic_id),
        {
          status: String(row.status ?? "incomplete") as TopicProgressStatus,
          updatedAt: row.updated_at ? String(row.updated_at) : null,
          completedAt: row.completed_at ? String(row.completed_at) : null,
        },
      ]),
    );

    const items = topics.map((topic) => {
      const existing = progressMap.get(String(topic.id));
      const status = existing?.status ?? "incomplete";
      return {
        topicId: String(topic.id),
        topicName: String(topic.name),
        status,
        covered: status !== "incomplete",
        updatedAt: existing?.updatedAt ?? null,
        completedAt: existing?.completedAt ?? null,
      };
    });

    const totalTopics = items.length;
    const completeCount = items.filter((item) => item.status === "complete").length;
    const inProgressCount = items.filter((item) => item.status === "in_progress").length;
    const incompleteCount = items.filter((item) => item.status === "incomplete").length;
    const coveredCount = completeCount + inProgressCount;

    return {
      items,
      summary: {
        totalTopics,
        completeCount,
        inProgressCount,
        incompleteCount,
        coveredCount,
        completionPct: totalTopics > 0 ? Number(((completeCount / totalTopics) * 100).toFixed(1)) : 0,
      },
    };
  },

  async upsertTopicProgress(params: {
    tenantId: string;
    studentId: string;
    topicId: string;
    status: TopicProgressStatus;
  }) {
    const db = await getMongoDb();

    const topic = await db.collection("topics").findOne(
      { id: params.topicId, $or: [{ tenant_id: params.tenantId }, { tenant_id: null }] },
      { projection: { _id: 0, id: 1, name: 1 } },
    );

    if (!topic) {
      throw new AppError("TOPIC_NOT_FOUND", "Topic not found", 404);
    }

    const now = new Date().toISOString();
    const completedAt = params.status === "complete" ? now : null;

    await db.collection("student_topic_progress").updateOne(
      {
        tenant_id: params.tenantId,
        student_id: params.studentId,
        topic_id: params.topicId,
      },
      {
        $set: {
          status: params.status,
          covered: params.status !== "incomplete",
          updated_at: now,
          completed_at: completedAt,
        },
        $setOnInsert: {
          id: randomUUID(),
          created_at: now,
        },
      },
      { upsert: true },
    );

    return {
      topicId: String(topic.id),
      topicName: String(topic.name),
      status: params.status,
      covered: params.status !== "incomplete",
      updatedAt: now,
      completedAt,
    };
  },

  async upsertTopicProgressBulk(params: {
    tenantId: string;
    studentId: string;
    topicIds: string[];
    status: TopicProgressStatus;
  }) {
    const db = await getMongoDb();

    const uniqueTopicIds = [...new Set(params.topicIds)];
    if (uniqueTopicIds.length === 0) {
      return { updatedCount: 0, invalidTopicIds: [] as string[] };
    }

    const validTopics = await db.collection("topics").find(
      {
        id: { $in: uniqueTopicIds },
        $or: [{ tenant_id: params.tenantId }, { tenant_id: null }],
      },
      { projection: { _id: 0, id: 1 } },
    ).toArray();

    const validIds = new Set(validTopics.map((topic) => String(topic.id)));
    const invalidTopicIds = uniqueTopicIds.filter((topicId) => !validIds.has(topicId));
    const now = new Date().toISOString();
    const completedAt = params.status === "complete" ? now : null;

    if (validIds.size > 0) {
      await db.collection("student_topic_progress").bulkWrite(
        [...validIds].map((topicId) => ({
          updateOne: {
            filter: {
              tenant_id: params.tenantId,
              student_id: params.studentId,
              topic_id: topicId,
            },
            update: {
              $set: {
                status: params.status,
                covered: params.status !== "incomplete",
                updated_at: now,
                completed_at: completedAt,
              },
              $setOnInsert: {
                id: randomUUID(),
                created_at: now,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }

    return {
      updatedCount: validIds.size,
      invalidTopicIds,
      status: params.status,
      updatedAt: now,
    };
  },

  async getVaultCompanies(tenantId: string) {
    const db = await getMongoDb();
    const companies = await db.collection("companies").find(
      { $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
      { projection: { _id: 0, id: 1, name: 1, slug: 1, logo_url: 1 } },
    ).sort({ name: 1 }).toArray();

    const companyIds = companies.map((c) => String(c.id));
    if (companyIds.length === 0) return [];

    const vaultItems = await db.collection("vault_items").find(
      { tenant_id: tenantId, company_id: { $in: companyIds } },
      { projection: { company_id: 1 } },
    ).toArray();

    const counts = new Map<string, number>();
    vaultItems.forEach((item) => {
      const key = String(item.company_id);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });

    return companies.map((company) => ({
      id: String(company.id),
      name: String(company.name),
      slug: String(company.slug),
      logoUrl: company.logo_url ? String(company.logo_url) : null,
      resourceCount: counts.get(String(company.id)) ?? 0,
    }));
  },

  async getVaultByCompany(tenantId: string, companyId: string, type?: string) {
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { tenant_id: tenantId, company_id: companyId };
    if (type) filter.type = type;

    const data = await db.collection("vault_items").find(
      filter,
      { projection: { _id: 0, id: 1, type: 1, content: 1, difficulty: 1, topic_id: 1, created_at: 1 } },
    ).sort({ created_at: -1 }).toArray();

    return data.map((item) => ({
      id: String(item.id),
      type: String(item.type),
      content: String(item.content),
      difficulty: item.difficulty ? String(item.difficulty) : null,
      topicId: item.topic_id ? String(item.topic_id) : null,
      createdAt: String(item.created_at),
    }));
  },

  async getResources(tenantId: string, topicId?: string) {
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { tenant_id: tenantId, is_active: true };
    if (topicId) filter.topic_id = topicId;

    const data = await db.collection("resources").find(
      filter,
      { projection: { _id: 0, id: 1, title: 1, description: 1, url: 1, resource_type: 1, thumbnail_url: 1, duration_sec: 1, topic_id: 1 } },
    ).sort({ created_at: -1 }).toArray();

    return data.map((resource) => toResourceDto(resource));
  },

  async listTopics(tenantId: string, query?: string, limit = 20) {
    const db = await getMongoDb();
    const filter: Record<string, unknown> = {
      $or: [{ tenant_id: tenantId }, { tenant_id: null }],
    };

    if (query?.trim()) {
      filter.name = { $regex: escapeRegex(query.trim()), $options: "i" };
    }

    const data = await db.collection("topics").find(
      filter,
      { projection: { _id: 0, id: 1, name: 1 } },
    ).sort({ name: 1 }).limit(Math.min(Math.max(limit, 1), 50)).toArray();

    return data.map((topic) => ({
      id: String(topic.id),
      name: String(topic.name),
    }));
  },

  async searchResourcesByTopicName(tenantId: string, topicQuery: string) {
    const db = await getMongoDb();
    const query = topicQuery.trim();
    if (!query) {
      return {
        query: "",
        matchedTopics: [] as Array<{ id: string; name: string }>,
        resources: [] as Array<ReturnType<typeof toResourceDto>>,
      };
    }

    const regex = { $regex: escapeRegex(query), $options: "i" };
    const matchedTopics = await db.collection("topics").find(
      {
        $or: [{ tenant_id: tenantId }, { tenant_id: null }],
        name: regex,
      },
      { projection: { _id: 0, id: 1, name: 1 } },
    ).sort({ name: 1 }).limit(10).toArray();

    const topicIds = matchedTopics.map((topic) => String(topic.id));
    const filter: Record<string, unknown> = {
      tenant_id: tenantId,
      is_active: true,
    };

    if (topicIds.length > 0) {
      filter.topic_id = { $in: topicIds };
    } else {
      filter.$or = [{ title: regex }, { description: regex }];
    }

    const resources = await db.collection("resources").find(
      filter,
      { projection: { _id: 0, id: 1, title: 1, description: 1, url: 1, resource_type: 1, thumbnail_url: 1, duration_sec: 1, topic_id: 1, source_pdf: 1 } },
    ).sort({ created_at: -1 }).limit(100).toArray();

    return {
      query,
      matchedTopics: matchedTopics.map((topic) => ({
        id: String(topic.id),
        name: String(topic.name),
      })),
      resources: resources.map((resource) => toResourceDto(resource)),
    };
  },

  async listStudentsForTpo(
    tenantId: string,
    params: {
      limit: number;
      cursor?: string;
      batch?: string;
      branch?: string;
      cgpaMin?: number;
      cgpaMax?: number;
      backlogsMin?: number;
      backlogsMax?: number;
      sortBy: "cgpa" | "created_at";
      sortDir: "asc" | "desc";
    },
  ) {
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { tenant_id: tenantId };

    if (params.cursor) {
      filter.id = params.sortDir === "asc" ? { $gt: params.cursor } : { $lt: params.cursor };
    }
    if (params.batch) filter.batch = params.batch;
    if (params.branch) filter.branch = params.branch;
    if (params.cgpaMin !== undefined || params.cgpaMax !== undefined) {
      const cgpaFilter: Record<string, number> = {};
      if (params.cgpaMin !== undefined) cgpaFilter.$gte = params.cgpaMin;
      if (params.cgpaMax !== undefined) cgpaFilter.$lte = params.cgpaMax;
      filter.cgpa = cgpaFilter;
    }
    if (params.backlogsMin !== undefined || params.backlogsMax !== undefined) {
      const backlogsFilter: Record<string, number> = {};
      if (params.backlogsMin !== undefined) backlogsFilter.$gte = params.backlogsMin;
      if (params.backlogsMax !== undefined) backlogsFilter.$lte = params.backlogsMax;
      filter.backlogs = backlogsFilter;
    }

    const sortDirection = params.sortDir === "asc" ? 1 : -1;
    const data = await db.collection("students").find(
      filter,
      { projection: { _id: 0, id: 1, user_id: 1, roll_number: 1, branch: 1, batch: 1, cgpa: 1, backlogs: 1, attendance_pct: 1, readiness_score: 1, created_at: 1 } },
    ).sort({ [params.sortBy]: sortDirection, id: sortDirection }).limit(params.limit + 1).toArray();

    const hasMore = data.length > params.limit;
    const items = hasMore ? data.slice(0, params.limit) : data;

    const userIds = items.map((row) => String(row.user_id));
    const users = userIds.length > 0
      ? await db.collection("users").find(
          { id: { $in: userIds } },
          { projection: { id: 1, full_name: 1, email: 1 } },
        ).toArray()
      : [];
    const userMap = new Map(users.map((user) => [String(user.id), user]));

    return {
      items: items.map((row) => ({
        id: String(row.id),
        userId: String(row.user_id),
        fullName: String(userMap.get(String(row.user_id))?.full_name ?? ""),
        email: String(userMap.get(String(row.user_id))?.email ?? ""),
        rollNumber: row.roll_number ? String(row.roll_number) : "",
        branch: String(row.branch),
        batch: String(row.batch),
        cgpa: Number(row.cgpa ?? 0),
        backlogs: Number(row.backlogs ?? 0),
        attendancePct: Number(row.attendance_pct ?? 0),
        readinessScore: Number(row.readiness_score ?? 0),
      })),
      hasMore,
      nextCursor: hasMore ? String(items[items.length - 1]?.id) : null,
    };
  },

  async getStudentByIdForTpo(tenantId: string, studentId: string) {
    const db = await getMongoDb();

    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, id: studentId },
      { projection: { _id: 0, id: 1, user_id: 1, roll_number: 1, branch: 1, batch: 1, cgpa: 1, backlogs: 1, attendance_pct: 1, skills: 1, readiness_score: 1, profile_data: 1 } },
    );

    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student not found", 404);
    }

    const [user, attempts, mastery, driveResults] = await Promise.all([
      db.collection("users").findOne(
        { tenant_id: tenantId, id: String(student.user_id) },
        { projection: { full_name: 1, email: 1 } },
      ),
      db.collection("student_attempts").find(
        { tenant_id: tenantId, student_id: studentId, status: "submitted" },
        { projection: { id: 1, test_id: 1, score: 1, submitted_at: 1 } },
      ).sort({ submitted_at: -1 }).limit(20).toArray(),
      db.collection("topic_mastery").find(
        { tenant_id: tenantId, student_id: studentId },
        { projection: { topic_id: 1, mastery_level: 1 } },
      ).sort({ mastery_level: -1 }).limit(10).toArray(),
      db.collection("drive_results").find(
        { tenant_id: tenantId, student_id: studentId },
        { projection: { drive_id: 1, status: 1, outcome: 1, created_at: 1, updated_at: 1 } },
      ).sort({ updated_at: -1 }).toArray(),
    ]);

    const testIds = [...new Set(attempts.map((attempt) => String(attempt.test_id)))];
    const topicIds = [...new Set(mastery.map((item) => String(item.topic_id)))];

    const driveIds = driveResults.map((item) => String(item.drive_id));
    const [drives, testsMeta, topicsMeta] = await Promise.all([
      driveIds.length > 0
        ? db.collection("drives").find(
            { tenant_id: tenantId, id: { $in: driveIds } },
            { projection: { id: 1, company: 1, role: 1, drive_date: 1, status: 1 } },
          ).toArray()
        : Promise.resolve([]),
      testIds.length > 0
        ? db.collection("mock_tests").find(
            { id: { $in: testIds }, $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
            { projection: { _id: 0, id: 1, title: 1, difficulty: 1 } },
          ).toArray()
        : Promise.resolve([]),
      topicIds.length > 0
        ? db.collection("topics").find(
            { id: { $in: topicIds }, $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
            { projection: { _id: 0, id: 1, name: 1 } },
          ).toArray()
        : Promise.resolve([]),
    ]);

    const driveMap = new Map(drives.map((drive) => [String(drive.id), drive]));
    const testMap = new Map(testsMeta.map((test) => [String(test.id), test]));
    const topicMap = new Map(topicsMeta.map((topic) => [String(topic.id), topic]));

    return {
      id: String(student.id),
      userId: String(student.user_id),
      fullName: String(user?.full_name ?? ""),
      email: String(user?.email ?? ""),
      rollNumber: student.roll_number ? String(student.roll_number) : "",
      branch: String(student.branch),
      batch: String(student.batch),
      cgpa: Number(student.cgpa ?? 0),
      backlogs: Number(student.backlogs ?? 0),
      attendancePct: Number(student.attendance_pct ?? 0),
      skills: (student.skills ?? []) as string[],
      readinessScore: Number(student.readiness_score ?? 0),
      profileData: (student.profile_data ?? {}) as Record<string, unknown>,
      attempts: attempts.map((attempt) => ({
        id: String(attempt.id),
        testId: String(attempt.test_id),
        testTitle: String(testMap.get(String(attempt.test_id))?.title ?? String(attempt.test_id)),
        testDifficulty: String(testMap.get(String(attempt.test_id))?.difficulty ?? ""),
        score: Number(attempt.score ?? 0),
        submittedAt: attempt.submitted_at ? String(attempt.submitted_at) : null,
      })),
      mastery: mastery.map((item) => ({
        topicId: String(item.topic_id),
        topicName: String(topicMap.get(String(item.topic_id))?.name ?? String(item.topic_id)),
        masteryLevel: Number(item.mastery_level ?? 0),
      })),
      driveParticipation: driveResults.map((item) => {
        const drive = driveMap.get(String(item.drive_id));
        return {
          driveId: String(item.drive_id),
          company: String(drive?.company ?? ""),
          role: drive?.role ? String(drive.role) : null,
          driveDate: drive?.drive_date ? String(drive.drive_date) : null,
          driveStatus: drive?.status ? String(drive.status) : null,
          status: String(item.status),
          outcome: String(item.outcome),
          updatedAt: item.updated_at ? String(item.updated_at) : String(item.created_at ?? ""),
        };
      }),
    };
  },

  async updateStudentAcademicForTpo(
    tenantId: string,
    studentId: string,
    updates: {
      cgpa?: number;
      backlogs?: number;
      attendancePct?: number;
      branch?: string;
      batch?: string;
    },
  ) {
    const db = await getMongoDb();
    const payload: Record<string, unknown> = {};
    if (updates.cgpa !== undefined) payload.cgpa = updates.cgpa;
    if (updates.backlogs !== undefined) payload.backlogs = updates.backlogs;
    if (updates.attendancePct !== undefined) payload.attendance_pct = updates.attendancePct;
    if (updates.branch !== undefined) payload.branch = updates.branch;
    if (updates.batch !== undefined) payload.batch = updates.batch;

    const result = await db.collection("students").updateOne(
      { tenant_id: tenantId, id: studentId },
      { $set: payload },
    );

    if (result.matchedCount === 0) {
      throw new AppError("STUDENT_UPDATE_FAILED", "Student not found", 500);
    }

    return this.getStudentByIdForTpo(tenantId, studentId);
  },

  async upsertStudentsFromCsv(
    tenantId: string,
    rows: Array<Record<string, string>>,
    mapping: {
      fullName: string;
      email: string;
      rollNumber: string;
      branch: string;
      batch: string;
      cgpa?: string;
      backlogs?: string;
      attendancePct?: string;
    },
  ) {
    const db = await getMongoDb();
    const report = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [] as Array<{ row: number; message: string }>,
    };

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const email = row[mapping.email]?.trim().toLowerCase();
      const fullName = row[mapping.fullName]?.trim();
      const rollNumber = row[mapping.rollNumber]?.trim();
      const branch = row[mapping.branch]?.trim();
      const batch = row[mapping.batch]?.trim();

      if (!email || !rollNumber || !branch || !batch) {
        report.skipped += 1;
        report.errors.push({ row: index + 2, message: "Missing required fields" });
        continue;
      }

      const cgpa = mapping.cgpa ? Number(row[mapping.cgpa] || 0) : 0;
      const backlogs = mapping.backlogs ? Number(row[mapping.backlogs] || 0) : 0;
      const attendancePct = mapping.attendancePct ? Number(row[mapping.attendancePct] || 0) : 0;

      if (!Number.isFinite(cgpa) || cgpa < 0 || cgpa > 10) {
        report.skipped += 1;
        report.errors.push({ row: index + 2, message: "Invalid cgpa value" });
        continue;
      }
      if (!Number.isFinite(backlogs) || backlogs < 0) {
        report.skipped += 1;
        report.errors.push({ row: index + 2, message: "Invalid backlogs value" });
        continue;
      }
      if (!Number.isFinite(attendancePct) || attendancePct < 0 || attendancePct > 100) {
        report.skipped += 1;
        report.errors.push({ row: index + 2, message: "Invalid attendancePct value" });
        continue;
      }

      const existingStudent = await db.collection("students").findOne(
        { tenant_id: tenantId, roll_number: rollNumber },
        { projection: { id: 1, user_id: 1 } },
      );

      if (existingStudent) {
        await db.collection("users").updateOne(
          { tenant_id: tenantId, id: String(existingStudent.user_id) },
          { $set: { full_name: fullName, email } },
        );

        await db.collection("students").updateOne(
          { tenant_id: tenantId, id: String(existingStudent.id) },
          { $set: { branch, batch, cgpa, backlogs, attendance_pct: attendancePct } },
        );

        report.updated += 1;
        continue;
      }

      // Create new user + student (MongoDB-only auth, no Supabase)
      const userId = randomUUID();
      const timestamp = new Date().toISOString();
      const tempPassword = `CampusDrive!${randomUUID()}`;
      const passwordHash = await bcryptHash(tempPassword, 12);

      try {
        await db.collection("users").insertOne({
          id: userId,
          tenant_id: tenantId,
          email,
          role: "student",
          full_name: fullName || email,
          is_active: true,
          password_hash: passwordHash,
          created_at: timestamp,
          updated_at: timestamp,
        });

        await db.collection("students").insertOne({
          id: randomUUID(),
          tenant_id: tenantId,
          user_id: userId,
          roll_number: rollNumber,
          branch,
          batch,
          cgpa,
          backlogs,
          attendance_pct: attendancePct,
          skills: [],
          points: 0,
          streak_current: 0,
          streak_longest: 0,
          readiness_score: 0,
          profile_data: {},
          created_at: timestamp,
          updated_at: timestamp,
        });

        report.created += 1;
      } catch (err) {
        // Rollback user if student insert fails
        await db.collection("users").deleteOne({ tenant_id: tenantId, id: userId });
        report.skipped += 1;
        report.errors.push({ row: index + 2, message: err instanceof Error ? err.message : "Insert failed" });
      }
    }

    return report;
  },
};
