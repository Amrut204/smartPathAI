import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { getMongoDb } from "../utils/mongodb.js";
import { AIFailoverService } from "./ai/failover.service.js";

type InterviewDifficulty = "foundation" | "core" | "advanced";

interface InterviewQuestion {
  id: string;
  prompt: string;
  category: string;
  keywords: string[];
}

interface InterviewSession {
  id: string;
  tenant_id: string;
  student_id: string;
  company: string;
  role: string;
  focus_area: string;
  difficulty: InterviewDifficulty;
  status: "draft" | "completed";
  questions: InterviewQuestion[];
  answers: string[];
  answer_feedback?: Array<InterviewAnswerFeedback | null>;
  overall_score: number | null;
  feedback: string | null;
  created_at: string;
  completed_at: string | null;
}

interface InterviewAnswerFeedback {
  questionIndex: number;
  transcript: string;
  durationSec: number;
  wordsPerMinute: number;
  fillerCount: number;
  rubric: {
    relevance: number;
    structure: number;
    clarity: number;
    confidence: number;
  };
  overallScore: number;
  strengths: string[];
  improvements: string[];
  improvedAnswer: string;
  followUpQuestion: string;
}

interface CodingProfileInput {
  platform: string;
  handle: string;
  solvedCount: number;
  weeklyGoal: number;
  streakDays: number;
}

interface WalletItemInput {
  title: string;
  issuer: string;
  type: string;
  achievedAt: string;
  evidenceUrl?: string;
}

interface CampaignInput {
  name: string;
  audience: string;
  channel: string;
  scheduledFor: string;
  goal: string;
}

interface CalendarEventInput {
  title: string;
  type: string;
  startsAt: string;
  audience: string;
  reminderOffsetHours: number;
}

interface RecruiterInput {
  company: string;
  contactName: string;
  contactEmail: string;
  openRoles: string[];
  notes?: string;
}

interface BillingPlanInput {
  planName: string;
  billingCycle: string;
  studentLimit: number;
  aiQuota: number;
  messageQuota: number;
  monthlyPrice: number;
  renewalDate: string;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isoNow(): string {
  return new Date().toISOString();
}

function startOfWeekIso(date = new Date()): string {
  const copy = new Date(date);
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  copy.setUTCHours(0, 0, 0, 0);
  return copy.toISOString().slice(0, 10);
}

function getInterviewTemplate(company: string, role: string, focusArea: string, difficulty: InterviewDifficulty) {
  const normalizedRole = role.toLowerCase();
  const normalizedFocus = focusArea.toLowerCase();

  const baseQuestions: InterviewQuestion[] = [
    {
      id: randomUUID(),
      prompt: `Tell me about yourself and why ${company} should consider you for ${role}.`,
      category: "introduction",
      keywords: ["experience", "impact", "role", "strength"],
    },
    {
      id: randomUUID(),
      prompt: normalizedRole.includes("analyst")
        ? "How would you structure a messy dataset before presenting insights?"
        : "Describe a project where you solved a real user or business problem.",
      category: "experience",
      keywords: ["problem", "approach", "result", "stakeholder"],
    },
    {
      id: randomUUID(),
      prompt: normalizedFocus.includes("aptitude")
        ? "How do you approach time management during aptitude rounds?"
        : `What are the key concepts in ${focusArea} that you are most confident in?`,
      category: "domain",
      keywords: ["concept", "tradeoff", "example", "decision"],
    },
    {
      id: randomUUID(),
      prompt: difficulty === "advanced"
        ? "Tell me about a difficult failure and how you changed your process afterward."
        : "Describe a challenge you handled well in a team or classroom setting.",
      category: "behavioral",
      keywords: ["ownership", "learning", "communication", "result"],
    },
    {
      id: randomUUID(),
      prompt: `If selected, what would your 90-day plan look like in the ${role} role?`,
      category: "ownership",
      keywords: ["plan", "priorities", "execution", "learning"],
    },
  ];

  return baseQuestions;
}

function scoreInterview(questions: InterviewQuestion[], answers: string[]) {
  const questionScores = questions.map((question, index) => {
    const answer = String(answers[index] ?? "").trim().toLowerCase();
    const lengthScore = clamp((answer.length / 220) * 55, 0, 55);
    const keywordHits = question.keywords.filter((keyword) => answer.includes(keyword)).length;
    const keywordScore = clamp((keywordHits / question.keywords.length) * 45, 0, 45);
    return Number((lengthScore + keywordScore).toFixed(2));
  });

  const overall = average(questionScores);
  let feedback = "Strong structure and clarity. Keep adding sharper examples with measurable impact.";
  if (overall < 45) {
    feedback = "Answers are too thin. Add structured examples, business context, and clearer outcomes.";
  } else if (overall < 70) {
    feedback = "Good baseline. Improve specificity, quantify results, and tighten final takeaways.";
  }

  return {
    overall,
    feedback,
  };
}

function detectFillerCount(transcript: string) {
  const matches = transcript.toLowerCase().match(/\b(um|uh|like|you know|basically|actually|sort of|kind of)\b/g);
  return matches?.length ?? 0;
}

function deriveQuestionRubric(question: InterviewQuestion, transcript: string, durationSec: number) {
  const normalized = transcript.trim().toLowerCase();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const wordsPerMinute = durationSec > 0 ? Math.round((wordCount / durationSec) * 60) : 0;
  const fillerCount = detectFillerCount(normalized);
  const keywordHits = question.keywords.filter((keyword) => normalized.includes(keyword)).length;

  const relevance = clamp(Math.round((keywordHits / question.keywords.length) * 25), 0, 25);
  const structureIndicators = /\b(first|second|third|because|therefore|result|impact|learned)\b/.test(normalized) ? 20 : 11;
  const structure = clamp(structureIndicators, 0, 20);
  const clarity = clamp(Math.round(Math.min(wordCount, 180) / 180 * 15), 4, 15);
  const pacePenalty = wordsPerMinute >= 95 && wordsPerMinute <= 165 ? 0 : 4;
  const fillerPenalty = Math.min(5, fillerCount);
  const confidence = clamp(15 - pacePenalty - fillerPenalty, 4, 15);

  return {
    wordCount,
    wordsPerMinute,
    fillerCount,
    relevance,
    structure,
    clarity,
    confidence,
  };
}

function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return raw.slice(start, end + 1);
}

