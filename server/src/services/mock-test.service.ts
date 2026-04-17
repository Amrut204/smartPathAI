import { AppError } from "../middleware/error-handler.js";
import { MockTestRepository } from "../repositories/mock-test.repository.js";
import {
  assertTimeWithinDuration,
  computeTimeTakenSec,
  parseQuestions,
  randomizeQuestionsForAttempt,
  scoreSubmission,
} from "./mock-test-scoring.js";
import { PointsService } from "./points.service.js";
import { ReadinessService } from "./readiness.service.js";
import { StudentRepository } from "../repositories/student.repository.js";
import { getMongoDb } from "../utils/mongodb.js";
import { StudentActivityService } from "./student-activity.service.js";
import { getBranchPrepTrack } from "../config/branch-prep.config.js";
import { normalizeStudentProfileData } from "../utils/student-profile.js";
import {
  inferMockTestBranches,
  inferMockTestIsCrossBranch,
  matchesMockTestBranch,
  normalizeMockTestBranches,
} from "../config/mock-test-branch.config.js";

const STUDENT_MIN_VISIBLE_QUESTION_COUNT = 10;
const MOCK_BRANCH_SECTION_THRESHOLD = 5;
const PERCENTILE_MIN_ATTEMPTS = 15;
const RETRY_SCORE_THRESHOLD = 60;
const RETRY_AGE_DAYS = 7;
const PLACEMENT_ESSENTIAL_TRACKS = new Set(["aptitude", "verbal", "general"]);
const INTERVIEW_KEYWORDS = ["interview", "viva", "hr round", "technical round", "communication", "discussion"];

interface ListTestsInput {
  tenantId: string;
  userId: string;
  role: "student" | "tpo" | "admin";
  topicId?: string;
  companyId?: string;
  difficulty?: "easy" | "medium" | "hard";
  limit?: number;
  cursor?: string;
}

interface SubmitInput {
  tenantId: string;
  userId: string;
  attemptId: string;
  answers: Array<{ questionIndex: number; selectedOption: number }>;
  idempotencyKey: string;
  integrity?: {
    copyEvents: number;
    pasteEvents: number;
    visibilityChanges: number;
    blurEvents: number;
  };
}

function buildIntegritySummary(input: SubmitInput["integrity"] | undefined, timeTakenSec: number, questionCount: number) {
  const base = {
    copyEvents: Number(input?.copyEvents ?? 0),
    pasteEvents: Number(input?.pasteEvents ?? 0),
    visibilityChanges: Number(input?.visibilityChanges ?? 0),
    blurEvents: Number(input?.blurEvents ?? 0),
  };
  const reasons = [];

  if (base.pasteEvents > 0) reasons.push("paste_detected");
  if (base.copyEvents >= 3) reasons.push("high_copy_activity");
  if (base.visibilityChanges >= 3) reasons.push("repeated_tab_switching");
  if (base.blurEvents >= 3) reasons.push("window_focus_loss");
  if (questionCount > 0 && timeTakenSec > 0 && timeTakenSec / questionCount < 15) {
    reasons.push("very_fast_submission");
  }

  return {
    ...base,
    flagged: reasons.length > 0,
    reasons,
  };
}

function classifyTrackCategory(input: {
  title: string;
  topicName?: string | null;
  companyName?: string | null;
}) {
  const haystack = `${input.title} ${input.topicName ?? ""} ${input.companyName ?? ""}`.toLowerCase();
  const companyKeywordMatch = /\b(tcs|infosys|wipro|accenture|cognizant|capgemini|nqt|ibm|deloitte|tech mahindra|hcl)\b/i.test(haystack);
  const companyPrepKeywordMatch = /\b(memory based|placement paper|company[-\s]?specific|campus paper|nqt|pattern|variant|assessment|online test|mock test)\b/i.test(haystack);
  const branchCoreKeywordMatch = /\b(electrical|electronics|mechanical|civil|thermodynamics|surveying|circuits|signals|machines|structure|manufacturing|vlsi|power systems|digital electronics|analog electronics|strength of materials|fluid mechanics|geotechnical)\b/i.test(haystack);

  if (input.companyName || (companyKeywordMatch && companyPrepKeywordMatch) || /\b(company paper)\b/i.test(haystack)) {
    return "company_prep";
  }
  if (/\b(verbal|english|grammar|communication|reading comprehension|sentence correction)\b/i.test(haystack)) {
    return "verbal";
  }
  if (/\b(aptitude|reasoning|quant|quantitative|probability|ratio|percentage|permutation|combination|number system)\b/i.test(haystack)) {
    return "aptitude";
  }
  if (branchCoreKeywordMatch) {
    return "branch_core";
  }
  return "general";
}

function sliceSection(items: Array<Awaited<ReturnType<typeof decorateListedItems>>[number]>, predicate: (item: Awaited<ReturnType<typeof decorateListedItems>>[number]) => boolean, limit: number) {
  return items.filter(predicate).slice(0, limit);
}

