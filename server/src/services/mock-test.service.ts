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
import { getBranchPrepTrack, matchesBranchPrepTrackTag } from "../config/branch-prep.config.js";

const STUDENT_MIN_VISIBLE_QUESTION_COUNT = 10;

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
  const companyPrepKeywordMatch = /\b(memory based|placement paper|company[-\s]?specific|campus paper|nqt)\b/i.test(haystack);
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

function filterItemsForStudentBranch(
  items: Array<Awaited<ReturnType<typeof decorateListedItems>>[number]>,
  branch: string,
) {
  const branchTrack = getBranchPrepTrack(branch);
  const focusAreaNames = branchTrack.focusAreas.map((item) => item.topicName.toLowerCase());

  return items.filter((item) => {
    if (item.trackCategory !== "branch_core") {
      return true;
    }

    const haystack = `${item.title} ${item.topicName ?? ""} ${item.companyName ?? ""}`.toLowerCase();
    if (focusAreaNames.some((topicName) => haystack.includes(topicName))) {
      return true;
    }

    return matchesBranchPrepTrackTag(item.topicName ?? "", branch) || matchesBranchPrepTrackTag(item.title, branch);
  });
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

  if (item.trackCategory === "branch_core") {
    const branchTrackName = normalizeRecommendationText(context.branchTrackLabel);
    if (
      context.focusAreaNames.some((topicName) => haystack.includes(topicName))
      || (branchTrackName && haystack.includes(branchTrackName))
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

  if ((item.avgScore ?? 0) > 0 && (item.avgScore ?? 0) < 65) {
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
    if (ageMs < 7 * 24 * 60 * 60 * 1000 && !retryMatch) {
      score -= 8;
      reasons.push("Tried recently, so other tests are boosted first.");
    }
  }

  if (item.trackCategory === "company_prep") score += 4;
  if (item.trackCategory === "aptitude" || item.trackCategory === "verbal") score += 3;

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
    return {
      ...item,
      topicName,
      companyName,
      trackCategory: classifyTrackCategory({
        title: item.title,
        topicName,
        companyName,
      }),
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
    const branchFilteredItems = filterItemsForStudentBranch(decoratedItems, String(student.branch ?? ""));

    return {
      items: branchFilteredItems,
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
        stats: {
          totalCatalog: items.length,
          hardSets: items.filter((item) => item.difficulty.toLowerCase() === "hard").length,
          companyFocused: items.filter((item) => Boolean(item.companyId)).length,
          avgAttempts: 0,
        },
        sections: {
          recommended: [] as typeof items,
          companyFocused: sliceSection(items, (item) => Boolean(item.companyId), 6),
          companyPrep: sliceSection(items, (item) => item.trackCategory === "company_prep", 8),
          verbal: sliceSection(items, (item) => item.trackCategory === "verbal", 8),
          aptitude: sliceSection(items, (item) => item.trackCategory === "aptitude", 8),
          branchCore: sliceSection(items, (item) => item.trackCategory === "branch_core", 10),
          crossBranch: sliceSection(items, (item) => item.trackCategory === "general", 12),
        },
        branchTrackLabel: null,
      };
    }

    const student = await StudentRepository.getStudentByUserId(input.tenantId, input.userId);
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
    const branchTrack = getBranchPrepTrack(String(student.branch ?? ""));
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
          weakAreas: dashboard.weakAreas,
          branchTrackLabel: branchTrack.label,
          focusAreaNames,
          upcomingDrives: dashboard.upcomingDrives,
        });
      })
      .sort((left, right) => right.recommendationScore - left.recommendationScore);
    const takeNext = selectRecommendedMockTests(scoredItems, () => true, 6, "take_next");
    const weakTopicRecovery = selectRecommendedMockTests(scoredItems, (item) => item.recommendationFlags.weakTopicMatch, 6, "weak_topic_recovery");
    const upcomingDrivePrep = selectRecommendedMockTests(scoredItems, (item) => item.recommendationFlags.driveMatch, 6, "upcoming_drive_prep");
    const branchCorePractice = selectRecommendedMockTests(scoredItems, (item) => item.trackCategory === "branch_core" && item.recommendationFlags.branchMatch, 8, "branch_core_practice");
    const retakeForImprovement = selectRecommendedMockTests(scoredItems, (item) => item.recommendationFlags.retryMatch, 6, "retake_for_improvement");
    const crossBranchPrep = selectRecommendedMockTests(
      scoredItems,
      (item) => item.trackCategory === "general" || item.trackCategory === "aptitude" || item.trackCategory === "verbal",
      10,
      "cross_branch_prep",
    );
    const stripFlags = (
      sectionItems: Array<RecommendedMockTestItem & {
        recommendationFlags: {
          weakTopicMatch: boolean;
          branchMatch: boolean;
          driveMatch: boolean;
          retryMatch: boolean;
        };
      }>,
    ) => sectionItems.map(({ recommendationFlags: _ignored, ...item }) => item);

    return {
      stats: {
        totalCatalog: items.length,
        hardSets: items.filter((item) => item.difficulty.toLowerCase() === "hard").length,
        companyFocused: items.filter((item) => Boolean(item.companyId)).length,
        avgAttempts: items.length > 0 ? Number((items.reduce((sum, item) => sum + (item.attemptCount ?? 0), 0) / items.length).toFixed(1)) : 0,
      },
      sections: {
        recommended: stripFlags(takeNext),
        companyFocused: stripFlags(selectRecommendedMockTests(scoredItems, (item) => Boolean(item.companyId), 6, "company_focused")),
        companyPrep: stripFlags(selectRecommendedMockTests(scoredItems, (item) => item.trackCategory === "company_prep", 8, "company_prep")),
        verbal: stripFlags(selectRecommendedMockTests(scoredItems, (item) => item.trackCategory === "verbal", 8, "verbal")),
        aptitude: stripFlags(selectRecommendedMockTests(scoredItems, (item) => item.trackCategory === "aptitude", 8, "aptitude")),
        branchCore: stripFlags(selectRecommendedMockTests(scoredItems, (item) => item.trackCategory === "branch_core", 10, "branch_core")),
        crossBranch: stripFlags(crossBranchPrep),
        takeNext: stripFlags(takeNext),
        weakTopicRecovery: stripFlags(weakTopicRecovery),
        upcomingDrivePrep: stripFlags(upcomingDrivePrep),
        branchCorePractice: stripFlags(branchCorePractice),
        crossBranchPrep: stripFlags(crossBranchPrep),
        retakeForImprovement: stripFlags(retakeForImprovement),
      },
      branchTrackLabel: branchTrack.label,
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
      }>;
      isActive: boolean;
    },
  ) {
    const created = await MockTestRepository.createTest(tenantId, createdBy, input);
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
      }>;
    },
  ) {
    return MockTestRepository.upsertQuestions(tenantId, testId, input.questions, input.append);
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

    const submitted = await MockTestRepository.submitAttempt({
      tenantId: input.tenantId,
      studentId: String(student.id),
      attemptId: input.attemptId,
      answers: answersWithOutcome,
      score,
      timeTakenSec,
      topicBreakdown,
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

    return {
      attemptId: String(attempt.id),
      testId: String(attempt.test_id),
      title: String(test.title),
      score: Number(attempt.score ?? 0),
      timeTakenSec: Number(attempt.time_taken_sec ?? 0),
      topicBreakdown: attempt.topic_breakdown ?? {},
      submittedAt: attempt.submitted_at ? String(attempt.submitted_at) : null,
      answers,
      questions: questions.map((question) => ({
        text: question.text,
        options: question.options,
        correctIndex: question.correctIndex,
        explanation: question.explanation ?? "",
      })),
    };
  },
};