function getDaysAgoIso(daysAgo: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString();
}

function averageDelta(current: number, previous: number) {
  return Number((current - previous).toFixed(2));
}

function buildLocalInterviewFeedback(
  question: InterviewQuestion,
  transcript: string,
  durationSec: number,
): InterviewAnswerFeedback {
  const rubric = deriveQuestionRubric(question, transcript, durationSec);
  const overallScore = rubric.relevance + rubric.structure + rubric.clarity + rubric.confidence + 25;
  const strengths: string[] = [];
  const improvements: string[] = [];

  if (rubric.relevance >= 18) strengths.push("Relevant points matched the core interview question.");
  if (rubric.structure >= 16) strengths.push("Answer had a clear beginning, reasoning flow, and outcome.");
  if (rubric.confidence >= 11) strengths.push("Delivery pace was controlled enough to sound confident.");

  if (rubric.relevance < 16) improvements.push("Add one concrete example or result tied directly to the question.");
  if (rubric.structure < 15) improvements.push("Use a simple structure: situation, action, result, learning.");
  if (rubric.confidence < 11) improvements.push("Reduce filler words and pause briefly before key points.");

  const improvedAnswer = [
    "Start with a direct answer in one sentence.",
    "Add a specific project or situation that proves the point.",
    "Close with the measurable result and what you learned.",
  ].join(" ");

  return {
    questionIndex: 0,
    transcript,
    durationSec: Number(durationSec.toFixed(1)),
    wordsPerMinute: rubric.wordsPerMinute,
    fillerCount: rubric.fillerCount,
    rubric: {
      relevance: rubric.relevance,
      structure: rubric.structure,
      clarity: rubric.clarity,
      confidence: rubric.confidence,
    },
    overallScore: clamp(overallScore, 0, 100),
    strengths: strengths.length > 0 ? strengths : ["Answer showed baseline understanding of the topic."],
    improvements: improvements.length > 0 ? improvements : ["Add stronger metrics and sharper closing lines."],
    improvedAnswer,
    followUpQuestion: `Can you give one measurable example to strengthen your answer about ${question.category}?`,
  };
}

const mentorPool = [
  { name: "Ananya Rao", company: "Infosys", role: "Systems Engineer", domain: "Service Delivery" },
  { name: "Rahul Verma", company: "TCS", role: "Digital Developer", domain: "Full Stack" },
  { name: "Megha Iyer", company: "Accenture", role: "Analyst", domain: "Data & Analytics" },
  { name: "Karan Shah", company: "Wipro", role: "Project Engineer", domain: "Cloud" },
];