type DecoratedMockTestItem = Awaited<ReturnType<typeof decorateListedItems>>[number];
type RecommendedMockTestItem = DecoratedMockTestItem & {
  recommendationScore: number;
  recommendationReasons: string[];
  difficultyFit: "stretch" | "fit" | "easy";
  recommendationBucket?: string;
};

function normalizeRecommendationText(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function uniqueMockTestsById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function matchesAnyMockKeyword(item: DecoratedMockTestItem, keywords: string[]) {
  const haystack = normalizeRecommendationText(`${item.title} ${item.topicName ?? ""} ${item.companyName ?? ""}`);
  return keywords.some((keyword) => haystack.includes(normalizeRecommendationText(keyword)));
}

function stripRecommendationFlags(
  items: Array<RecommendedMockTestItem & {
    recommendationFlags: {
      weakTopicMatch: boolean;
      branchMatch: boolean;
      driveMatch: boolean;
      retryMatch: boolean;
    };
  }>,
) {
  return items.map(({ recommendationFlags: _ignored, ...item }) => item);
}

function resolveDifficultyFit(readinessScore: number, difficulty: string): "stretch" | "fit" | "easy" {
  const normalizedDifficulty = normalizeRecommendationText(difficulty);
  if (readinessScore < 40) {
    return normalizedDifficulty === "easy" ? "fit" : "stretch";
  }
  if (readinessScore < 70) {
    if (normalizedDifficulty === "medium") return "fit";
    if (normalizedDifficulty === "easy") return "easy";
    return "stretch";
  }
  if (normalizedDifficulty === "hard") return "fit";
  if (normalizedDifficulty === "medium") return "fit";
  return "easy";
}

function scoreMockTestRecommendation(
  item: DecoratedMockTestItem & {
    avgScore: number | null;
    lastScore: number | null;
    lastSubmittedAt: string | null;
  },
  context: {
    readinessScore: number;
    studentBranch: string;
    weakAreas: Array<{ topicId: string; topicName: string; masteryLevel: number }>;
    branchTrackLabel: string;
    focusAreaNames: string[];
    upcomingDrives: Array<{ company: string; role: string; driveDate: string; status: string }>;
  },
) {
  const haystack = normalizeRecommendationText(`${item.title} ${item.topicName ?? ""} ${item.companyName ?? ""}`);
  const reasons: string[] = [];
  let score = 0;
  let weakTopicMatch = false;
  let branchMatch = false;
  let driveMatch = false;
  let retryMatch = false;

  for (const weakArea of context.weakAreas) {
    const weakName = normalizeRecommendationText(weakArea.topicName);
    if ((item.topicId && item.topicId === weakArea.topicId) || (weakName && haystack.includes(weakName))) {
      score += 26;
      weakTopicMatch = true;
      reasons.push(`Targets a weak topic for you: ${weakArea.topicName}.`);
      break;
    }
  }

  if (
    matchesMockTestBranch(
      {
        primaryBranches: item.primaryBranches,
        title: item.title,
        topicName: item.topicName,
        companyName: item.companyName,
      },
      context.studentBranch,
    )
  ) {
    const branchTrackName = normalizeRecommendationText(context.branchTrackLabel);
    if (
      context.focusAreaNames.some((topicName) => haystack.includes(topicName))
      || (branchTrackName && haystack.includes(branchTrackName))
      || (item.primaryBranches?.length ?? 0) > 0
    ) {
      score += 18;
      branchMatch = true;
      reasons.push(`Relevant to your ${context.branchTrackLabel} branch preparation.`);
    }
  }

  for (const drive of context.upcomingDrives) {
    const company = normalizeRecommendationText(drive.company);
    const role = normalizeRecommendationText(drive.role);
    if ((company && haystack.includes(company)) || (role && haystack.includes(role))) {
      score += 24;
      driveMatch = true;
      reasons.push(`Useful for your upcoming ${drive.company} drive.`);
      break;
    }
  }

  if ((item.avgScore ?? 0) > 0 && (item.avgScore ?? 0) < RETRY_SCORE_THRESHOLD) {
    score += 18;
    retryMatch = true;
    reasons.push("Worth retrying to improve a lower recent score.");
  } else if ((item.attemptCount ?? 0) === 0) {
    score += 8;
    reasons.push("Fresh test you have not attempted yet.");
  }

  const difficultyFit = resolveDifficultyFit(context.readinessScore, item.difficulty);
  if (difficultyFit === "fit") {
    score += 12;
    reasons.push("Difficulty is a good fit for your current readiness.");
  } else if (difficultyFit === "easy") {
    score += 4;
  } else {
    score += 2;
  }

  const recentAttemptMs = item.lastSubmittedAt ? Date.parse(item.lastSubmittedAt) : Number.NaN;
  if (Number.isFinite(recentAttemptMs)) {
    const ageMs = Date.now() - recentAttemptMs;
    if (ageMs < RETRY_AGE_DAYS * 24 * 60 * 60 * 1000 && !retryMatch) {
      score -= 8;
      reasons.push("Tried recently, so other tests are boosted first.");
    }
  }

  if (item.trackCategory === "company_prep") score += 4;
  if (item.isCrossBranch || item.trackCategory === "aptitude" || item.trackCategory === "verbal") score += 3;

  return {
    ...item,
    recommendationScore: score,
    recommendationReasons: reasons.slice(0, 3),
    difficultyFit,
    recommendationFlags: {
      weakTopicMatch,
      branchMatch,
      driveMatch,
      retryMatch,
    },
  };
}

interface SaveProgressInput {
  tenantId: string;
  userId: string;
  attemptId: string;
  answers: Record<string, number>;
  currentQuestion: number;
}

function selectRecommendedMockTests(
  items: Array<RecommendedMockTestItem & {
    recommendationFlags: {
      weakTopicMatch: boolean;
      branchMatch: boolean;
      driveMatch: boolean;
      retryMatch: boolean;
    };
  }>,
  predicate: (
    item: RecommendedMockTestItem & {
      recommendationFlags: {
        weakTopicMatch: boolean;
        branchMatch: boolean;
        driveMatch: boolean;
        retryMatch: boolean;
      };
    },
  ) => boolean,
  limit: number,
  bucket: string,
) {
  return uniqueMockTestsById(
    items
      .filter(predicate)
      .sort((left, right) => right.recommendationScore - left.recommendationScore)
      .slice(0, limit)
      .map((item) => ({
        ...item,
        recommendationBucket: bucket,
      })),
  );
}

async function decorateListedItems(
  tenantId: string,
  items: Array<{
    id: string;
    title: string;
    topicId: string | null;
    companyId: string | null;
    durationSec: number;
    difficulty: string;
    isActive?: boolean;
    attemptCount?: number;
    primaryBranches?: string[];
    isCrossBranch?: boolean;
  }>,
) {
  if (items.length === 0) {
    return [];
  }

  const db = await getMongoDb();
  const topicIds = [...new Set(items.map((item) => item.topicId).filter((value): value is string => Boolean(value)))];
  const companyIds = [...new Set(items.map((item) => item.companyId).filter((value): value is string => Boolean(value)))];

  const [topics, companies] = await Promise.all([
    topicIds.length > 0
      ? db.collection("topics").find(
          { id: { $in: topicIds }, $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
          { projection: { _id: 0, id: 1, name: 1 } },
        ).toArray()
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.collection("companies").find(
          { id: { $in: companyIds }, $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
          { projection: { _id: 0, id: 1, name: 1 } },
        ).toArray()
      : Promise.resolve([]),
  ]);

  const topicMap = new Map(topics.map((topic) => [String(topic.id), String(topic.name ?? "")]));
  const companyMap = new Map(companies.map((company) => [String(company.id), String(company.name ?? "")]));

  return items.map((item) => {
    const topicName = item.topicId ? topicMap.get(item.topicId) ?? null : null;
    const companyName = item.companyId ? companyMap.get(item.companyId) ?? null : null;
    const trackCategory = classifyTrackCategory({
      title: item.title,
      topicName,
      companyName,
    });
    const primaryBranches = normalizeMockTestBranches(
      (item.primaryBranches?.length ?? 0) > 0
        ? item.primaryBranches
        : inferMockTestBranches({
          title: item.title,
          topicName,
          companyName,
        }),
    );
    const isCrossBranch = Boolean(item.isCrossBranch)
      || ((item.primaryBranches?.length ?? 0) === 0
        && primaryBranches.length === 0
        && inferMockTestIsCrossBranch({ title: item.title, topicName, companyName }, trackCategory));

    return {
      ...item,
      topicName,
      companyName,
      trackCategory,
      primaryBranches,
      isCrossBranch,
    };
  });
}

export const MockTestService = {
  async listTests(input: ListTestsInput) {
    const listed = await MockTestRepository.listTests(input.tenantId, {
      topicId: input.topicId,
      companyId: input.companyId,
      difficulty: input.difficulty,
      limit: input.limit ?? 20,
      cursor: input.cursor,
      includeInactive: input.role !== "student",
      minQuestionCount: input.role === "student" ? STUDENT_MIN_VISIBLE_QUESTION_COUNT : undefined,
    });

    if (input.role !== "student") {
      return {
        items: await decorateListedItems(input.tenantId, listed.items.map((item) => ({
          ...item,
          attemptCount: 0,
        }))),
        hasMore: listed.hasMore,
        nextCursor: listed.nextCursor,
      };
    }

    const student = await StudentRepository.getStudentByUserId(input.tenantId, input.userId);
    const attemptCounts = await MockTestRepository.countAttemptsByStudent(
      input.tenantId,
      String(student.id),
      listed.items.map((item) => item.id),
    );

    const decoratedItems = await decorateListedItems(input.tenantId, listed.items.map((item) => ({
      ...item,
      attemptCount: attemptCounts.get(item.id) ?? 0,
    })));

    return {
      items: decoratedItems,
      hasMore: listed.hasMore,
      nextCursor: listed.nextCursor,
    };
  },

  async getCuratedTests(input: ListTestsInput) {
    const listed = await this.listTests({
      ...input,
      cursor: undefined,
      limit: 120,
    });

    const items = listed.items;
    if (input.role !== "student") {
      return {
        context: {
          branchTrackLabel: null,
          targetRoles: [] as string[],
          branchCoverageQualified: false,
          upcomingDriveCount: 0,
          hasPreDriveBundle: false,
        },
        stats: {
          totalCatalog: items.length,
          hardSets: items.filter((item) => item.difficulty.toLowerCase() === "hard").length,
          companyFocused: items.filter((item) => Boolean(item.companyId)).length,
          avgAttempts: 0,
        },
        sections: {
          forYourBranch: [] as typeof items,
          placementEssentials: sliceSection(items, (item) => PLACEMENT_ESSENTIAL_TRACKS.has(item.trackCategory ?? "general"), 8),
          companyPatternPrep: sliceSection(items, (item) => item.trackCategory === "company_prep", 8),
          interviewPractice: sliceSection(items, (item) => matchesAnyMockKeyword(item, INTERVIEW_KEYWORDS), 6),
          exploreMore: sliceSection(items, () => true, 12),
        },
        preDriveBundle: null,
      };
    }

    const student = await StudentRepository.getStudentByUserId(input.tenantId, input.userId);
    const profileData = normalizeStudentProfileData(student.profile_data);
    const dashboard = await StudentRepository.getDashboardData(input.tenantId, String(student.id));
    const db = await getMongoDb();
    const attemptRows = items.length > 0
      ? await db.collection("student_attempts").find(
          {
            tenant_id: input.tenantId,
            student_id: String(student.id),
            status: "submitted",
            test_id: { $in: items.map((item) => item.id) },
          },
          { projection: { _id: 0, test_id: 1, score: 1, submitted_at: 1 } },
        ).sort({ submitted_at: -1 }).toArray()
      : [];
    const attemptSummaryMap = new Map<string, {
      count: number;
      avgScore: number | null;
      lastScore: number | null;
      lastSubmittedAt: string | null;
    }>();
    attemptRows.forEach((attempt) => {
      const key = String(attempt.test_id);
      const existing = attemptSummaryMap.get(key) ?? {
        count: 0,
        avgScore: 0,
        lastScore: null,
        lastSubmittedAt: null,
      };
      attemptSummaryMap.set(key, {
        count: existing.count + 1,
        avgScore: (Number(existing.avgScore ?? 0) * existing.count + Number(attempt.score ?? 0)) / (existing.count + 1),
        lastScore: existing.lastScore ?? Number(attempt.score ?? 0),
        lastSubmittedAt: existing.lastSubmittedAt ?? String(attempt.submitted_at ?? ""),
      });
    });
    const branchTrack = getBranchPrepTrack(String(student.branch ?? ""), { fallback: "placement_essentials" });
    const focusAreaNames = branchTrack.focusAreas.map((item) => item.topicName.toLowerCase());
    const scoredItems = items
      .map((item) => {
        const summary = attemptSummaryMap.get(item.id);
        return scoreMockTestRecommendation({
          ...item,
          avgScore: summary?.avgScore === undefined ? null : Number((summary.avgScore ?? 0).toFixed(1)),
          lastScore: summary?.lastScore ?? null,
          lastSubmittedAt: summary?.lastSubmittedAt ?? null,
        }, {
          readinessScore: dashboard.readinessScore,
          studentBranch: String(student.branch ?? ""),
          weakAreas: dashboard.weakAreas,
          branchTrackLabel: branchTrack.label,
          focusAreaNames,
          upcomingDrives: dashboard.upcomingDrives,
        });
      })
      .sort((left, right) => right.recommendationScore - left.recommendationScore);
    const forYourBranch = selectRecommendedMockTests(
      scoredItems,
      (item) => !item.isCrossBranch && item.recommendationFlags.branchMatch,
      8,
      "for_your_branch",
    );
    const placementEssentials = selectRecommendedMockTests(
      scoredItems,
      (item) =>
        PLACEMENT_ESSENTIAL_TRACKS.has(item.trackCategory ?? "general")
        || item.recommendationFlags.weakTopicMatch
        || item.isCrossBranch,
      8,
      "placement_essentials",
    );
    const companyPatternPrep = selectRecommendedMockTests(
      scoredItems,
      (item) => item.recommendationFlags.driveMatch || item.trackCategory === "company_prep" || Boolean(item.companyId),
      8,
      "company_pattern_prep",
    );
    const interviewPractice = selectRecommendedMockTests(
      scoredItems,
      (item) => matchesAnyMockKeyword(item, INTERVIEW_KEYWORDS),
      6,
      "interview_practice",
    );
    const branchCorePractice = selectRecommendedMockTests(
      scoredItems,
      (item) => !item.isCrossBranch && (item.trackCategory === "branch_core" || item.recommendationFlags.branchMatch),
      8,
      "branch_core_practice",
    );
    const branchCoverageQualified = forYourBranch.length >= MOCK_BRANCH_SECTION_THRESHOLD;
    const effectiveBranchSection = branchCoverageQualified ? forYourBranch : branchCorePractice.slice(0, 6);
    const preDriveBundleItems = selectRecommendedMockTests(
      scoredItems,
      (item) => item.recommendationFlags.driveMatch || item.trackCategory === "company_prep",
      5,
      "pre_drive_bundle",
    );
    const usedIds = new Set([
      ...effectiveBranchSection.map((item) => item.id),
      ...placementEssentials.map((item) => item.id),
      ...companyPatternPrep.map((item) => item.id),
      ...interviewPractice.map((item) => item.id),
    ]);
    const exploreMore = scoredItems.filter((item) => !usedIds.has(item.id)).slice(0, 12);

    return {
      context: {
        branchTrackLabel: branchTrack.label,
        targetRoles: profileData.targetRoles,
        branchCoverageQualified,
        upcomingDriveCount: dashboard.upcomingDrives.length,
        hasPreDriveBundle: preDriveBundleItems.length > 0,
      },
      stats: {
        totalCatalog: items.length,
        hardSets: items.filter((item) => item.difficulty.toLowerCase() === "hard").length,
        companyFocused: items.filter((item) => Boolean(item.companyId)).length,
        avgAttempts: items.length > 0 ? Number((items.reduce((sum, item) => sum + (item.attemptCount ?? 0), 0) / items.length).toFixed(1)) : 0,
      },
      sections: {
        forYourBranch: stripRecommendationFlags(effectiveBranchSection),
        placementEssentials: stripRecommendationFlags(placementEssentials),
        companyPatternPrep: stripRecommendationFlags(companyPatternPrep),
        interviewPractice: stripRecommendationFlags(interviewPractice),
        exploreMore: stripRecommendationFlags(exploreMore),
      },
      preDriveBundle: preDriveBundleItems.length > 0
        ? {
            title: dashboard.upcomingDrives[0]
              ? `Prepare for ${dashboard.upcomingDrives[0].company}${dashboard.upcomingDrives[0].role ? ` - ${dashboard.upcomingDrives[0].role}` : ""}`
              : "Prepare for your next drive",
            description: "A short bundle of tests assembled from upcoming drive signals, branch context, and common placement patterns.",
            items: stripRecommendationFlags(preDriveBundleItems),
          }
        : null,
    };
  },

  async getTestMetadata(tenantId: string, testId: string, role: "student" | "tpo" | "admin") {
    const test = await MockTestRepository.getTestById(tenantId, testId, {
      includeInactive: role !== "student",
      minQuestionCount: role === "student" ? STUDENT_MIN_VISIBLE_QUESTION_COUNT : undefined,
    });
    const questions = parseQuestions(test.questions);

    return {
      id: String(test.id),
      title: String(test.title),
      topicId: test.topic_id ? String(test.topic_id) : null,
      companyId: test.company_id ? String(test.company_id) : null,
      durationSec: Number(test.duration_sec ?? 0),
      difficulty: String(test.difficulty ?? "medium"),
      questionCount: questions.length,
    };
  },

  async createTest(
    tenantId: string,
    createdBy: string,
    input: {
      title: string;
      topicId?: string;
      companyId?: string;
      durationSec: number;
      difficulty: "easy" | "medium" | "hard";
      questions: Array<{
        text: string;
        options: string[];
        correctIndex: number;
        explanation?: string;
        skillTag?: string;
      }>;
      isActive: boolean;
    },
  ) {
    const normalizedQuestions = parseQuestions(input.questions);
    const created = await MockTestRepository.createTest(tenantId, createdBy, {
      ...input,
      questions: normalizedQuestions,
    });
    const questions = parseQuestions(created.questions);

    return {
      id: String(created.id),
      title: String(created.title),
      topicId: created.topic_id ? String(created.topic_id) : null,
      companyId: created.company_id ? String(created.company_id) : null,
      durationSec: Number(created.duration_sec ?? 0),
      difficulty: String(created.difficulty ?? "medium"),
      isActive: Boolean(created.is_active),
      questionCount: questions.length,
    };
  },

  async updateTest(
    tenantId: string,
    testId: string,
    input: Partial<{
      title: string;
      topicId: string;
      companyId: string;
      durationSec: number;
      difficulty: "easy" | "medium" | "hard";
      isActive: boolean;
    }>,
  ) {
    const updated = await MockTestRepository.updateTest(tenantId, testId, input);
    const questions = parseQuestions(updated.questions);

    return {
      id: String(updated.id),
      title: String(updated.title),
      topicId: updated.topic_id ? String(updated.topic_id) : null,
      companyId: updated.company_id ? String(updated.company_id) : null,
      durationSec: Number(updated.duration_sec ?? 0),
      difficulty: String(updated.difficulty ?? "medium"),
      isActive: Boolean(updated.is_active),
      questionCount: questions.length,
    };
  },

  async publishTest(tenantId: string, testId: string, isActive: boolean) {
    const updated = await MockTestRepository.setPublished(tenantId, testId, isActive);
    const questions = parseQuestions(updated.questions);

    return {
      id: String(updated.id),
      title: String(updated.title),
      isActive: Boolean(updated.is_active),
      questionCount: questions.length,
    };
  },

  async getQuestions(
    tenantId: string,
    testId: string,
    role: "student" | "tpo" | "admin",
  ) {
    if (role === "student") {
      await MockTestRepository.getTestById(tenantId, testId, {
        minQuestionCount: STUDENT_MIN_VISIBLE_QUESTION_COUNT,
      });
    }

    const existing = await MockTestRepository.getQuestions(tenantId, testId);
    const questions = parseQuestions(existing.questions);

    if (role === "student") {
      return questions.map((question) => ({
        text: question.text,
        options: question.options,
      }));
    }

    return questions;
  },

  async upsertQuestions(
    tenantId: string,
    testId: string,
    input: {
      append: boolean;
      questions: Array<{
        text: string;
        options: string[];
        correctIndex: number;
        explanation?: string;
        skillTag?: string;
      }>;
    },
  ) {
    const normalizedQuestions = parseQuestions(input.questions);
    if (normalizedQuestions.length === 0) {
      throw new AppError("INVALID_QUESTION_PAYLOAD", "At least one valid question is required", 400);
    }

    return MockTestRepository.upsertQuestions(tenantId, testId, normalizedQuestions, input.append);
  },

  async saveAttemptProgress(input: SaveProgressInput) {
    const student = await StudentRepository.getStudentByUserId(input.tenantId, input.userId);
    return MockTestRepository.savePendingProgress({
      tenantId: input.tenantId,
      studentId: String(student.id),
      attemptId: input.attemptId,
      answers: input.answers,
      currentQuestion: input.currentQuestion,
    });
  },

  async startAttempt(tenantId: string, userId: string, testId: string) {
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    const test = await MockTestRepository.getTestById(tenantId, testId, {
      minQuestionCount: STUDENT_MIN_VISIBLE_QUESTION_COUNT,
    });
    const durationSec = Number(test.duration_sec ?? 0);

    const existingPending = await MockTestRepository.getPendingAttempt(
      tenantId,
      String(student.id),
      String(test.id),
    );

    let reusePending = Boolean(existingPending);
    if (existingPending?.started_at) {
      const startedAtMs = new Date(String(existingPending.started_at)).getTime();
      const elapsedSec = Number.isFinite(startedAtMs)
        ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
        : durationSec + 1;

      if (durationSec > 0 && elapsedSec >= durationSec) {
        await MockTestRepository.expirePendingAttempt(
          tenantId,
          String(student.id),
          String(existingPending.id),
          durationSec,
        );
        reusePending = false;
      }
    }

    const randomizedQuestions = reusePending && Array.isArray(existingPending?.questions_snapshot)
      ? parseQuestions(existingPending.questions_snapshot)
      : randomizeQuestionsForAttempt(parseQuestions(test.questions));

    const attempt = reusePending && existingPending
      ? {
          id: String(existingPending.id),
          started_at: String(existingPending.started_at),
          draft_answers: existingPending.draft_answers ?? {},
          current_question_index: Number(existingPending.current_question_index ?? 0),
        }
      : await MockTestRepository.createPendingAttempt(
          tenantId,
          String(student.id),
          String(test.id),
          randomizedQuestions,
        );

    await StudentActivityService.logEvent({
      id: `mock-start:${String(attempt.id)}`,
      tenantId,
      studentId: String(student.id),
      eventType: "mock_started",
      eventSource: "student_attempts",
      entityId: String(attempt.id),
      entityType: "mock_attempt",
      title: "Mock test started",
      description: `${String(test.title ?? "Mock test")} started.`,
      metadata: {
        testId: String(test.id),
        testTitle: String(test.title ?? "Mock test"),
        difficulty: String(test.difficulty ?? "unknown"),
      },
      impactScore: 28,
      createdAt: String(attempt.started_at ?? new Date().toISOString()),
      module: "Mocks",
    });

    const questions = randomizedQuestions.map((question) => ({
      text: question.text,
      options: question.options,
    }));

    return {
      attemptId: String(attempt.id),
      startedAt: String(attempt.started_at),
      serverTime: new Date().toISOString(),
      durationSec,
      resumed: reusePending,
      savedAnswers: attempt.draft_answers && typeof attempt.draft_answers === "object"
        ? Object.fromEntries(
            Object.entries(attempt.draft_answers as Record<string, unknown>)
              .filter(([, value]) => Number.isInteger(value))
              .map(([key, value]) => [key, Number(value)]),
          )
        : {},
      currentQuestion: Number(attempt.current_question_index ?? 0),
      questions,
    };
  },

  async submitAttempt(input: SubmitInput) {
    const student = await StudentRepository.getStudentByUserId(input.tenantId, input.userId);
    const db = await getMongoDb();

    const existingAttempt = await MockTestRepository.findAttemptByIdempotency(
      input.tenantId,
      String(student.id),
      input.idempotencyKey,
    );

    if (existingAttempt) {
      return {
        attemptId: String(existingAttempt.id),
        score: Number(existingAttempt.score ?? 0),
        timeTakenSec: Number(existingAttempt.time_taken_sec ?? 0),
        topicBreakdown: existingAttempt.topic_breakdown,
        pointsAwarded: 0,
        readinessScore: Number(student.readiness_score ?? 0),
        idempotent: true,
      };
    }

    const attempt = await MockTestRepository.getAttemptById(
      input.tenantId,
      input.attemptId,
      String(student.id),
    );

    if (String(attempt.status) !== "pending") {
      throw new AppError("ATTEMPT_ALREADY_SUBMITTED", "Attempt already submitted", 409);
    }

    const test = await MockTestRepository.getTestById(input.tenantId, String(attempt.test_id));
    const questionSnapshot = Array.isArray(attempt.questions_snapshot) && attempt.questions_snapshot.length > 0
      ? attempt.questions_snapshot
      : test.questions;
    const questions = parseQuestions(questionSnapshot);
    const previousAttempt = await db.collection("student_attempts").find(
      {
        tenant_id: input.tenantId,
        student_id: String(student.id),
        test_id: String(test.id),
        status: "submitted",
      },
      { projection: { _id: 0, id: 1, score: 1, submitted_at: 1 } },
    ).sort({ submitted_at: -1 }).limit(1).next();

    const { answersWithOutcome, correctCount, totalQuestions, score } = scoreSubmission(
      questions,
      input.answers,
    );
    const timeTakenSec = computeTimeTakenSec(String(attempt.started_at));
    const durationSec = Number(test.duration_sec ?? 0);
    assertTimeWithinDuration(timeTakenSec, durationSec);
    const integritySummary = buildIntegritySummary(input.integrity, timeTakenSec, totalQuestions);

    const topicId = test.topic_id ? String(test.topic_id) : "unknown";
    const topicBreakdown = {
      [topicId]: {
        correct: correctCount,
        total: totalQuestions,
      },
    };
    const skillBreakdown = questions.reduce<Record<string, { correct: number; total: number }>>((acc, question, index) => {
      const skillTag = String(question.skillTag ?? "").trim();
      if (!skillTag) return acc;
      const answer = answersWithOutcome.find((item) => item.questionIndex === index);
      const current = acc[skillTag] ?? { correct: 0, total: 0 };
      current.total += 1;
      if (answer?.isCorrect) current.correct += 1;
      acc[skillTag] = current;
      return acc;
    }, {});

    const submitted = await MockTestRepository.submitAttempt({
      tenantId: input.tenantId,
      studentId: String(student.id),
      attemptId: input.attemptId,
      answers: answersWithOutcome,
      score,
      timeTakenSec,
      topicBreakdown,
      skillBreakdown,
      idempotencyKey: input.idempotencyKey,
      integritySummary,
    });

    if (test.topic_id) {
      await MockTestRepository.upsertTopicMastery({
        tenantId: input.tenantId,
        studentId: String(student.id),
        topicId: String(test.topic_id),
        totalQuestions,
        correctAnswers: correctCount,
      });
    }

    await Promise.all(
      Object.entries(skillBreakdown).map(([skillTag, breakdown]) =>
        MockTestRepository.upsertSkillMastery({
          tenantId: input.tenantId,
          studentId: String(student.id),
          skillTag,
          totalQuestions: Number(breakdown.total ?? 0),
          correctAnswers: Number(breakdown.correct ?? 0),
        })
      ),
    );

    const pointsAwarded = await PointsService.awardTestCompletionPoints({
      tenantId: input.tenantId,
      studentId: String(student.id),
      scorePercent: score,
    });

    const readinessScore = await ReadinessService.calculate(input.tenantId, String(student.id));

    await StudentActivityService.logEvent({
      id: `attempt:${String(submitted.id)}`,
      tenantId: input.tenantId,
      studentId: String(student.id),
      eventType: "mock_submitted",
      eventSource: "student_attempts",
      entityId: String(submitted.id),
      entityType: "mock_attempt",
      title: "Mock test submitted",
      description: `${String(test.title ?? "Mock test")} submitted with score ${score.toFixed(1)}%.`,
      metadata: {
        testId: String(test.id),
        testTitle: String(test.title ?? "Mock test"),
        score,
        difficulty: String(test.difficulty ?? "unknown"),
        integrityFlagged: integritySummary.flagged,
      },
      impactScore: score >= 70 ? 78 : 52,
      createdAt: String(submitted.submitted_at ?? new Date().toISOString()),
      module: "Mocks",
    });

    const previousScore = Number(previousAttempt?.score ?? NaN);
    if (Number.isFinite(previousScore)) {
      const delta = score - previousScore;
      if (delta >= 5) {
        await StudentActivityService.logEvent({
          id: `attempt-improved:${String(submitted.id)}`,
          tenantId: input.tenantId,
          studentId: String(student.id),
          eventType: "mock_improved",
          eventSource: "student_attempts",
          entityId: String(submitted.id),
          entityType: "mock_attempt",
          title: "Mock score improved",
          description: `Mock score improved by ${delta.toFixed(1)} points.`,
          metadata: {
            testId: String(test.id),
            previousScore,
            currentScore: score,
            scoreDelta: delta,
          },
          impactScore: 82,
          createdAt: String(submitted.submitted_at ?? new Date().toISOString()),
          module: "Mocks",
        });
      }
    }

    return {
      attemptId: String(submitted.id),
      score,
      timeTakenSec,
      topicBreakdown,
      skillBreakdown,
      pointsAwarded,
      readinessScore,
      idempotent: false,
    };
  },

  async getAttemptResult(tenantId: string, userId: string, attemptId: string) {
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    const attempt = await MockTestRepository.getAttemptById(tenantId, attemptId, String(student.id));
    const test = await MockTestRepository.getTestById(tenantId, String(attempt.test_id), {
      includeInactive: true,
    });
    const questionSnapshot = Array.isArray(attempt.questions_snapshot) && attempt.questions_snapshot.length > 0
      ? attempt.questions_snapshot
      : test.questions;
    const questions = parseQuestions(questionSnapshot);
    const answers = Array.isArray(attempt.answers) ? attempt.answers : [];
    const answeredIndexes = new Set(answers.map((answer) => Number(answer.questionIndex)));
    const correctAnswers = answers.filter((answer) => Boolean(answer.isCorrect)).length;
    const attemptedQuestions = answers.length;
    const incorrectAnswers = Math.max(0, attemptedQuestions - correctAnswers);
    const unattemptedQuestions = Math.max(0, questions.length - attemptedQuestions);
    const [percentileStats, weakSkills, curated] = await Promise.all([
      MockTestRepository.getTestPercentileStats(tenantId, String(attempt.test_id), Number(attempt.score ?? 0)),
      MockTestRepository.getWeakSkills(tenantId, String(student.id), 4),
      this.getCuratedTests({
        tenantId,
        userId,
        role: "student",
      }),
    ]);
    const retryAgeMs = attempt.submitted_at ? Date.now() - new Date(String(attempt.submitted_at)).getTime() : Number.POSITIVE_INFINITY;
    const retrySuggested = Number(attempt.score ?? 0) < RETRY_SCORE_THRESHOLD
      && retryAgeMs >= RETRY_AGE_DAYS * 24 * 60 * 60 * 1000;
    const nextRecommendedTests = uniqueMockTestsById([
      ...(curated.preDriveBundle?.items ?? []),
      ...curated.sections.companyPatternPrep,
      ...curated.sections.interviewPractice,
      ...curated.sections.placementEssentials,
      ...curated.sections.forYourBranch,
    ]).filter((item) => item.id !== String(attempt.test_id)).slice(0, 4);

    return {
      attemptId: String(attempt.id),
      testId: String(attempt.test_id),
      title: String(test.title),
      score: Number(attempt.score ?? 0),
      timeTakenSec: Number(attempt.time_taken_sec ?? 0),
      topicBreakdown: attempt.topic_breakdown ?? {},
      skillBreakdown: attempt.skill_breakdown ?? {},
      submittedAt: attempt.submitted_at ? String(attempt.submitted_at) : null,
      attemptedQuestions,
      correctAnswers,
      incorrectAnswers,
      unattemptedQuestions,
      percentileRank: percentileStats.attemptPopulation >= PERCENTILE_MIN_ATTEMPTS ? percentileStats.percentileRank : null,
      attemptPopulation: percentileStats.attemptPopulation,
      weakAreas: weakSkills,
      nextRecommendedTests,
      retrySuggested,
      answers,
      questions: questions.map((question, index) => ({
        text: question.text,
        options: question.options,
        correctIndex: question.correctIndex,
        explanation: question.explanation ?? "",
        skillTag: question.skillTag ?? "",
        attempted: answeredIndexes.has(index),
      })),
    };
  },
};
