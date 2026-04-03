import { getMongoDb } from "../utils/mongodb.js";
import { StudentActivityService } from "./student-activity.service.js";
import { buildStudentProfileSummary } from "../utils/student-profile.js";
import { buildStudentDeclarationStatus } from "../utils/student-declaration.js";

type ImpactLabel = "Low" | "Medium" | "High";
type RiskLevel = "Low" | "Moderate" | "High" | "Critical";
const CONTROL_CENTER_CACHE_TTL_MS = 15000;
const controlCenterCache = new Map<string, { expiresAt: number; value: Awaited<ReturnType<typeof computeControlCenter>> }>();

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function paginateArray<T>(items: T[], page = 1, limit = 20) {
  const safePage = Math.max(1, Number(page || 1));
  const safeLimit = clamp(Number(limit || 20), 1, 100);
  const total = items.length;
  const offset = (safePage - 1) * safeLimit;

  return {
    items: items.slice(offset, offset + safeLimit),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total > 0 ? Math.ceil(total / safeLimit) : 1,
      hasMore: offset + safeLimit < total,
    },
  };
}

function startDateIso(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function weekBucket(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate.slice(0, 10);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function impactLabel(score: number): ImpactLabel {
  if (score >= 75) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

function riskLevel(score: number): RiskLevel {
  if (score >= 60) return "Critical";
  if (score >= 40) return "High";
  if (score >= 20) return "Moderate";
  return "Low";
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function maxIsoDate(values: Array<string | null | undefined>): string | null {
  const filtered = values.filter((value): value is string => Boolean(value));
  if (filtered.length === 0) return null;
  return filtered.sort((a, b) => b.localeCompare(a))[0];
}

function daysUntil(dateIso: string): number | null {
  if (!dateIso) return null;
  const target = new Date(dateIso);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function deriveProfileCompleteness(input: {
  student: Record<string, unknown>;
  walletCount: number;
  codingCount: number;
  interviewCount: number;
  email: string;
  fullName: string;
}) {
  const summary = buildStudentProfileSummary({
    student: input.student,
    user: {
      full_name: input.fullName,
      email: input.email,
    },
  });

  return {
    completenessPct: summary.profileCompleteness.pct,
    missingFields: summary.missingRequiredFields.map((item) => item.label),
    missingResume: summary.missingRequiredFields.some((item) => item.key === "resumeUrl"),
    missingStudentAction: summary.missingStudentFields.length > 0,
    missingCollegeAction: summary.missingSeededFields.length > 0,
    missingCertificates: input.walletCount === 0,
    missingCodingProfile: input.codingCount === 0,
    missingInterviewProfile: input.interviewCount === 0,
  };
}

async function computeControlCenter(tenantId: string) {
  const db = await getMongoDb();
  const start7 = startDateIso(7);
  const start14 = startDateIso(14);
  const start30 = startDateIso(30);
  const start90 = startDateIso(90);
  const todayIso = new Date().toISOString().slice(0, 10);

  const [
    students,
    users,
    studyHours,
    attempts,
    tests,
    aiConversations,
    interviewSessions,
    codingProfiles,
    mentorshipMatches,
    walletItems,
    resourceViewEvents,
    sharedResources,
    drives,
    driveResults,
    topicMastery,
    topics,
    topicProgress,
    profileUnlockRequests,
    studentSupportRequests,
    supportAccessRequests,
    publishedAnnouncementCount,
    sentCommunicationCount,
  ] = await Promise.all([
    db.collection("students").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, id: 1, user_id: 1, roll_number: 1, branch: 1, batch: 1, cgpa: 1, backlogs: 1, attendance_pct: 1, readiness_score: 1, skills: 1, profile_data: 1, created_at: 1 } },
    ).toArray(),
    db.collection("users").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, id: 1, full_name: 1, email: 1 } },
    ).toArray(),
    db.collection("study_hours").find(
      { tenant_id: tenantId, study_date: { $gte: start90 } },
      { projection: { _id: 0, id: 1, student_id: 1, topic_id: 1, study_date: 1, hours: 1, created_at: 1 } },
    ).toArray(),
    db.collection("student_attempts").find(
      { tenant_id: tenantId, status: "submitted", submitted_at: { $gte: `${start90}T00:00:00.000Z` } },
      { projection: { _id: 0, id: 1, student_id: 1, test_id: 1, score: 1, submitted_at: 1 } },
    ).toArray(),
    db.collection("mock_tests").find(
      { $or: [{ tenant_id: tenantId }, { tenant_id: null }], is_active: true },
      { projection: { _id: 0, id: 1, title: 1, difficulty: 1 } },
    ).toArray(),
    db.collection("ai_conversations").find(
      { tenant_id: tenantId, updated_at: { $gte: `${start30}T00:00:00.000Z` } },
      { projection: { _id: 0, id: 1, student_id: 1, updated_at: 1, topic: 1 } },
    ).toArray(),
    db.collection("interview_sessions").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, id: 1, student_id: 1, company: 1, role: 1, answer_feedback: 1, overall_score: 1, created_at: 1, completed_at: 1, status: 1 } },
    ).toArray(),
    db.collection("coding_profiles").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, id: 1, student_id: 1, platform: 1, solved_count: 1, weekly_goal: 1, streak_days: 1, updated_at: 1 } },
    ).toArray(),
    db.collection("mentorship_matches").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, id: 1, student_id: 1, domain: 1, created_at: 1 } },
    ).toArray(),
    db.collection("achievement_wallet").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, id: 1, student_id: 1, type: 1, title: 1, achieved_at: 1, created_at: 1 } },
    ).toArray(),
    db.collection("resource_view_events").find(
      { tenant_id: tenantId, created_at: { $gte: `${start7}T00:00:00.000Z` } },
      { projection: { _id: 0, student_id: 1, resource_id: 1, event_type: 1, session_id: 1, duration_sec: 1, progress_pct: 1, page_number: 1, source_context: 1, metadata: 1, created_at: 1 } },
    ).toArray(),
    db.collection("shared_resources").find(
      { is_active: true },
      { projection: { _id: 0, id: 1, title: 1, resource_type: 1, topic_id: 1 } },
    ).toArray(),
    db.collection("drives").find(
      { tenant_id: tenantId, deleted_at: null },
      { projection: { _id: 0, id: 1, company: 1, role: 1, drive_date: 1, status: 1, eligible_count: 1 } },
    ).toArray(),
    db.collection("drive_results").find(
      { tenant_id: tenantId },
      {
        projection: {
          _id: 0,
          drive_id: 1,
          student_id: 1,
          status: 1,
          outcome: 1,
          application_state: 1,
          updated_at: 1,
          created_at: 1,
          result_released_at: 1,
          resume_drive_file_id_at_application: 1,
          resume_drive_web_link_at_application: 1,
        },
      },
    ).toArray(),
    db.collection("topic_mastery").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, student_id: 1, topic_id: 1, mastery_level: 1 } },
    ).toArray(),
    db.collection("topics").find(
      { $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
      { projection: { _id: 0, id: 1, name: 1 } },
    ).toArray(),
    db.collection("student_topic_progress").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, id: 1, student_id: 1, topic_id: 1, status: 1, updated_at: 1, created_at: 1, completed_at: 1 } },
    ).toArray(),
    db.collection("profile_unlock_requests").find(
      { tenant_id: tenantId, status: "pending" },
      {
        projection: {
          _id: 0,
          id: 1,
          student_id: 1,
          status: 1,
          reason_category: 1,
          requested_fields: 1,
          explanation: 1,
          created_at: 1,
          updated_at: 1,
        },
      },
    ).sort({ created_at: 1 }).limit(20).toArray(),
    db.collection("student_support_requests").find(
      { tenant_id: tenantId, status: "open" },
      {
        projection: {
          _id: 0,
          id: 1,
          student_id: 1,
          student_email: 1,
          student_name: 1,
          subject: 1,
          message: 1,
          created_at: 1,
          updated_at: 1,
        },
      },
    ).sort({ created_at: 1 }).limit(20).toArray(),
    db.collection("support_sessions").find(
      { tenant_id: tenantId, status: "pending" },
      {
        projection: {
          _id: 0,
          id: 1,
          requested_by_email: 1,
          reason: 1,
          created_at: 1,
        },
      },
    ).sort({ created_at: 1 }).limit(20).toArray(),
    db.collection("announcements").countDocuments({ tenant_id: tenantId, status: "published" }),
    db.collection("communications").countDocuments({ tenant_id: tenantId, status: { $in: ["sent", "partial"] } }),
  ]);

  const userMap = new Map(users.map((user) => [String(user.id), { fullName: String(user.full_name ?? ""), email: String(user.email ?? "") }]));
  const studentMap = new Map(students.map((student) => [String(student.id), student]));
  const topicMap = new Map(topics.map((topic) => [String(topic.id), String(topic.name ?? "")]));
  const testMap = new Map(tests.map((test) => [String(test.id), { title: String(test.title ?? ""), difficulty: String(test.difficulty ?? "unknown") }]));
  const resourceMap = new Map(sharedResources.map((resource) => [
    String(resource.id),
    {
      title: String(resource.title ?? "Resource"),
      resourceType: String(resource.resource_type ?? "resource"),
      topicName: topicMap.get(String(resource.topic_id ?? "")) ?? null,
    },
  ]));

  const studyByStudent = new Map<string, Array<Record<string, unknown>>>();
  const attemptsByStudent = new Map<string, Array<Record<string, unknown>>>();
  const aiByStudent = new Map<string, Array<Record<string, unknown>>>();
  const interviewByStudent = new Map<string, Array<Record<string, unknown>>>();
  const codingByStudent = new Map<string, Array<Record<string, unknown>>>();
  const mentorshipByStudent = new Map<string, Array<Record<string, unknown>>>();
  const walletByStudent = new Map<string, Array<Record<string, unknown>>>();
  const driveResultsByStudent = new Map<string, Array<Record<string, unknown>>>();
  const driveResultsByDrive = new Map<string, Array<Record<string, unknown>>>();
  const masteryByStudent = new Map<string, Array<Record<string, unknown>>>();
  const progressByStudent = new Map<string, Array<Record<string, unknown>>>();

  studyHours.forEach((entry) => {
    const key = String(entry.student_id);
    const list = studyByStudent.get(key) ?? [];
    list.push({
      id: String(entry.id ?? ""),
      studyDate: String(entry.study_date ?? ""),
      hours: Number(entry.hours ?? 0),
      topicId: String(entry.topic_id ?? ""),
      createdAt: String(entry.created_at ?? ""),
    });
    studyByStudent.set(key, list);
  });

  attempts.forEach((entry) => {
    const key = String(entry.student_id);
    const list = attemptsByStudent.get(key) ?? [];
    list.push({
      id: String(entry.id ?? ""),
      score: Number(entry.score ?? 0),
      testId: String(entry.test_id ?? ""),
      submittedAt: String(entry.submitted_at ?? ""),
      difficulty: String(testMap.get(String(entry.test_id ?? ""))?.difficulty ?? "unknown"),
    });
    attemptsByStudent.set(key, list);
  });
  attemptsByStudent.forEach((list) => list.sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt))));

  aiConversations.forEach((entry) => {
    const key = String(entry.student_id);
    const list = aiByStudent.get(key) ?? [];
    list.push({
      id: String(entry.id ?? ""),
      updatedAt: String(entry.updated_at ?? ""),
      topic: String(entry.topic ?? "general"),
    });
    aiByStudent.set(key, list);
  });

  interviewSessions.forEach((entry) => {
    const key = String(entry.student_id);
    const list = interviewByStudent.get(key) ?? [];
    list.push(entry as Record<string, unknown>);
    interviewByStudent.set(key, list);
  });

  codingProfiles.forEach((entry) => {
    const key = String(entry.student_id);
    const list = codingByStudent.get(key) ?? [];
    list.push(entry as Record<string, unknown>);
    codingByStudent.set(key, list);
  });

  mentorshipMatches.forEach((entry) => {
    const key = String(entry.student_id);
    const list = mentorshipByStudent.get(key) ?? [];
    list.push(entry as Record<string, unknown>);
    mentorshipByStudent.set(key, list);
  });

  walletItems.forEach((entry) => {
    const key = String(entry.student_id);
    const list = walletByStudent.get(key) ?? [];
    list.push(entry as Record<string, unknown>);
    walletByStudent.set(key, list);
  });

  driveResults.forEach((entry) => {
    const studentKey = String(entry.student_id ?? "");
    const driveKey = String(entry.drive_id ?? "");
    if (studentKey) {
      const studentList = driveResultsByStudent.get(studentKey) ?? [];
      studentList.push(entry as Record<string, unknown>);
      driveResultsByStudent.set(studentKey, studentList);
    }
    const driveList = driveResultsByDrive.get(driveKey) ?? [];
    driveList.push(entry as Record<string, unknown>);
    driveResultsByDrive.set(driveKey, driveList);
  });

  topicMastery.forEach((entry) => {
    const key = String(entry.student_id);
    const list = masteryByStudent.get(key) ?? [];
    list.push({
      topicId: String(entry.topic_id ?? ""),
      masteryLevel: Number(entry.mastery_level ?? 0),
    });
    masteryByStudent.set(key, list);
  });

  topicProgress.forEach((entry) => {
    const key = String(entry.student_id);
    const list = progressByStudent.get(key) ?? [];
    list.push(entry as Record<string, unknown>);
    progressByStudent.set(key, list);
  });

  const events = [] as Array<Record<string, unknown>>;
  resourceViewEvents.forEach((entry) => {
    const eventType = String(entry.event_type ?? "");
    if (eventType !== "open" && eventType !== "external_redirect") return;

    const resourceTitle = entry.metadata && typeof entry.metadata === "object"
      ? String((entry.metadata as Record<string, unknown>).resourceTitle ?? "learning resource")
      : "learning resource";

    events.push({
      id: `resource:${String(entry.session_id ?? "")}:${eventType}:${String(entry.created_at ?? "")}`,
      tenant_id: tenantId,
      student_id: String(entry.student_id),
      event_type: eventType === "open" ? "resource_opened" : "resource_external_redirect",
      event_source: "resource_viewer",
      entity_id: String(entry.resource_id ?? ""),
      entity_type: "resource",
      title: eventType === "open" ? "Opened learning resource" : "Opened external learning resource",
      description: eventType === "open"
        ? `Opened ${resourceTitle}.`
        : `Opened external resource ${resourceTitle}.`,
      metadata: {
        resourceId: String(entry.resource_id ?? ""),
        resourceTitle,
        sourceContext: String(entry.source_context ?? ""),
        pageNumber: Number(entry.page_number ?? 0),
      },
      impact_score: eventType === "open" ? 28 : 18,
      created_at: String(entry.created_at ?? new Date().toISOString()),
    });
  });

  studyHours.forEach((entry) => {
    events.push({
      id: `study:${String(entry.id ?? "")}`,
      tenant_id: tenantId,
      student_id: String(entry.student_id),
      event_type: "study_logged",
      event_source: "study_hours",
      entity_id: String(entry.id ?? ""),
      entity_type: "study_hour",
      title: "Study hours logged",
      description: `${Number(entry.hours ?? 0).toFixed(1)} hour(s) logged for ${topicMap.get(String(entry.topic_id)) ?? "a topic"}.`,
      metadata: { topicId: String(entry.topic_id ?? ""), studyDate: String(entry.study_date ?? "") },
      impact_score: 35,
      created_at: `${String(entry.study_date ?? todayIso)}T00:00:00.000Z`,
    });
  });

  topicProgress.forEach((entry) => {
    const status = String(entry.status ?? "");
    if (status === "in_progress" || status === "complete") {
      events.push({
        id: `progress:${String(entry.id ?? "")}:${status}`,
        tenant_id: tenantId,
        student_id: String(entry.student_id),
        event_type: status === "complete" ? "topic_completed" : "topic_started",
        event_source: "student_topic_progress",
        entity_id: String(entry.id ?? ""),
        entity_type: "topic_progress",
        title: status === "complete" ? "Topic completed" : "Topic started",
        description: `${topicMap.get(String(entry.topic_id)) ?? "Topic"} marked as ${status.replace("_", " ")}.`,
        metadata: { topicId: String(entry.topic_id ?? ""), status },
        impact_score: status === "complete" ? 70 : 30,
        created_at: String(entry.completed_at ?? entry.updated_at ?? entry.created_at ?? new Date().toISOString()),
      });
    }
  });

  attemptsByStudent.forEach((studentAttempts, studentId) => {
    studentAttempts.forEach((attempt, index) => {
      events.push({
        id: `attempt:${String(attempt.id)}`,
        tenant_id: tenantId,
        student_id: studentId,
        event_type: "mock_submitted",
        event_source: "student_attempts",
        entity_id: String(attempt.id),
        entity_type: "mock_attempt",
        title: "Mock test submitted",
        description: `${testMap.get(String(attempt.testId))?.title ?? "Mock test"} submitted with score ${Number(attempt.score).toFixed(1)}%.`,
        metadata: { testId: String(attempt.testId), score: Number(attempt.score) },
        impact_score: Number(attempt.score) >= 70 ? 78 : 52,
        created_at: String(attempt.submittedAt),
      });
      if (index > 0) {
        const delta = Number(attempt.score) - Number(studentAttempts[index - 1].score);
        if (delta >= 5) {
          events.push({
            id: `attempt-improved:${String(attempt.id)}`,
            tenant_id: tenantId,
            student_id: studentId,
            event_type: "mock_improved",
            event_source: "student_attempts",
            entity_id: String(attempt.id),
            entity_type: "mock_attempt",
            title: "Mock score improved",
            description: `Mock score improved by ${delta.toFixed(1)} points.`,
            metadata: { scoreDelta: delta },
            impact_score: 82,
            created_at: String(attempt.submittedAt),
          });
        }
      }
    });
  });

  aiConversations.forEach((entry) => {
    events.push({
      id: `ai:${String(entry.id ?? "")}`,
      tenant_id: tenantId,
      student_id: String(entry.student_id),
      event_type: "ai_used",
      event_source: "ai_conversations",
      entity_id: String(entry.id ?? ""),
      entity_type: "ai_conversation",
      title: "AI assistant used",
      description: `Asked AI for help on ${String(entry.topic ?? "general")}.`,
      metadata: { topic: String(entry.topic ?? "general") },
      impact_score: 42,
      created_at: String(entry.updated_at ?? new Date().toISOString()),
    });
  });

  interviewSessions.forEach((entry) => {
    const createdAt = String(entry.created_at ?? new Date().toISOString());
    events.push({
      id: `interview-start:${String(entry.id ?? "")}`,
      tenant_id: tenantId,
      student_id: String(entry.student_id),
      event_type: "interview_started",
      event_source: "interview_sessions",
      entity_id: String(entry.id ?? ""),
      entity_type: "interview_session",
      title: "Interview session started",
      description: `${String(entry.company ?? "Company")} ${String(entry.role ?? "")} interview practice started.`,
      metadata: { company: String(entry.company ?? ""), role: String(entry.role ?? "") },
      impact_score: 55,
      created_at: createdAt,
    });
    const feedback = Array.isArray(entry.answer_feedback) ? entry.answer_feedback as Array<Record<string, unknown> | null> : [];
    feedback.forEach((item, index) => {
      if (!item) return;
      events.push({
        id: `interview-feedback:${String(entry.id ?? "")}:${index}`,
        tenant_id: tenantId,
        student_id: String(entry.student_id),
        event_type: "interview_answer_analyzed",
        event_source: "interview_sessions",
        entity_id: String(entry.id ?? ""),
        entity_type: "interview_answer",
        title: "Interview answer analyzed",
        description: `Voice answer scored ${Number(item.overallScore ?? 0).toFixed(1)}%.`,
        metadata: { questionIndex: Number(item.questionIndex ?? index), overallScore: Number(item.overallScore ?? 0) },
        impact_score: 68,
        created_at: String(entry.completed_at ?? createdAt),
      });
    });
  });

  codingProfiles.forEach((entry) => {
    events.push({
      id: `coding:${String(entry.id ?? "")}`,
      tenant_id: tenantId,
      student_id: String(entry.student_id),
      event_type: "coding_profile_synced",
      event_source: "coding_profiles",
      entity_id: String(entry.id ?? ""),
      entity_type: "coding_profile",
      title: "Coding tracker synced",
      description: `${String(entry.platform ?? "Coding platform")} synced with ${Number(entry.solved_count ?? 0)} solved problems.`,
      metadata: { platform: String(entry.platform ?? ""), solvedCount: Number(entry.solved_count ?? 0) },
      impact_score: 58,
      created_at: String(entry.updated_at ?? new Date().toISOString()),
    });
  });

  mentorshipMatches.forEach((entry) => {
    events.push({
      id: `mentorship:${String(entry.id ?? "")}`,
      tenant_id: tenantId,
      student_id: String(entry.student_id),
      event_type: "mentorship_requested",
      event_source: "mentorship_matches",
      entity_id: String(entry.id ?? ""),
      entity_type: "mentorship_match",
      title: "Mentorship requested",
      description: `Mentorship match created for ${String(entry.domain ?? "career guidance")}.`,
      metadata: { domain: String(entry.domain ?? "") },
      impact_score: 44,
      created_at: String(entry.created_at ?? new Date().toISOString()),
    });
  });

  walletItems.forEach((entry) => {
    events.push({
      id: `wallet:${String(entry.id ?? "")}`,
      tenant_id: tenantId,
      student_id: String(entry.student_id),
      event_type: "wallet_item_added",
      event_source: "achievement_wallet",
      entity_id: String(entry.id ?? ""),
      entity_type: "wallet_item",
      title: "Achievement wallet updated",
      description: `${String(entry.title ?? entry.type ?? "Achievement")} added to wallet.`,
      metadata: { type: String(entry.type ?? ""), title: String(entry.title ?? "") },
      impact_score: 36,
      created_at: String(entry.created_at ?? entry.achieved_at ?? new Date().toISOString()),
    });
  });

  driveResults.forEach((entry) => {
    const status = String(entry.status ?? "");
    if (!status) return;
    events.push({
      id: `drive:${String(entry.drive_id ?? "")}:${String(entry.student_id ?? "")}:${status}`,
      tenant_id: tenantId,
      student_id: String(entry.student_id ?? ""),
      event_type: "drive_eligibility_changed",
      event_source: "drive_results",
      entity_id: String(entry.drive_id ?? ""),
      entity_type: "drive_result",
      title: "Drive status updated",
      description: `Drive participation marked as ${status}.`,
      metadata: { driveId: String(entry.drive_id ?? ""), status, outcome: String(entry.outcome ?? "") },
      impact_score: status === "eligible" ? 76 : 48,
      created_at: String(entry.updated_at ?? entry.created_at ?? new Date().toISOString()),
    });
  });

  events.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const operationsRows = students.map((student) => {
    const studentId = String(student.id);
    const user = userMap.get(String(student.user_id)) ?? { fullName: "", email: "" };
    const study = studyByStudent.get(studentId) ?? [];
    const attemptsList = attemptsByStudent.get(studentId) ?? [];
    const aiList = aiByStudent.get(studentId) ?? [];
    const interviewList = interviewByStudent.get(studentId) ?? [];
    const codingList = codingByStudent.get(studentId) ?? [];
    const walletList = walletByStudent.get(studentId) ?? [];
    const driveList = driveResultsByStudent.get(studentId) ?? [];
    const declarationStatus = buildStudentDeclarationStatus({
      student: student as Record<string, unknown>,
      user: {
        full_name: user.fullName,
        email: user.email,
      },
    });

    const lastActiveAt = maxIsoDate([
      study.length > 0 ? `${String(study[study.length - 1].studyDate)}T00:00:00.000Z` : null,
      attemptsList.length > 0 ? String(attemptsList[attemptsList.length - 1].submittedAt) : null,
      aiList.length > 0 ? [...aiList].sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt))).at(-1)?.updatedAt as string : null,
      codingList.length > 0 ? [...codingList].sort((a, b) => String(a.updated_at ?? "").localeCompare(String(b.updated_at ?? ""))).at(-1)?.updated_at as string : null,
      interviewList.length > 0 ? maxIsoDate(interviewList.map((row) => String(row.completed_at ?? row.created_at ?? ""))) : null,
      walletList.length > 0 ? maxIsoDate(walletList.map((row) => String(row.created_at ?? row.achieved_at ?? ""))) : null,
    ]);
    const isActive7d = Boolean(lastActiveAt && lastActiveAt.slice(0, 10) >= start7);
    const studyHours7d = Number(study.filter((row) => String(row.studyDate) >= start7).reduce((sum, row) => sum + Number(row.hours ?? 0), 0).toFixed(2));
    const mockAvg = average(attemptsList.map((row) => Number(row.score ?? 0)));
    const mockAttempts = attemptsList.length;
    const codingSolved = codingList.reduce((sum, row) => sum + Number(row.solved_count ?? 0), 0);
    const interviewFeedback = interviewList.flatMap((row) =>
      Array.isArray(row.answer_feedback) ? row.answer_feedback as Array<Record<string, unknown> | null> : []);
    const interviewScore = interviewFeedback.length > 0
      ? average(interviewFeedback.filter((item): item is Record<string, unknown> => Boolean(item)).map((item) => Number(item.overallScore ?? 0)))
      : average(interviewList.map((row) => Number(row.overall_score ?? 0)).filter((value) => value > 0));
    const normalizedInterviewScore = interviewScore > 0 ? interviewScore : null;
    const aiUsage7d = aiList.filter((row) => String(row.updatedAt).slice(0, 10) >= start7).length;
    const profile = deriveProfileCompleteness({
      student: student as Record<string, unknown>,
      walletCount: walletList.length,
      codingCount: codingList.length,
      interviewCount: interviewList.length,
      email: user.email,
      fullName: user.fullName,
    });
    const profileCertified = declarationStatus.profileCertification.isCertified;
    const hasResumeReady = !profile.missingResume;
    const profileComplete = profile.completenessPct >= 100;
    const eligibleUpcoming = driveList.some((item) => String(item.status ?? "") === "eligible");
    const appliedRecently = driveList.some((item) => {
      const applicationState = String(item.application_state ?? "");
      const appliedAt = String(item.updated_at ?? item.created_at ?? "");
      return applicationState === "applied" && appliedAt.slice(0, 10) >= start30;
    });
    const driveImpact = eligibleUpcoming && profile.completenessPct < 100
      ? "Eligible for upcoming drive but profile is incomplete."
      : eligibleUpcoming
        ? "Eligible for upcoming drive."
        : "No immediate drive risk.";

    const reasons: string[] = [];
    let risk = 0;
    if (!isActive7d) {
      risk += 20;
      reasons.push("Inactive in the last 7 days");
    }
    if (Number(student.readiness_score ?? 0) < 50) {
      risk += 25;
      reasons.push("Readiness score below 50");
    }
    if (!attemptsList.some((row) => String(row.submittedAt).slice(0, 10) >= start14)) {
      risk += 20;
      reasons.push("No mock attempt in the last 14 days");
    }
    if (mockAttempts > 0 && mockAvg < 55) {
      risk += 15;
      reasons.push("Low mock test average");
    }
    if (normalizedInterviewScore !== null && normalizedInterviewScore < 60) {
      risk += 10;
      reasons.push("Low interview performance");
    }
    if (codingList.length === 0) {
      risk += 5;
      reasons.push("Coding tracker not linked");
    }
    if (profile.completenessPct < 100) {
      risk += 15;
      reasons.push("Profile completeness below 100%");
    }
    if (eligibleUpcoming && (Number(student.readiness_score ?? 0) < 60 || mockAvg < 55 || profile.completenessPct < 100 || !isActive7d)) {
      risk += 10;
      reasons.push("Eligible but underprepared for upcoming drive");
    }

    const nextRecommendedAction = reasons[0]?.includes("Inactive")
      ? "Send direct reminder and schedule check-in."
      : reasons[0]?.includes("Readiness")
        ? "Assign focused study plan and mock test target."
        : reasons[0]?.includes("mock")
          ? "Push mandatory mock practice this week."
          : reasons[0]?.includes("interview")
            ? "Assign voice interview practice."
            : reasons[0]?.includes("Profile")
              ? "Complete resume and profile fields before next drive."
              : eligibleUpcoming
                ? "Review drive preparedness and intervene."
                : "Maintain current progress.";

    return {
      studentId,
      fullName: user.fullName || studentId,
      email: user.email,
      rollNumber: String(student.roll_number ?? ""),
      branch: String(student.branch ?? ""),
      batch: String(student.batch ?? ""),
      readinessScore: Number(student.readiness_score ?? 0),
      lastActiveAt,
      isActive7d,
      studyHours7d,
      mockAvg,
      mockAttempts,
      codingSolved,
      interviewScore: normalizedInterviewScore,
      aiUsage7d,
      profileCompletenessPct: profile.completenessPct,
      profileMissingFields: profile.missingFields,
      isProfileCertified: profileCertified,
      hasResumeReady,
      isProfileComplete: profileComplete,
      appliedRecently,
      riskScore: risk,
      riskLevel: riskLevel(risk),
      riskReasons: reasons,
      nextRecommendedAction,
      driveEligibleUpcoming: eligibleUpcoming,
      driveImpact,
    };
  }).sort((a, b) => b.riskScore - a.riskScore || a.fullName.localeCompare(b.fullName));

  const weakTopicsByBranchMap = new Map<string, Map<string, number[]>>();
  students.forEach((student) => {
    const branch = String(student.branch ?? "Unknown");
    const studentMastery = masteryByStudent.get(String(student.id)) ?? [];
    studentMastery.forEach((entry) => {
      const branchMap = weakTopicsByBranchMap.get(branch) ?? new Map<string, number[]>();
      const values = branchMap.get(String(entry.topicId)) ?? [];
      values.push(Number(entry.masteryLevel ?? 0));
      branchMap.set(String(entry.topicId), values);
      weakTopicsByBranchMap.set(branch, branchMap);
    });
  });

  const weakTopicsByBranch = [...weakTopicsByBranchMap.entries()].flatMap(([branch, topicValues]) =>
    [...topicValues.entries()]
      .map(([topicId, values]) => ({
        branch,
        topicName: topicMap.get(topicId) ?? topicId,
        avgMastery: average(values),
        studentsCovered: values.length,
      }))
      .sort((a, b) => a.avgMastery - b.avgMastery)
      .slice(0, 3),
  );

  const readinessTrendMap = new Map<string, number[]>();
  attempts.forEach((attempt) => {
    const bucket = weekBucket(String(attempt.submitted_at ?? ""));
    const values = readinessTrendMap.get(bucket) ?? [];
    values.push(Number(attempt.score ?? 0));
    readinessTrendMap.set(bucket, values);
  });
  const readinessTrend = [...readinessTrendMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, values]) => ({ date, avgScore: average(values) }));

  const batchActivityMap = new Map<string, { active: number; inactive: number }>();
  operationsRows.forEach((row) => {
    const current = batchActivityMap.get(row.batch || "Unknown") ?? { active: 0, inactive: 0 };
    if (row.isActive7d) current.active += 1;
    else current.inactive += 1;
    batchActivityMap.set(row.batch || "Unknown", current);
  });
  const batchActivity = [...batchActivityMap.entries()].map(([batch, counts]) => ({ batch, ...counts }));

  const totalStudents = operationsRows.length;
  const activeStudents7d = operationsRows.filter((row) => row.isActive7d).length;
  const avgReadiness = average(operationsRows.map((row) => row.readinessScore));
  const upcomingDriveItems = drives.filter((drive) => String(drive.status ?? "") === "upcoming" || String(drive.drive_date ?? "") >= todayIso);
  const atRiskStudents = operationsRows.filter((row) => row.riskScore >= 20).length;
  const profileCompletePct = totalStudents > 0
    ? Number(((operationsRows.filter((row) => row.profileCompletenessPct >= 100).length / totalStudents) * 100).toFixed(2))
    : 0;

  const inactiveCount = operationsRows.filter((row) => !row.isActive7d).length;
  const noMock14Count = operationsRows.filter((row) => row.riskReasons.includes("No mock attempt in the last 14 days")).length;
  const incompleteProfileCount = operationsRows.filter((row) => row.profileCompletenessPct < 100).length;
  const driveWeakCount = operationsRows.filter((row) => row.driveEligibleUpcoming && row.riskScore >= 20).length;
  const topAlerts = [
    inactiveCount > 0 ? `${inactiveCount} students have been inactive for 7+ days.` : "",
    noMock14Count > 0 ? `${noMock14Count} students have not attempted a mock in the last 14 days.` : "",
    incompleteProfileCount > 0 ? `${incompleteProfileCount} students still have required profile fields pending.` : "",
    driveWeakCount > 0 ? `${driveWeakCount} eligible students are still underprepared for upcoming drives.` : "",
  ].filter(Boolean);
  const recommendedActions = [
    inactiveCount > 0 ? "Contact inactive students in the highest-risk batches first." : "",
    noMock14Count > 0 ? "Schedule a mandatory mock round for students with no attempt in 14 days." : "",
    incompleteProfileCount > 0 ? "Run a profile completion drive before the next placement cycle." : "",
    driveWeakCount > 0 ? "Create a drive-specific intervention list for eligible but weak students." : "",
  ].filter(Boolean);
  const resourceOpenEvents7d = resourceViewEvents.filter((item) => String(item.event_type ?? "") === "open");
  const resourceCloseEvents7d = resourceViewEvents.filter((item) => String(item.event_type ?? "") === "close");
  const studentsUsingResources7d = new Set(resourceOpenEvents7d.map((item) => String(item.student_id ?? ""))).size;
  const avgResourceReadingMinutes7d = Number(
    (
      resourceCloseEvents7d.reduce((sum, item) => sum + Number(item.duration_sec ?? 0), 0) /
      Math.max(resourceCloseEvents7d.length, 1) /
      60
    ).toFixed(1),
  );
  const resourceUsageMap = new Map<string, {
    resourceId: string;
    title: string;
    resourceType: string;
    topicName: string | null;
    opens: number;
    uniqueStudents: Set<string>;
    readingSeconds: number;
    strongStudentOpens: number;
  }>();
  resourceOpenEvents7d.forEach((item) => {
    const resourceId = String(item.resource_id ?? "");
    if (!resourceId) return;
    const existing = resourceUsageMap.get(resourceId) ?? {
      resourceId,
      title: resourceMap.get(resourceId)?.title ?? String((item.metadata as Record<string, unknown> | undefined)?.resourceTitle ?? "Resource"),
      resourceType: resourceMap.get(resourceId)?.resourceType ?? "resource",
      topicName: resourceMap.get(resourceId)?.topicName ?? null,
      opens: 0,
      uniqueStudents: new Set<string>(),
      readingSeconds: 0,
      strongStudentOpens: 0,
    };
    existing.opens += 1;
    existing.uniqueStudents.add(String(item.student_id ?? ""));
    const studentRow = operationsRows.find((row) => row.studentId === String(item.student_id ?? ""));
    if (studentRow && (studentRow.mockAvg >= 60 || studentRow.readinessScore >= 60)) {
      existing.strongStudentOpens += 1;
    }
    resourceUsageMap.set(resourceId, existing);
  });
  resourceCloseEvents7d.forEach((item) => {
    const resourceId = String(item.resource_id ?? "");
    const existing = resourceUsageMap.get(resourceId);
    if (!existing) return;
    existing.readingSeconds += Number(item.duration_sec ?? 0);
  });
  const resourceInsights = [...resourceUsageMap.values()].map((item) => ({
    resourceId: item.resourceId,
    title: item.title,
    resourceType: item.resourceType,
    topicName: item.topicName,
    opens: item.opens,
    uniqueStudents: item.uniqueStudents.size,
    avgReadingMinutes: Number(((item.readingSeconds / Math.max(item.opens, 1)) / 60).toFixed(1)),
    impactScore: clamp(item.strongStudentOpens * 8 + item.uniqueStudents.size * 4 + Math.round(item.readingSeconds / 180), 0, 100),
  }));
  const topResources = [...resourceInsights].sort((a, b) => b.opens - a.opens || b.uniqueStudents - a.uniqueStudents).slice(0, 8);
  const highImpactResources = [...resourceInsights].sort((a, b) => b.impactScore - a.impactScore).slice(0, 8);
  const underusedResources = sharedResources
    .map((resource) => {
      const usage = resourceUsageMap.get(String(resource.id));
      return {
        resourceId: String(resource.id),
        title: String(resource.title ?? "Resource"),
        resourceType: String(resource.resource_type ?? "resource"),
        topicName: topicMap.get(String(resource.topic_id ?? "")) ?? null,
        opens: usage?.opens ?? 0,
      };
    })
    .filter((item) => item.opens === 0)
    .slice(0, 8);

  const activityFeedItems = events.slice(0, 40).map((event) => {
    const student = operationsRows.find((row) => row.studentId === String(event.student_id));
    return {
      id: String(event.id),
      timestamp: String(event.created_at),
      studentId: String(event.student_id),
      studentName: student?.fullName ?? String(event.student_id),
      branch: student?.branch ?? "",
      batch: student?.batch ?? "",
      eventType: String(event.event_type),
      title: String(event.title),
      description: String(event.description),
      module: String(event.event_source),
      impactLabel: impactLabel(Number(event.impact_score ?? 0)),
    };
  });

  const riskStudents = operationsRows.filter((row) => row.riskScore >= 20).map((row) => ({
    studentId: row.studentId,
    fullName: row.fullName,
    branch: row.branch,
    batch: row.batch,
    severity: row.riskLevel,
    riskScore: row.riskScore,
    riskReasons: row.riskReasons,
    lastActiveAt: row.lastActiveAt,
    upcomingDriveImpact: row.driveImpact,
    recommendedIntervention: row.nextRecommendedAction,
  }));
  const newlyAtRisk7d = riskStudents.filter((row) => row.lastActiveAt && row.lastActiveAt.slice(0, 10) >= start7).length;

  const drivePreparednessItems = upcomingDriveItems.map((drive) => {
    const results = driveResultsByDrive.get(String(drive.id)) ?? [];
    const daysRemaining = daysUntil(String(drive.drive_date ?? ""));
    const eligibleStudentIds = results
      .filter((item) => String(item.status ?? "") === "eligible" || ["shortlisted", "selected"].includes(String(item.outcome ?? "")))
      .map((item) => String(item.student_id ?? ""));
    const eligibleRows = operationsRows.filter((row) => eligibleStudentIds.includes(row.studentId));
    const notEligibleStudents = Math.max(0, totalStudents - eligibleRows.length);
    const appliedResults = results.filter((item) => String(item.application_state ?? "") === "applied");
    const appliedStudentIds = new Set(appliedResults.map((item) => String(item.student_id ?? "")));
    const eligibleButNotAppliedRows = eligibleRows.filter((row) => !appliedStudentIds.has(row.studentId));
    const eligibleButNotAppliedCount = eligibleButNotAppliedRows.length;
    const exportReadyApplicants = appliedResults.filter((item) =>
      Boolean(String(item.resume_drive_web_link_at_application ?? "")) || Boolean(String(item.resume_drive_file_id_at_application ?? "")),
    ).length;
    const releasedCount = results.filter((item) => Boolean(item.result_released_at)).length;
    const drilldown = {
      eligibleButWeak: eligibleRows.filter((row) => row.readinessScore < 60 || row.mockAvg < 55).length,
      ineligibleButRecoverable: operationsRows.filter((row) => !eligibleStudentIds.includes(row.studentId) && row.readinessScore >= 60).length,
      noMockTest: eligibleRows.filter((row) => row.mockAttempts === 0).length,
      noResumeProfile: eligibleRows.filter((row) => row.profileMissingFields.includes("Resume link")).length,
      noRecentActivity: eligibleRows.filter((row) => !row.isActive7d).length,
    };
    const lowApplyRisk = Boolean(
      eligibleRows.length >= 5
      && daysRemaining !== null
      && daysRemaining <= 7
      && (appliedResults.length / Math.max(eligibleRows.length, 1)) < 0.35,
    );
    const resultPublicationState =
      results.length === 0
        ? "not_started"
        : releasedCount === 0
          ? "pending_release"
          : releasedCount === results.length
            ? "released"
            : "partially_released";
    return {
      driveId: String(drive.id),
      company: String(drive.company ?? ""),
      role: drive.role ? String(drive.role) : null,
      driveDate: String(drive.drive_date ?? ""),
      status: String(drive.status ?? "draft"),
      daysRemaining,
      eligibleStudents: eligibleRows.length,
      notEligibleStudents,
      appliedCount: appliedResults.length,
      eligibleButNotAppliedCount,
      eligibleButNotAppliedStudents: eligibleButNotAppliedRows.slice(0, 25).map((row) => ({
        studentId: row.studentId,
        fullName: row.fullName,
        email: row.email,
        branch: row.branch,
        batch: row.batch,
        readinessScore: row.readinessScore,
        profileCompletenessPct: row.profileCompletenessPct,
        hasResumeReady: row.hasResumeReady,
        isProfileCertified: row.isProfileCertified,
        nextRecommendedAction: row.nextRecommendedAction,
      })),
      exportReadyApplicants,
      resumeExportReady: appliedResults.length > 0 && exportReadyApplicants === appliedResults.length,
      resultPublicationState,
      lowApplyRisk,
      incompleteProfileStudents: eligibleRows.filter((row) => row.profileCompletenessPct < 100).length,
      noRelevantMockStudents: eligibleRows.filter((row) => row.mockAttempts === 0).length,
      avgReadinessEligible: average(eligibleRows.map((row) => row.readinessScore)),
      avgInterviewScore: average(eligibleRows.map((row) => row.interviewScore ?? 0).filter((value) => value > 0)),
      driveRiskScore: clamp(
        Math.round(drilldown.eligibleButWeak * 6 + drilldown.noMockTest * 5 + drilldown.noResumeProfile * 5 + drilldown.noRecentActivity * 4),
        0,
        100,
      ),
      drilldown,
    };
  }).sort((a, b) => a.driveDate.localeCompare(b.driveDate));

  const readinessFunnel = {
    totalStudents,
    completeProfiles: operationsRows.filter((row) => row.isProfileComplete).length,
    certifiedProfiles: operationsRows.filter((row) => row.isProfileCertified).length,
    resumeReadyProfiles: operationsRows.filter((row) => row.hasResumeReady).length,
    eligibleForUpcomingDrives: operationsRows.filter((row) => row.driveEligibleUpcoming).length,
    appliedRecently: operationsRows.filter((row) => row.appliedRecently).length,
  };

  const blockerSegments = {
    missingResume: operationsRows.filter((row) => !row.hasResumeReady).length,
    uncertified: operationsRows.filter((row) => !row.isProfileCertified).length,
    incompleteProfile: operationsRows.filter((row) => !row.isProfileComplete).length,
    academicallyBlocked: operationsRows.filter((row) => row.isProfileComplete && row.isProfileCertified && row.hasResumeReady && !row.driveEligibleUpcoming).length,
    lowEngagement: operationsRows.filter((row) => !row.isActive7d || row.mockAttempts === 0).length,
  };

  const unlockQueueItems = profileUnlockRequests.map((request) => {
    const student = studentMap.get(String(request.student_id ?? ""));
    const user = student ? userMap.get(String(student.user_id ?? "")) : null;
    return {
      id: String(request.id ?? ""),
      type: "profile_unlock_request",
      title: user?.fullName ? `${user.fullName} requested a profile unlock` : "Profile unlock request",
      summary: String(request.explanation ?? request.reason_category ?? "Student needs profile corrections."),
      priority: "high",
      targetPath: student ? `/tpo/students/${String(student.id ?? "")}` : "/tpo/students",
      ctaLabel: "Review request",
      studentId: student ? String(student.id ?? "") : "",
      studentName: user?.fullName ?? "Student",
      studentEmail: user?.email ?? "",
      reasonCategory: String(request.reason_category ?? "other"),
      requestedFields: Array.isArray(request.requested_fields) ? request.requested_fields.map((value) => String(value)) : [],
      createdAt: String(request.created_at ?? ""),
      requestId: String(request.id ?? ""),
    };
  });

  const studentSupportQueueItems = studentSupportRequests.map((request) => ({
    id: String(request.id ?? ""),
    type: "student_support_request",
    title: String(request.subject ?? "Student support request"),
    summary: `${String(request.student_name ?? "Student")} needs help with ${String(request.subject ?? "support").toLowerCase()}.`,
    priority: "medium",
    targetPath: request.student_id ? `/tpo/students/${String(request.student_id)}` : "/tpo/students",
    ctaLabel: "Resolve request",
    requestId: String(request.id ?? ""),
    studentId: String(request.student_id ?? ""),
    studentName: String(request.student_name ?? "Student"),
    studentEmail: String(request.student_email ?? ""),
    subject: String(request.subject ?? ""),
    message: String(request.message ?? ""),
    createdAt: String(request.created_at ?? ""),
  }));

  const supportAccessQueueItems = supportAccessRequests.map((request) => ({
    id: String(request.id ?? ""),
    type: "support_access_request",
    title: `Admin support access request from ${String(request.requested_by_email ?? "admin")}`,
    summary: String(request.reason ?? "Support access requested."),
    priority: "medium",
    targetPath: "/tpo/dashboard",
    ctaLabel: "Review access",
    requestId: String(request.id ?? ""),
    requestedByEmail: String(request.requested_by_email ?? ""),
    reason: String(request.reason ?? ""),
    createdAt: String(request.created_at ?? ""),
  }));

  const communicationTasks = drivePreparednessItems
    .filter((drive) => drive.lowApplyRisk || (drive.appliedCount > 0 && !drive.resumeExportReady) || drive.resultPublicationState === "pending_release")
    .map((drive) => ({
      id: `drive-task:${drive.driveId}`,
      type: drive.lowApplyRisk ? "low_apply_risk" : !drive.resumeExportReady ? "resume_export_gap" : "result_release_pending",
      title: drive.lowApplyRisk
        ? `${drive.company} needs a student reminder push`
        : !drive.resumeExportReady
          ? `${drive.company} needs resume export follow-through`
          : `${drive.company} results are still pending release`,
      summary: drive.lowApplyRisk
        ? `${drive.eligibleButNotAppliedCount} eligible students still have not applied.`
        : !drive.resumeExportReady
          ? `${drive.exportReadyApplicants} of ${drive.appliedCount} applicants have export-ready resumes.`
          : `${drive.appliedCount} applicants are waiting on result communication.`,
      priority: drive.lowApplyRisk ? "high" : "medium",
      targetPath: `/tpo/drives/${drive.driveId}`,
      ctaLabel: drive.lowApplyRisk ? "Send reminder" : !drive.resumeExportReady ? "Open drive" : "Manage results",
      driveId: drive.driveId,
      driveName: drive.company,
    }));

  const actionCenterEligibleButNotApplied = drivePreparednessItems
    .filter((drive) => drive.eligibleButNotAppliedCount > 0)
    .map((drive) => ({
      driveId: drive.driveId,
      company: drive.company,
      role: drive.role,
      driveDate: drive.driveDate,
      eligibleButNotAppliedCount: drive.eligibleButNotAppliedCount,
      daysRemaining: drive.daysRemaining,
      students: drive.eligibleButNotAppliedStudents,
      nextRecommendedAction: drive.lowApplyRisk
        ? "Send branch-wise reminder before the deadline."
        : "Review eligible students and nudge applications.",
    }))
    .slice(0, 8);

  const readyButInactive = operationsRows
    .filter((row) => row.isProfileComplete && row.isProfileCertified && row.hasResumeReady && !row.isActive7d)
    .slice(0, 10);

  const lowReadinessNearDriveImpact = operationsRows
    .filter((row) => row.driveEligibleUpcoming && (row.readinessScore < 60 || row.mockAttempts === 0 || !row.isActive7d))
    .slice(0, 10);

  const dashboardQueues = {
    profileUnlockRequests: {
      count: unlockQueueItems.length,
      items: unlockQueueItems,
    },
    studentSupportRequests: {
      count: studentSupportQueueItems.length,
      items: studentSupportQueueItems,
    },
    supportAccessRequests: {
      count: supportAccessQueueItems.length,
      items: supportAccessQueueItems,
    },
    communicationTasks: {
      count: communicationTasks.length,
      items: communicationTasks,
    },
  };

  const lowApplyDrive = drivePreparednessItems.find((drive) => drive.lowApplyRisk) ?? null;
  const resumeFollowThroughDrive = drivePreparednessItems.find((drive) => drive.appliedCount > 0 && !drive.resumeExportReady) ?? null;

  const nextBestActions = [
    unlockQueueItems.length > 0
      ? {
          id: "review-profile-unlocks",
          type: "review_profile_unlocks",
          title: `Review ${pluralize(unlockQueueItems.length, "unlock request")}`,
          explanation: "Students are blocked on profile corrections until these requests are reviewed.",
          affectedWorkflow: "Profile governance",
          targetPath: "/tpo/students",
          ctaLabel: "Review unlocks",
          priority: "high" as const,
          urgency: "today" as const,
        }
      : null,
    studentSupportQueueItems.length > 0
      ? {
          id: "resolve-student-support",
          type: "resolve_student_support",
          title: `Resolve ${pluralize(studentSupportQueueItems.length, "student support request")}`,
          explanation: "Open student help requests are waiting for TPO follow-up.",
          affectedWorkflow: "Student support",
          targetPath: "/tpo/dashboard",
          ctaLabel: "Open queue",
          priority: "medium" as const,
          urgency: "today" as const,
        }
      : null,
    lowApplyDrive
      ? {
          id: "nudge-low-apply-drive",
          type: "low_apply_drive_followup",
          title: `Intervene on ${lowApplyDrive.company}`,
          explanation: `${lowApplyDrive.eligibleButNotAppliedCount} eligible students still have not applied and the deadline is getting close.`,
          affectedWorkflow: "Drive applications",
          targetPath: `/tpo/drives/${lowApplyDrive.driveId}`,
          ctaLabel: "Open drive",
          priority: "high" as const,
          urgency: "today" as const,
        }
      : null,
    resumeFollowThroughDrive
      ? {
          id: "resume-export-followthrough",
          type: "resume_export_followthrough",
          title: `Finish resume export prep for ${resumeFollowThroughDrive.company}`,
          explanation: `Only ${resumeFollowThroughDrive.exportReadyApplicants} of ${resumeFollowThroughDrive.appliedCount} applicants have export-ready resume snapshots.`,
          affectedWorkflow: "Resume export",
          targetPath: `/tpo/drives/${resumeFollowThroughDrive.driveId}`,
          ctaLabel: "Review applicants",
          priority: "medium" as const,
          urgency: "this_week" as const,
        }
      : null,
    readyButInactive.length > 0
      ? {
          id: "reactivate-ready-students",
          type: "reactivate_ready_students",
          title: `Follow up with ${pluralize(readyButInactive.length, "ready but inactive student")}`,
          explanation: "These students are ready for drives but have gone quiet in the last 7 days.",
          affectedWorkflow: "Student outreach",
          targetPath: "/tpo/students?mode=ops&view=ready_but_inactive",
          ctaLabel: "Open queue",
          priority: "medium" as const,
          urgency: "this_week" as const,
        }
      : null,
    lowReadinessNearDriveImpact.length > 0
      ? {
          id: "push-mock-practice",
          type: "push_mock_practice",
          title: `Push mock prep for ${pluralize(lowReadinessNearDriveImpact.length, "student")}`,
          explanation: "These students are near upcoming drives but still show low readiness or no recent mock activity.",
          affectedWorkflow: "Preparation follow-up",
          targetPath: "/tpo/interventions/needs-mock-push",
          ctaLabel: "Open queue",
          priority: "medium" as const,
          urgency: "this_week" as const,
        }
      : null,
  ].filter(Boolean);

  const profileItems = operationsRows.map((row) => ({
    studentId: row.studentId,
    fullName: row.fullName,
    completenessPct: row.profileCompletenessPct,
    missingFields: row.profileMissingFields,
    lastUpdated: row.lastActiveAt,
    driveImpact: row.driveImpact,
  }));

  const attemptsByBatchMap = new Map<string, number[]>();
  attempts.forEach((attempt) => {
    const row = operationsRows.find((item) => item.studentId === String(attempt.student_id));
    const batch = row?.batch ?? "Unknown";
    const list = attemptsByBatchMap.get(batch) ?? [];
    list.push(Number(attempt.score ?? 0));
    attemptsByBatchMap.set(batch, list);
  });
  const scoreTrendByBatch = [...attemptsByBatchMap.entries()].map(([batch, scores]) => ({ batch, avgScore: average(scores) }));

  const difficultyMap = new Map<string, number[]>();
  attempts.forEach((attempt) => {
    const difficulty = String(testMap.get(String(attempt.test_id ?? ""))?.difficulty ?? "unknown");
    const list = difficultyMap.get(difficulty) ?? [];
    list.push(Number(attempt.score ?? 0));
    difficultyMap.set(difficulty, list);
  });
  const difficultyPerformance = [...difficultyMap.entries()].map(([difficulty, scores]) => ({ difficulty, avgScore: average(scores), attempts: scores.length }));

  const mockStudentRows = operationsRows.map((row) => {
    const studentAttempts = attemptsByStudent.get(row.studentId) ?? [];
    const scores = studentAttempts.map((item) => Number(item.score ?? 0));
    const latestScore = scores.length > 0 ? scores[scores.length - 1] : null;
    const trendDelta = scores.length >= 2 ? scores[scores.length - 1] - scores[0] : 0;
    const mastery = masteryByStudent.get(row.studentId) ?? [];
    const weakTopic = mastery.length > 0
      ? [...mastery].sort((a, b) => Number(a.masteryLevel ?? 0) - Number(b.masteryLevel ?? 0))[0]
      : null;
    return {
      studentId: row.studentId,
      fullName: row.fullName,
      attempts: studentAttempts.length,
      avgScore: average(scores),
      latestScore,
      scoreTrend: trendDelta >= 5 ? "Improving" : trendDelta <= -5 ? "Dropping" : "Stable",
      weakTopic: weakTopic ? (topicMap.get(String(weakTopic.topicId ?? "")) ?? String(weakTopic.topicId ?? "")) : "N/A",
      recommendation: studentAttempts.length === 0
        ? "Assign first mock test immediately."
        : average(scores) < 55
          ? "Schedule focused remedial mock practice."
          : "Maintain practice cadence.",
    };
  });

  const interviewStudentRows = operationsRows.map((row) => {
    const sessions = interviewByStudent.get(row.studentId) ?? [];
    const feedbacks = sessions.flatMap((session) =>
      Array.isArray(session.answer_feedback) ? session.answer_feedback as Array<Record<string, unknown> | null> : [],
    ).filter((item): item is Record<string, unknown> => Boolean(item));
    const avgInterviewScore = feedbacks.length > 0
      ? average(feedbacks.map((item) => Number(item.overallScore ?? 0)))
      : average(sessions.map((session) => Number(session.overall_score ?? 0)).filter((value) => value > 0));
    const clarity = feedbacks.length > 0 ? average(feedbacks.map((item) => Number(((item.rubric ?? {}) as Record<string, unknown>).clarity ?? 0) / 15 * 100)) : 0;
    const structure = feedbacks.length > 0 ? average(feedbacks.map((item) => Number(((item.rubric ?? {}) as Record<string, unknown>).structure ?? 0) / 20 * 100)) : 0;
    const confidence = feedbacks.length > 0 ? average(feedbacks.map((item) => Number(((item.rubric ?? {}) as Record<string, unknown>).confidence ?? 0) / 15 * 100)) : 0;
    const fillerAvg = feedbacks.length > 0 ? average(feedbacks.map((item) => Number(item.fillerCount ?? 0))) : 0;
    return {
      studentId: row.studentId,
      fullName: row.fullName,
      sessionsAttempted: sessions.length,
      avgInterviewScore,
      clarity,
      structure,
      confidence,
      fillerWordsTrend: fillerAvg > 6 ? "High fillers" : fillerAvg > 3 ? "Moderate fillers" : "Controlled",
      lastAttemptDate: maxIsoDate(sessions.map((session) => String(session.completed_at ?? session.created_at ?? ""))),
    };
  });

  const codingStudentRows = operationsRows.map((row) => {
    const profiles = codingByStudent.get(row.studentId) ?? [];
    const latest = [...profiles].sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0];
    const solvedCount = profiles.reduce((sum, profile) => sum + Number(profile.solved_count ?? 0), 0);
    return {
      studentId: row.studentId,
      fullName: row.fullName,
      platform: latest ? String(latest.platform ?? "") : "Not Linked",
      solvedCount,
      weeklyGoal: Number(latest?.weekly_goal ?? 0),
      streak: Number(latest?.streak_days ?? 0),
      codingReadinessLabel: solvedCount >= 180 ? "Strong" : solvedCount >= 80 ? "Moderate" : "Low",
    };
  });

  const studentActivityById = activityFeedItems.reduce<Record<string, Array<Record<string, unknown>>>>((acc, item) => {
    const list = acc[item.studentId] ?? [];
    list.push({
      id: item.id,
      timestamp: item.timestamp,
      eventType: item.eventType,
      title: item.title,
      description: item.description,
      module: item.module,
      impactLabel: item.impactLabel,
    });
    acc[item.studentId] = list;
    return acc;
  }, {});

  return {
    summary: {
      totalStudents,
      totalDrives: drives.length,
      activeStudents7d,
      avgReadiness,
      upcomingDrives: upcomingDriveItems.length,
      atRiskStudents,
      profileCompletePct,
      resourceOpens7d: resourceOpenEvents7d.length,
      studentsUsingResources7d,
      avgResourceReadingMinutes7d,
      outreachStartedCount: publishedAnnouncementCount + sentCommunicationCount,
    },
    trends: {
      readinessTrend,
      mockTrend: readinessTrend,
      batchActivity,
      weakTopicsByBranch,
    },
    alerts: { topAlerts, recommendedActions },
    activityFeed: { items: activityFeedItems },
    operationsBoard: { items: operationsRows },
    readinessFunnel,
    blockerSegments,
    dashboardQueues,
    nextBestActions,
    riskSummary: {
      totalAtRisk: riskStudents.length,
      highRisk: riskStudents.filter((item) => item.severity === "High" || item.severity === "Critical").length,
      moderateRisk: riskStudents.filter((item) => item.severity === "Moderate").length,
      newlyAtRisk7d,
    },
    riskStudents: { items: riskStudents },
    drivePreparedness: { items: drivePreparednessItems },
    profileCompleteness: {
      summary: {
        completeProfiles: profileItems.filter((item) => item.completenessPct >= 100).length,
        incompleteProfiles: profileItems.filter((item) => item.completenessPct < 100).length,
        missingResume: operationsRows.filter((item) => !item.hasResumeReady).length,
        missingCertificates: students.filter((student) => (walletByStudent.get(String(student.id)) ?? []).length === 0).length,
        missingCodingProfile: students.filter((student) => (codingByStudent.get(String(student.id)) ?? []).length === 0).length,
      },
      items: profileItems,
    },
    mockInsights: {
      summary: {
        totalAttempts: attempts.length,
        avgScore: average(attempts.map((item) => Number(item.score ?? 0))),
        studentsWithZeroAttempts: mockStudentRows.filter((item) => item.attempts === 0).length,
        topImprovers: mockStudentRows.filter((item) => item.scoreTrend === "Improving").length,
        scoreDropCases: mockStudentRows.filter((item) => item.scoreTrend === "Dropping").length,
      },
      charts: {
        scoreTrendByBatch,
        difficultyPerformance,
        weakTopics: weakTopicsByBranch.sort((a, b) => a.avgMastery - b.avgMastery).slice(0, 8).map((item) => ({
          topicName: item.topicName,
          avgMastery: item.avgMastery,
          studentsCovered: item.studentsCovered,
        })),
      },
      students: mockStudentRows,
    },
    interviewReadiness: {
      summary: {
        studentsAttempted: interviewStudentRows.filter((item) => item.sessionsAttempted > 0).length,
        avgInterviewScore: average(interviewStudentRows.map((item) => item.avgInterviewScore).filter((value) => value > 0)),
        avgClarity: average(interviewStudentRows.map((item) => item.clarity).filter((value) => value > 0)),
        avgStructure: average(interviewStudentRows.map((item) => item.structure).filter((value) => value > 0)),
        avgConfidence: average(interviewStudentRows.map((item) => item.confidence).filter((value) => value > 0)),
        belowSpeakingThreshold: interviewStudentRows.filter((item) => item.avgInterviewScore > 0 && item.avgInterviewScore < 60).length,
      },
      students: interviewStudentRows,
    },
    codingReadiness: {
      summary: {
        linkedProfiles: codingStudentRows.filter((item) => item.platform !== "Not Linked").length,
        avgSolved: average(codingStudentRows.map((item) => item.solvedCount).filter((value) => value > 0)),
        activeCoders7d: codingProfiles.filter((item) => String(item.updated_at ?? "").slice(0, 10) >= start7).length,
        lowActivityCoders: codingStudentRows.filter((item) => item.solvedCount < 80).length,
      },
      students: codingStudentRows,
    },
    actionCenter: {
      studentsToContactToday: operationsRows.filter((item) => item.riskScore >= 40).slice(0, 10),
      eligibleButNotApplied: actionCenterEligibleButNotApplied,
      readyButInactive,
      lowReadinessNearDriveImpact,
      studentsNeedingMockPush: operationsRows.filter((item) => item.mockAttempts === 0 || item.mockAvg < 55).slice(0, 10),
      studentsNeedingInterviewCoaching: operationsRows.filter((item) => item.interviewScore !== null && item.interviewScore < 60).slice(0, 10),
      studentsNeedingProfileCompletion: operationsRows.filter((item) => item.profileCompletenessPct < 100).slice(0, 10),
      driveSpecificUrgentList: operationsRows.filter((item) => item.driveEligibleUpcoming && item.riskScore >= 20).slice(0, 10),
      studentsNotUsingResources: operationsRows.filter((item) => !resourceOpenEvents7d.some((event) => String(event.student_id ?? "") === item.studentId)).slice(0, 10),
      readingWithoutMock: operationsRows.filter((item) =>
        resourceOpenEvents7d.some((event) => String(event.student_id ?? "") === item.studentId) && item.mockAttempts === 0,
      ).slice(0, 10),
    },
    resourceInsights: {
      topResources,
      underusedResources,
      highImpactResources,
    },
    studentActivityById,
  };
}