export const CareerService = {
  async getStudentHub(tenantId: string, userId: string) {
    const db = await getMongoDb();
    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, user_id: userId },
      { projection: { _id: 0, id: 1, branch: 1, batch: 1, readiness_score: 1, roll_number: 1 } },
    );

    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student profile not found", 404);
    }

    const [attempts, studyHours, codingProfiles, interviews, actionPlan, wallet, mentorship, drives, mastery] = await Promise.all([
      db.collection("student_attempts").find(
        { tenant_id: tenantId, student_id: String(student.id), status: "submitted" },
        { projection: { _id: 0, test_id: 1, score: 1, submitted_at: 1 } },
      ).sort({ submitted_at: -1 }).limit(12).toArray(),
      db.collection("study_hours").find(
        { tenant_id: tenantId, student_id: String(student.id) },
        { projection: { _id: 0, hours: 1, study_date: 1 } },
      ).sort({ study_date: -1 }).limit(20).toArray(),
      db.collection("coding_profiles").find(
        { tenant_id: tenantId, student_id: String(student.id) },
        { projection: { _id: 0 } },
      ).sort({ updated_at: -1 }).toArray(),
      db.collection("interview_sessions").find(
        { tenant_id: tenantId, student_id: String(student.id) },
        { projection: { _id: 0 } },
      ).sort({ created_at: -1 }).limit(8).toArray() as unknown as Promise<InterviewSession[]>,
      db.collection("action_plans").findOne(
        { tenant_id: tenantId, student_id: String(student.id), week_start: startOfWeekIso() },
        { projection: { _id: 0 } },
      ),
      db.collection("achievement_wallet").find(
        { tenant_id: tenantId, student_id: String(student.id) },
        { projection: { _id: 0 } },
      ).sort({ achieved_at: -1 }).limit(10).toArray(),
      db.collection("mentorship_matches").find(
        { tenant_id: tenantId, student_id: String(student.id) },
        { projection: { _id: 0 } },
      ).sort({ created_at: -1 }).limit(5).toArray(),
      db.collection("drives").find(
        { tenant_id: tenantId, deleted_at: null, status: { $in: ["upcoming", "active"] } },
        { projection: { _id: 0, company: 1, role: 1, drive_date: 1, status: 1 } },
      ).sort({ drive_date: 1 }).limit(5).toArray(),
      db.collection("topic_mastery").find(
        { tenant_id: tenantId, student_id: String(student.id) },
        { projection: { _id: 0, topic_id: 1, mastery_level: 1 } },
      ).toArray(),
    ]);

    const topicIds = mastery.map((item) => String(item.topic_id));
    const topics = topicIds.length > 0
      ? await db.collection("topics").find(
          { id: { $in: topicIds } },
          { projection: { _id: 0, id: 1, name: 1 } },
        ).toArray()
      : [];
    const topicMap = new Map(topics.map((item) => [String(item.id), String(item.name)]));

    const weakAreas = mastery
      .map((item) => ({
        topicId: String(item.topic_id),
        topicName: topicMap.get(String(item.topic_id)) ?? String(item.topic_id),
        masteryLevel: Number(item.mastery_level ?? 0),
      }))
      .sort((a, b) => a.masteryLevel - b.masteryLevel)
      .slice(0, 3);

    const mockAverage = average(attempts.map((item) => Number(item.score ?? 0)));
    const codingSolved = codingProfiles.reduce((sum, item) => sum + Number(item.solved_count ?? 0), 0);
    const totalStudyHours = studyHours.reduce((sum, item) => sum + Number(item.hours ?? 0), 0);
    const readiness = Number(student.readiness_score ?? 0);
    const predictorScore = Number((
      readiness * 0.42
      + mockAverage * 0.28
      + clamp((codingSolved / 250) * 100, 0, 100) * 0.18
      + clamp((totalStudyHours / 45) * 100, 0, 100) * 0.12
    ).toFixed(2));
    const shortlistProbability = clamp(Math.round(predictorScore), 0, 99);

    const risks = [
      readiness < 65 ? "Readiness score is below strong-drive benchmark." : null,
      mockAverage < 60 ? "Mock test average is still inconsistent." : null,
      codingSolved < 120 ? "Coding volume is low for product-company filters." : null,
      totalStudyHours < 18 ? "Recent study effort is below target pace." : null,
    ].filter((item): item is string => Boolean(item));

    const actionPlanData = actionPlan ?? await this.generateActionPlan(tenantId, userId);
    const weakTopicIds = weakAreas.map((item) => item.topicId);
    const attemptTestIds = [...new Set(attempts.map((item) => String(item.test_id ?? "")).filter(Boolean))];

    const [recommendedResourcesRaw, recommendedMocksRaw, companies] = await Promise.all([
      weakTopicIds.length > 0
        ? db.collection("shared_resources").find(
            {
              is_active: true,
              topic_id: { $in: weakTopicIds },
              resource_type: { $in: ["pdf", "notes", "markdown", "text"] },
            },
            {
              projection: {
                _id: 0,
                id: 1,
                title: 1,
                resource_type: 1,
                topic_id: 1,
                search_index: 1,
                created_at: 1,
              },
            },
          ).sort({ created_at: -1 }).limit(8).toArray()
        : Promise.resolve([]),
      weakTopicIds.length > 0
        ? db.collection("mock_tests").find(
            {
              is_active: true,
              topic_id: { $in: weakTopicIds },
              $or: [{ tenant_id: tenantId }, { tenant_id: null }],
            },
            {
              projection: {
                _id: 0,
                id: 1,
                title: 1,
                topic_id: 1,
                company_id: 1,
                duration_sec: 1,
                difficulty: 1,
                created_at: 1,
              },
            },
          ).sort({ created_at: -1 }).limit(12).toArray()
        : Promise.resolve([]),
      db.collection("companies").find(
        { $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
        { projection: { _id: 0, id: 1, name: 1 } },
      ).toArray(),
    ]);

    const companyMap = new Map(companies.map((item) => [String(item.id), String(item.name ?? "")]));
    const recommendedResourceIds = recommendedResourcesRaw.map((item) => String(item.id));
    const recommendedMockIds = recommendedMocksRaw.map((item) => String(item.id));
    const [resourceOpens, attemptCounts] = await Promise.all([
      recommendedResourceIds.length > 0
        ? db.collection("resource_view_events").aggregate([
            {
              $match: {
                tenant_id: tenantId,
                student_id: String(student.id),
                resource_id: { $in: recommendedResourceIds },
                event_type: "open",
              },
            },
            { $group: { _id: "$resource_id", count: { $sum: 1 } } },
          ]).toArray()
        : Promise.resolve([]),
      recommendedMockIds.length > 0
        ? db.collection("student_attempts").aggregate([
            {
              $match: {
                tenant_id: tenantId,
                student_id: String(student.id),
                status: "submitted",
                test_id: { $in: recommendedMockIds },
              },
            },
            { $group: { _id: "$test_id", count: { $sum: 1 }, latestScore: { $max: "$score" } } },
          ]).toArray()
        : Promise.resolve([]),
    ]);

    const resourceOpenMap = new Map(resourceOpens.map((item) => [String(item._id), Number(item.count ?? 0)]));
    const attemptCountMap = new Map(
      attemptCounts.map((item) => [
        String(item._id),
        { count: Number(item.count ?? 0), latestScore: Number(item.latestScore ?? 0) },
      ]),
    );

    const recommendedResources = recommendedResourcesRaw
      .map((resource) => {
        const searchIndex = resource.search_index && typeof resource.search_index === "object"
          ? resource.search_index as Record<string, unknown>
          : {};
        const topicId = resource.topic_id ? String(resource.topic_id) : null;
        const topicName = topicId ? topicMap.get(topicId) ?? topicId : null;
        const openedCount = resourceOpenMap.get(String(resource.id)) ?? 0;
        return {
          id: String(resource.id),
          title: String(resource.title ?? "Untitled Resource"),
          resourceType: String(resource.resource_type ?? "pdf"),
          topicId,
          topicName,
          summaryShort: searchIndex.summary_short ? String(searchIndex.summary_short) : null,
          whyItMatters: topicName
            ? `Build confidence in ${topicName} before your next timed practice set.`
            : "Use this to strengthen a weak area before the next placement round.",
          openedCount,
        };
      })
      .sort((left, right) => left.openedCount - right.openedCount)
      .slice(0, 6);

    const recommendedMocks = recommendedMocksRaw
      .map((test) => {
        const topicId = test.topic_id ? String(test.topic_id) : null;
        const topicName = topicId ? topicMap.get(topicId) ?? topicId : null;
        const companyName = test.company_id ? companyMap.get(String(test.company_id)) ?? null : null;
        const stats = attemptCountMap.get(String(test.id));
        return {
          id: String(test.id),
          title: String(test.title ?? "Untitled Test"),
          topicId,
          topicName,
          companyName,
          difficulty: String(test.difficulty ?? "medium"),
          durationSec: Number(test.duration_sec ?? 0),
          attemptCount: stats?.count ?? 0,
          latestScore: stats?.latestScore ?? null,
          whyItMatters: topicName
            ? `Use this timed set to move ${topicName} from weak area to reliable scoring.`
            : "Use this timed set to convert practice into shortlist-ready scores.",
        };
      })
      .sort((left, right) => left.attemptCount - right.attemptCount)
      .slice(0, 6);

    const completedInterviews = interviews.filter((session) => session.status === "completed" && session.overall_score !== null);
    const latestInterview = interviews[0] ?? null;
    const currentMockAverage = average(attempts.slice(0, 4).map((item) => Number(item.score ?? 0)));
    const previousMockAverage = average(attempts.slice(4, 8).map((item) => Number(item.score ?? 0)));
    const currentInterviewAverage = average(completedInterviews.slice(0, 2).map((item) => Number(item.overall_score ?? 0)));
    const previousInterviewAverage = average(completedInterviews.slice(2, 4).map((item) => Number(item.overall_score ?? 0)));
    const recentStudyRows = studyHours.filter((item) => String(item.study_date ?? "") >= getDaysAgoIso(7).slice(0, 10));
    const activeDays7d = new Set(recentStudyRows.map((item) => String(item.study_date ?? ""))).size;

    const nextActions = [
      weakAreas[0] && recommendedResources[0]
        ? {
            id: `resource-${recommendedResources[0].id}`,
            title: `Rebuild ${weakAreas[0].topicName}`,
            detail: `Open ${recommendedResources[0].title} and finish one focused revision cycle before your next test.`,
            ctaLabel: "Open Resource",
            href: `/resources/view/${recommendedResources[0].id}`,
            tone: "primary",
          }
        : null,
      recommendedMocks[0]
        ? {
            id: `mock-${recommendedMocks[0].id}`,
            title: `Take a timed ${recommendedMocks[0].topicName ?? "practice"} set`,
            detail: `Run ${recommendedMocks[0].title} next. Timed execution is the fastest way to raise shortlist confidence.`,
            ctaLabel: "Open Mock",
            href: `/mock-tests/${recommendedMocks[0].id}`,
            tone: "secondary",
          }
        : null,
      latestInterview
        ? {
            id: `interview-${latestInterview.id}`,
            title: latestInterview.status === "completed" ? "Retry your latest interview set" : "Finish your current interview set",
            detail: latestInterview.status === "completed"
              ? `Run another interview round for ${latestInterview.company} and focus on ${latestInterview.focus_area}.`
              : `Return to your ${latestInterview.company} interview session and complete the remaining answers.`,
            ctaLabel: "Continue Interview",
            href: "#career-interview",
            tone: "secondary",
          }
        : {
            id: "interview-new",
            title: "Start a company-focused voice interview",
            detail: "Practice speaking under pressure before your next placement round.",
            ctaLabel: "Start Interview",
            href: "#career-interview",
            tone: "secondary",
          },
      {
        id: "plan-refresh",
        title: "Work the weekly action plan",
        detail: `${actionPlanData.tasks.filter((task: { completed: boolean }) => !task.completed).length} tasks are still open this week.`,
        ctaLabel: "Review Plan",
        href: "#career-plan",
        tone: "ghost",
      },
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));

    return {
      student: {
        id: String(student.id),
        branch: String(student.branch ?? ""),
        batch: String(student.batch ?? ""),
        rollNumber: String(student.roll_number ?? ""),
        readinessScore: readiness,
      },
      interviewSimulator: {
        history: interviews,
      },
      placementPredictor: {
        score: predictorScore,
        shortlistProbability,
        band: shortlistProbability >= 75 ? "High" : shortlistProbability >= 55 ? "Moderate" : "Needs Work",
        signals: {
          readiness,
          mockAverage,
          codingSolved,
          studyHours: Number(totalStudyHours.toFixed(2)),
        },
        risks,
        nextBestAction: risks[0] ?? "Maintain momentum and keep company-specific preparation active.",
      },
      actionPlan: actionPlanData,
      codingTracker: {
        profiles: codingProfiles.map((profile) => ({
          id: String(profile.id),
          platform: String(profile.platform),
          handle: String(profile.handle),
          solvedCount: Number(profile.solved_count ?? 0),
          weeklyGoal: Number(profile.weekly_goal ?? 0),
          streakDays: Number(profile.streak_days ?? 0),
          updatedAt: String(profile.updated_at),
        })),
      },
      mentorship: {
        pool: mentorPool,
        matches: mentorship,
      },
      wallet: {
        items: wallet,
      },
      calendar: {
        upcomingDrives: drives.map((drive) => ({
          company: String(drive.company),
          role: String(drive.role ?? ""),
          driveDate: String(drive.drive_date),
          status: String(drive.status),
        })),
      },
      weakAreas,
      workflow: {
        nextActions,
        resourceRecommendations: recommendedResources,
        mockRecommendations: recommendedMocks,
        interviewFocus: {
          roleTrack: latestInterview?.role ?? "Software Engineer",
          targetCompany: latestInterview?.company ?? "Infosys",
          targetFocusArea: latestInterview?.focus_area ?? weakAreas[0]?.topicName ?? "Core Placement Rounds",
          recommendedQuestionCategories: latestInterview?.questions.map((question) => question.category) ?? ["introduction", "experience", "domain", "behavioral"],
          latestScore: latestInterview?.overall_score ?? null,
          previousScore: completedInterviews[1]?.overall_score ?? null,
          retryReason: latestInterview?.overall_score && latestInterview.overall_score >= 70
            ? "Push the next round with sharper examples and faster closing lines."
            : "Your interview practice still needs tighter examples, clearer structure, and more confident delivery.",
        },
        progressTrend: {
          mockAverageCurrent: currentMockAverage,
          mockAveragePrevious: previousMockAverage,
          mockAverageDelta: averageDelta(currentMockAverage, previousMockAverage),
          interviewAverageCurrent: currentInterviewAverage,
          interviewAveragePrevious: previousInterviewAverage,
          interviewAverageDelta: averageDelta(currentInterviewAverage, previousInterviewAverage),
          readiness,
          recentStudyHours: Number(recentStudyRows.reduce((sum, item) => sum + Number(item.hours ?? 0), 0).toFixed(2)),
          activeDays7d,
          codingSolved,
        },
      },
    };
  },

  async startInterviewSession(
    tenantId: string,
    userId: string,
    input: { company: string; role: string; focusArea: string; difficulty: InterviewDifficulty },
  ) {
    const db = await getMongoDb();
    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, user_id: userId },
      { projection: { _id: 0, id: 1 } },
    );

    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student profile not found", 404);
    }

    const session: InterviewSession = {
      id: randomUUID(),
      tenant_id: tenantId,
      student_id: String(student.id),
      company: input.company,
      role: input.role,
      focus_area: input.focusArea,
      difficulty: input.difficulty,
      status: "draft",
      questions: getInterviewTemplate(input.company, input.role, input.focusArea, input.difficulty),
      answers: [],
      answer_feedback: [],
      overall_score: null,
      feedback: null,
      created_at: isoNow(),
      completed_at: null,
    };

    await db.collection("interview_sessions").insertOne(session);
    return session;
  },

  async analyzeInterviewAnswer(
    tenantId: string,
    userId: string,
    sessionId: string,
    input: { questionIndex: number; transcript: string; durationSec: number },
  ) {
    const db = await getMongoDb();
    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, user_id: userId },
      { projection: { _id: 0, id: 1 } },
    );

    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student profile not found", 404);
    }

    const session = await db.collection("interview_sessions").findOne(
      { tenant_id: tenantId, id: sessionId, student_id: String(student.id) },
      { projection: { _id: 0 } },
    ) as InterviewSession | null;

    if (!session) {
      throw new AppError("SESSION_NOT_FOUND", "Interview session not found", 404);
    }

    const question = session.questions[input.questionIndex];
    if (!question) {
      throw new AppError("QUESTION_NOT_FOUND", "Interview question not found", 404);
    }

    const localFeedback = buildLocalInterviewFeedback(question, input.transcript, input.durationSec);
    localFeedback.questionIndex = input.questionIndex;

    let parsedFeedback = localFeedback;

    try {
      const prompt = [
        "Role: You are an interview coach for campus placements.",
        "Task: Evaluate the student's spoken answer and return strict JSON only.",
        "JSON schema:",
        '{',
        '  "overallScore": number,',
        '  "strengths": string[],',
        '  "improvements": string[],',
        '  "improvedAnswer": string,',
        '  "followUpQuestion": string',
        '}',
        "Scoring rule: Use the provided rubric totals as a baseline and adjust only if the transcript strongly deserves it.",
        `Question: ${question.prompt}`,
        `Transcript: ${input.transcript}`,
        `Signals: relevance=${localFeedback.rubric.relevance}/25, structure=${localFeedback.rubric.structure}/20, clarity=${localFeedback.rubric.clarity}/15, confidence=${localFeedback.rubric.confidence}/15, wpm=${localFeedback.wordsPerMinute}, fillerCount=${localFeedback.fillerCount}`,
        "Instruction: Respond with JSON only. No markdown.",
      ].join("\n");

      const aiResult = await AIFailoverService.generate({
        tenantId,
        cleanedMessage: `Interview answer review for ${question.category}`,
        prompt,
      });

      const jsonSlice = extractJsonObject(aiResult.response);
      if (jsonSlice) {
        const parsed = JSON.parse(jsonSlice) as {
          overallScore?: number;
          strengths?: string[];
          improvements?: string[];
          improvedAnswer?: string;
          followUpQuestion?: string;
        };

        parsedFeedback = {
          ...localFeedback,
          overallScore: clamp(Math.round(Number(parsed.overallScore ?? localFeedback.overallScore)), 0, 100),
          strengths: parsed.strengths?.filter(Boolean).slice(0, 3) ?? localFeedback.strengths,
          improvements: parsed.improvements?.filter(Boolean).slice(0, 4) ?? localFeedback.improvements,
          improvedAnswer: String(parsed.improvedAnswer ?? localFeedback.improvedAnswer),
          followUpQuestion: String(parsed.followUpQuestion ?? localFeedback.followUpQuestion),
        };
      }
    } catch {
      parsedFeedback = localFeedback;
    }

    const nextAnswers = [...session.answers];
    nextAnswers[input.questionIndex] = input.transcript;
    const nextFeedback = [...(session.answer_feedback ?? [])];
    nextFeedback[input.questionIndex] = parsedFeedback;

    await db.collection("interview_sessions").updateOne(
      { tenant_id: tenantId, id: sessionId },
      {
        $set: {
          answers: nextAnswers,
          answer_feedback: nextFeedback,
          updated_at: isoNow(),
        },
      },
    );

    return parsedFeedback;
  },

  async completeInterviewSession(
    tenantId: string,
    userId: string,
    sessionId: string,
    answers: string[],
  ) {
    const db = await getMongoDb();
    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, user_id: userId },
      { projection: { _id: 0, id: 1 } },
    );

    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student profile not found", 404);
    }

    const session = await db.collection("interview_sessions").findOne(
      { tenant_id: tenantId, id: sessionId, student_id: String(student.id) },
      { projection: { _id: 0 } },
    ) as InterviewSession | null;

    if (!session) {
      throw new AppError("SESSION_NOT_FOUND", "Interview session not found", 404);
    }

    const scored = scoreInterview(session.questions, answers);
    const feedbackScores = (session.answer_feedback ?? [])
      .filter((item): item is InterviewAnswerFeedback => Boolean(item))
      .map((item) => Number(item.overallScore ?? 0));
    const overallScore = feedbackScores.length > 0 ? average(feedbackScores) : scored.overall;
    const completed = {
      ...session,
      answers,
      status: "completed" as const,
      overall_score: overallScore,
      feedback: scored.feedback,
      completed_at: isoNow(),
    };

    await db.collection("interview_sessions").updateOne(
      { tenant_id: tenantId, id: sessionId },
      {
        $set: {
          answers,
          status: "completed",
          overall_score: overallScore,
          feedback: scored.feedback,
          completed_at: completed.completed_at,
        },
      },
    );

    return completed;
  },

  async generateActionPlan(tenantId: string, userId: string) {
    const db = await getMongoDb();
    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, user_id: userId },
      { projection: { _id: 0, id: 1, readiness_score: 1 } },
    );

    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student profile not found", 404);
    }

    const [mastery, attempts, codingProfiles] = await Promise.all([
      db.collection("topic_mastery").find(
        { tenant_id: tenantId, student_id: String(student.id) },
        { projection: { _id: 0, topic_id: 1, mastery_level: 1 } },
      ).toArray(),
      db.collection("student_attempts").find(
        { tenant_id: tenantId, student_id: String(student.id), status: "submitted" },
        { projection: { _id: 0, score: 1 } },
      ).sort({ submitted_at: -1 }).limit(5).toArray(),
      db.collection("coding_profiles").find(
        { tenant_id: tenantId, student_id: String(student.id) },
        { projection: { _id: 0, solved_count: 1 } },
      ).toArray(),
    ]);

    const topics = mastery.length > 0
      ? await db.collection("topics").find(
          { id: { $in: mastery.map((item) => String(item.topic_id)) } },
          { projection: { _id: 0, id: 1, name: 1 } },
        ).toArray()
      : [];
    const topicMap = new Map(topics.map((topic) => [String(topic.id), String(topic.name)]));

    const weakAreas = mastery
      .map((item) => ({
        topicId: String(item.topic_id),
        topicName: topicMap.get(String(item.topic_id)) ?? String(item.topic_id),
        masteryLevel: Number(item.mastery_level ?? 0),
      }))
      .sort((a, b) => a.masteryLevel - b.masteryLevel)
      .slice(0, 3);

    const mockAverage = average(attempts.map((item) => Number(item.score ?? 0)));
    const codingSolved = codingProfiles.reduce((sum, item) => sum + Number(item.solved_count ?? 0), 0);
    const weekStart = startOfWeekIso();
    const tasks = [
      {
        id: randomUUID(),
        title: `Revise ${weakAreas[0]?.topicName ?? "core aptitude"} fundamentals`,
        category: "mastery",
        target: "2 focused study sessions + 1 revision sheet",
        completed: false,
      },
      {
        id: randomUUID(),
        title: "Take one mock test under timed conditions",
        category: "assessment",
        target: mockAverage >= 70 ? "Maintain 70%+ score" : "Improve score by 8 points",
        completed: false,
      },
      {
        id: randomUUID(),
        title: "Practice coding set",
        category: "coding",
        target: codingSolved >= 180 ? "12 medium problems" : "18 easy/medium problems",
        completed: false,
      },
      {
        id: randomUUID(),
        title: "Prepare company story bank",
        category: "interview",
        target: "Write 4 STAR stories for HR and behavioral rounds",
        completed: false,
      },
    ];

    const plan = {
      id: randomUUID(),
      tenant_id: tenantId,
      student_id: String(student.id),
      week_start: weekStart,
      status: "active",
      focus_areas: weakAreas,
      tasks,
      generated_at: isoNow(),
      target_readiness: clamp(Number(student.readiness_score ?? 0) + 6, 0, 100),
    };

    await db.collection("action_plans").updateOne(
      { tenant_id: tenantId, student_id: String(student.id), week_start: weekStart },
      {
        $set: {
          ...plan,
          updated_at: isoNow(),
        },
        $setOnInsert: {
          created_at: isoNow(),
        },
      },
      { upsert: true },
    );

    return plan;
  },

  async saveCodingProfile(tenantId: string, userId: string, input: CodingProfileInput) {
    const db = await getMongoDb();
    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, user_id: userId },
      { projection: { _id: 0, id: 1 } },
    );

    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student profile not found", 404);
    }

    const now = isoNow();
    const profile = {
      id: randomUUID(),
      tenant_id: tenantId,
      student_id: String(student.id),
      platform: input.platform,
      handle: input.handle,
      solved_count: input.solvedCount,
      weekly_goal: input.weeklyGoal,
      streak_days: input.streakDays,
      updated_at: now,
    };

    await db.collection("coding_profiles").updateOne(
      { tenant_id: tenantId, student_id: String(student.id), platform: input.platform },
      {
        $set: profile,
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );

    return profile;
  },

  async getMentorship(tenantId: string, userId: string) {
    const db = await getMongoDb();
    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, user_id: userId },
      { projection: { _id: 0, id: 1 } },
    );

    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student profile not found", 404);
    }

    const matches = await db.collection("mentorship_matches").find(
      { tenant_id: tenantId, student_id: String(student.id) },
      { projection: { _id: 0 } },
    ).sort({ created_at: -1 }).toArray();

    return {
      pool: mentorPool,
      matches,
    };
  },

  async requestMentorship(
    tenantId: string,
    userId: string,
    input: { domain: string; targetCompany: string; note: string },
  ) {
    const db = await getMongoDb();
    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, user_id: userId },
      { projection: { _id: 0, id: 1 } },
    );

    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student profile not found", 404);
    }

    const mentor = mentorPool.find((item) =>
      item.domain.toLowerCase().includes(input.domain.toLowerCase())
      || item.company.toLowerCase().includes(input.targetCompany.toLowerCase()),
    ) ?? mentorPool[0];

    const record = {
      id: randomUUID(),
      tenant_id: tenantId,
      student_id: String(student.id),
      mentor_name: mentor.name,
      company: mentor.company,
      role: mentor.role,
      domain: mentor.domain,
      request_note: input.note,
      status: "matched",
      created_at: isoNow(),
    };

    await db.collection("mentorship_matches").insertOne(record);
    return record;
  },

  async getWallet(tenantId: string, userId: string) {
    const db = await getMongoDb();
    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, user_id: userId },
      { projection: { _id: 0, id: 1 } },
    );

    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student profile not found", 404);
    }

    const items = await db.collection("achievement_wallet").find(
      { tenant_id: tenantId, student_id: String(student.id) },
      { projection: { _id: 0 } },
    ).sort({ achieved_at: -1 }).toArray();

    return { items };
  },

  async addWalletItem(tenantId: string, userId: string, input: WalletItemInput) {
    const db = await getMongoDb();
    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, user_id: userId },
      { projection: { _id: 0, id: 1 } },
    );

    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student profile not found", 404);
    }

    const record = {
      id: randomUUID(),
      tenant_id: tenantId,
      student_id: String(student.id),
      title: input.title,
      issuer: input.issuer,
      type: input.type,
      achieved_at: input.achievedAt,
      evidence_url: input.evidenceUrl ?? null,
      created_at: isoNow(),
    };

    await db.collection("achievement_wallet").insertOne(record);
    return record;
  },

  async getOpsHub(tenantId: string) {
    const db = await getMongoDb();
    const [recruiters, campaigns, calendarEvents, drives, driveResults, billing, studentCount, communicationsCount] = await Promise.all([
      db.collection("recruiter_partners").find(
        { tenant_id: tenantId },
        { projection: { _id: 0 } },
      ).sort({ created_at: -1 }).limit(12).toArray(),
      db.collection("communication_campaigns").find(
        { tenant_id: tenantId },
        { projection: { _id: 0 } },
      ).sort({ scheduled_for: 1 }).limit(12).toArray(),
      db.collection("calendar_events").find(
        { tenant_id: tenantId },
        { projection: { _id: 0 } },
      ).sort({ starts_at: 1 }).limit(12).toArray(),
      db.collection("drives").find(
        { tenant_id: tenantId, deleted_at: null },
        { projection: { _id: 0, id: 1, company: 1, role: 1, drive_date: 1, status: 1 } },
      ).sort({ drive_date: 1 }).limit(12).toArray(),
      db.collection("drive_results").find(
        { tenant_id: tenantId },
        { projection: { _id: 0, drive_id: 1, outcome: 1 } },
      ).toArray(),
      db.collection("tenant_billing").findOne(
        { tenant_id: tenantId },
        { projection: { _id: 0 } },
      ),
      db.collection("students").countDocuments({ tenant_id: tenantId }),
      db.collection("communications").countDocuments({ tenant_id: tenantId }),
    ]);

    const resultsByDrive = new Map<string, { shortlisted: number; selected: number }>();
    driveResults.forEach((result) => {
      const key = String(result.drive_id);
      const current = resultsByDrive.get(key) ?? { shortlisted: 0, selected: 0 };
      if (String(result.outcome) === "shortlisted") {
        current.shortlisted += 1;
      }
      if (String(result.outcome) === "selected") {
        current.selected += 1;
      }
      resultsByDrive.set(key, current);
    });

    const driveTimeline = drives.map((drive) => {
      const stat = resultsByDrive.get(String(drive.id)) ?? { shortlisted: 0, selected: 0 };
      return {
        id: String(drive.id),
        title: `${String(drive.company)}${drive.role ? ` - ${String(drive.role)}` : ""}`,
        startsAt: String(drive.drive_date),
        status: String(drive.status),
        shortlisted: stat.shortlisted,
        selected: stat.selected,
      };
    });

    const resolvedBilling = billing ?? {
      id: randomUUID(),
      tenant_id: tenantId,
      plan_name: "Growth",
      billing_cycle: "annual",
      student_limit: 500,
      ai_quota: 10000,
      message_quota: 25000,
      monthly_price: 24999,
      renewal_date: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      status: "active",
      usage: {
        students: studentCount,
        ai: Math.min(10000, studentCount * 14),
        messages: communicationsCount,
      },
      updated_at: isoNow(),
    };

    if (!billing) {
      await db.collection("tenant_billing").insertOne({
        ...resolvedBilling,
        created_at: isoNow(),
      });
    }

    return {
      recruiterPortal: {
        partners: recruiters,
      },
      campaigns: {
        items: campaigns,
      },
      calendar: {
        events: calendarEvents,
        driveTimeline,
      },
      revenue: {
        ...resolvedBilling,
      },
    };
  },

  async addRecruiterPartner(tenantId: string, input: RecruiterInput) {
    const db = await getMongoDb();
    const record = {
      id: randomUUID(),
      tenant_id: tenantId,
      company: input.company,
      contact_name: input.contactName,
      contact_email: input.contactEmail,
      open_roles: input.openRoles,
      notes: input.notes ?? null,
      status: "active",
      created_at: isoNow(),
    };

    await db.collection("recruiter_partners").insertOne(record);
    return record;
  },

  async addCampaign(tenantId: string, input: CampaignInput) {
    const db = await getMongoDb();
    const record = {
      id: randomUUID(),
      tenant_id: tenantId,
      name: input.name,
      audience: input.audience,
      channel: input.channel,
      scheduled_for: input.scheduledFor,
      goal: input.goal,
      status: "scheduled",
      sent_count: 0,
      open_rate: 0,
      click_rate: 0,
      created_at: isoNow(),
    };

    await db.collection("communication_campaigns").insertOne(record);
    return record;
  },

  async addCalendarEvent(tenantId: string, input: CalendarEventInput) {
    const db = await getMongoDb();
    const record = {
      id: randomUUID(),
      tenant_id: tenantId,
      title: input.title,
      type: input.type,
      starts_at: input.startsAt,
      audience: input.audience,
      reminder_offset_hours: input.reminderOffsetHours,
      reminder_status: "scheduled",
      created_at: isoNow(),
    };

    await db.collection("calendar_events").insertOne(record);
    return record;
  },

  async updateBillingPlan(tenantId: string, input: BillingPlanInput) {
    const db = await getMongoDb();
    const now = isoNow();
    const record = {
      id: randomUUID(),
      tenant_id: tenantId,
      plan_name: input.planName,
      billing_cycle: input.billingCycle,
      student_limit: input.studentLimit,
      ai_quota: input.aiQuota,
      message_quota: input.messageQuota,
      monthly_price: input.monthlyPrice,
      renewal_date: input.renewalDate,
      status: "active",
      updated_at: now,
    };

    const studentCount = await db.collection("students").countDocuments({ tenant_id: tenantId });
    const communicationsCount = await db.collection("communications").countDocuments({ tenant_id: tenantId });

    await db.collection("tenant_billing").updateOne(
      { tenant_id: tenantId },
      {
        $set: {
          ...record,
          usage: {
            students: studentCount,
            ai: Math.min(input.aiQuota, studentCount * 14),
            messages: communicationsCount,
          },
        },
        $setOnInsert: {
          created_at: now,
        },
      },
      { upsert: true },
    );

    return {
      ...record,
      usage: {
        students: studentCount,
        ai: Math.min(input.aiQuota, studentCount * 14),
        messages: communicationsCount,
      },
    };
  },
};