async function getCachedControlCenter(tenantId: string) {
  const now = Date.now();
  const cached = controlCenterCache.get(tenantId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await computeControlCenter(tenantId);
  controlCenterCache.set(tenantId, {
    value,
    expiresAt: now + CONTROL_CENTER_CACHE_TTL_MS,
  });
  return value;
}

export const TpoControlCenterService = {
  async getPilotDashboard(tenantId: string) {
    const [data, db] = await Promise.all([
      getCachedControlCenter(tenantId),
      getMongoDb(),
    ]);
    const start7 = startDateIso(7);
    const attemptsThisWeek = await db.collection("student_attempts").countDocuments({
      tenant_id: tenantId,
      status: "submitted",
      submitted_at: { $gte: `${start7}T00:00:00.000Z` },
    });

    const eligibleStudentIds = new Set<string>();
    data.drivePreparedness.items.forEach((drive) => {
      if (drive.driveDate >= new Date().toISOString().slice(0, 10)) {
        const matches = data.operationsBoard.items.filter((item) => item.driveEligibleUpcoming);
        matches.forEach((item) => eligibleStudentIds.add(item.studentId));
      }
    });

    const attentionRows = data.operationsBoard.items
      .filter((item) => item.profileCompletenessPct < 100 || item.mockAttempts === 0 || !item.isActive7d)
      .sort((a, b) => b.riskScore - a.riskScore || a.readinessScore - b.readinessScore)
      .slice(0, 12);
    const studentRecords = attentionRows.length > 0
      ? await db.collection("students").find(
          { tenant_id: tenantId, id: { $in: attentionRows.map((item) => item.studentId) } },
          { projection: { _id: 0, id: 1, cgpa: 1 } },
        ).toArray()
      : [];
    const studentCgpaMap = new Map(studentRecords.map((row) => [String(row.id), Number(row.cgpa ?? 0)]));

    return {
      summary: {
        totalStudents: data.summary.totalStudents,
        upcomingDrives: data.summary.upcomingDrives,
        eligibleStudents: eligibleStudentIds.size,
        mockTestsTakenThisWeek: attemptsThisWeek,
      },
      readiness: {
        high: data.operationsBoard.items.filter((item) => item.readinessScore >= 75).length,
        medium: data.operationsBoard.items.filter((item) => item.readinessScore >= 55 && item.readinessScore < 75).length,
        low: data.operationsBoard.items.filter((item) => item.readinessScore < 55).length,
      },
      upcomingDrives: data.drivePreparedness.items.slice(0, 5).map((item) => ({
        driveId: item.driveId,
        company: item.company,
        role: item.role,
        driveDate: item.driveDate,
        eligibleStudents: item.eligibleStudents,
        driveRiskScore: item.driveRiskScore,
      })),
      studentsNeedingAttention: attentionRows
        .map((item) => ({
          studentId: item.studentId,
          fullName: item.fullName,
          branch: item.branch,
          batch: item.batch,
          cgpa: Number(studentCgpaMap.get(item.studentId) ?? 0),
          profileCompletenessPct: item.profileCompletenessPct,
          mockAttempts: item.mockAttempts,
          isActive7d: item.isActive7d,
          nextRecommendedAction: item.nextRecommendedAction,
        })),
    };
  },

  async getControlCenter(tenantId: string) {
    return getCachedControlCenter(tenantId);
  },

  async getDashboardSummary(tenantId: string) {
    const data = await getCachedControlCenter(tenantId);
    return data.summary;
  },

  async getDashboardTrends(tenantId: string) {
    const data = await getCachedControlCenter(tenantId);
    return data.trends;
  },

  async getDashboardAlerts(tenantId: string) {
    const data = await getCachedControlCenter(tenantId);
    return data.alerts;
  },

  async getActivityFeed(
    tenantId: string,
    studentId?: string,
    query?: {
      page?: number;
      limit?: number;
      search?: string;
      eventType?: string;
      branch?: string;
      batch?: string;
    },
  ) {
    return StudentActivityService.listEvents({
      tenantId,
      studentId,
      ...query,
    });
  },

  async getOperationsBoard(tenantId: string) {
    const data = await getCachedControlCenter(tenantId);
    return data.operationsBoard;
  },

  async getRiskSummary(tenantId: string) {
    const data = await getCachedControlCenter(tenantId);
    return data.riskSummary;
  },

  async getRiskStudents(
    tenantId: string,
    query?: {
      page?: number;
      limit?: number;
      search?: string;
      severity?: string;
      branch?: string;
      batch?: string;
    },
  ) {
    const data = await getCachedControlCenter(tenantId);
    const normalizedSearch = query?.search?.trim().toLowerCase() ?? "";
    const filtered = data.riskStudents.items.filter((item) => {
      if (query?.severity && query.severity !== "all" && item.severity !== query.severity) return false;
      if (query?.branch && query.branch !== "all" && item.branch !== query.branch) return false;
      if (query?.batch && query.batch !== "all" && item.batch !== query.batch) return false;
      if (!normalizedSearch) return true;

      const haystack = [
        item.fullName,
        item.branch,
        item.batch,
        item.severity,
        item.upcomingDriveImpact,
        item.recommendedIntervention,
        ...item.riskReasons,
      ].join(" ").toLowerCase();

      return haystack.includes(normalizedSearch);
    });

    return paginateArray(filtered, query?.page, query?.limit);
  },

  async getDrivePreparedness(tenantId: string, driveId?: string) {
    const data = await getCachedControlCenter(tenantId);
    if (driveId) return data.drivePreparedness.items.find((item) => item.driveId === driveId) ?? null;
    return data.drivePreparedness;
  },

  async getProfileCompleteness(tenantId: string) {
    const data = await getCachedControlCenter(tenantId);
    return data.profileCompleteness;
  },

  async getMockInsights(tenantId: string) {
    const data = await getCachedControlCenter(tenantId);
    return data.mockInsights;
  },

  async getInterviewReadiness(tenantId: string, studentId?: string) {
    const data = await getCachedControlCenter(tenantId);
    if (studentId) return data.interviewReadiness.students.find((item) => item.studentId === studentId) ?? null;
    return data.interviewReadiness;
  },

  async getCodingReadiness(tenantId: string) {
    const data = await getCachedControlCenter(tenantId);
    return data.codingReadiness;
  },

  async getActionCenter(tenantId: string) {
    const data = await getCachedControlCenter(tenantId);
    return data.actionCenter;
  },
};
