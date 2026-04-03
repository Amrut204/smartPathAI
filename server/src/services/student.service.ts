import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import pdfParse from "pdf-parse";

import { AppError } from "../middleware/error-handler.js";
import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";
import { StudentRepository } from "../repositories/student.repository.js";
import { getMongoDb } from "../utils/mongodb.js";
import { buildStudentProfileSummary, normalizeStudentProfileData } from "../utils/student-profile.js";
import {
  buildDeclarationProfileDataPatch,
  buildOnboardingWarningContent,
  buildProfileCertificationPreview,
  buildStudentDeclarationStatus,
  getMaterialProfileFieldChanges,
  getMaterialProfileFieldLabels,
  PROFILE_CERTIFICATION_TYPED_VALUE,
  STUDENT_DECLARATION_POLICY_VERSION,
} from "../utils/student-declaration.js";
import { DriveRepository, normalizeDriveLifecycle } from "../repositories/drive.repository.js";
import {
  BRANCH_PACK_DEFINITIONS,
  COMMON_PLACEMENT_KEYWORDS,
  COMPANY_PREP_KEYWORDS,
  INTERVIEW_PRACTICE_KEYWORDS,
  TARGET_ROLE_KEYWORDS,
} from "../config/branch-content.config.js";
import {
  buildProfileOptions,
  normalizeProfileDegree,
  normalizeProfileLocations,
  normalizeProfileTargetRoles,
} from "../config/profile-options.config.js";
import { PointsService } from "./points.service.js";
import { StudentActivityService } from "./student-activity.service.js";
import { evaluateStudentEligibility, ELIGIBILITY_REASON_LABELS } from "./eligibility.logic.js";
import { RiskAssessmentService } from "./risk-assessment.service.js";
import { GoogleDriveResumeService } from "./google-drive-resume.service.js";
import { getBranchPrepTrack, getCanonicalBranchCode, matchesBranchPrepTrackTag } from "../config/branch-prep.config.js";
import { AuditLogService } from "./audit-log.service.js";
import { MockTestService } from "./mock-test.service.js";
import { CommunicationService } from "./communication.service.js";

interface LogStudyHoursInput {
  tenantId: string;
  userId: string;
  topicId: string;
  studyDate?: string;
  hours: number;
}

type TpoVisibilityStatus = "good" | "attention" | "concern";

type TpoVisibilityRow = {
  key:
    | "profileStatus"
    | "profileCertified"
    | "readinessScore"
    | "riskCategory"
    | "mockTestsAttempted"
    | "studyHours7d"
    | "driveApplications"
    | "resourceEngagement";
  label: string;
  value: string;
  status: TpoVisibilityStatus;
};

type TopicProgressStatus = "incomplete" | "in_progress" | "complete";
type ProfileUnlockRequestStatus = "pending" | "approved" | "denied" | "resolved";
type ProfileUnlockReasonCategory = "academic_record" | "resume_update" | "certification_correction" | "contact_update" | "other";

function buildMyProfileResponse(profile: Awaited<ReturnType<typeof StudentRepository.getStudentProfile>>) {
  const summary = buildStudentProfileSummary({
    student: profile,
    user: {
      full_name: profile.full_name,
      email: profile.college_email,
    },
  });
  const declarationStatus = buildStudentDeclarationStatus({
    student: profile,
    user: {
      full_name: profile.full_name,
      email: profile.college_email,
    },
  });
  const profileCertificationPreview = buildProfileCertificationPreview({
    student: profile,
    user: {
      full_name: profile.full_name,
      email: profile.college_email,
    },
  });

  return {
    id: String(profile.id),
    tenant_id: String(profile.tenant_id),
    user_id: String(profile.user_id),
    seededProfile: summary.seededProfile,
    studentEditableProfile: summary.studentEditableProfile,
    profileCompleteness: summary.profileCompleteness,
    declarationStatus: {
      ...declarationStatus,
      profileCertification: {
        ...declarationStatus.profileCertification,
        isCompleteButUncertified: summary.profileCompleteness.isComplete && !declarationStatus.profileCertification.isCertified,
      },
    },
    profileCertificationPreview,
    sectionStates: summary.sectionStates,
    requiredFields: summary.requiredFields,
    missingRequiredFields: summary.missingRequiredFields,
    missingSeededFields: summary.missingSeededFields,
    missingStudentFields: summary.missingStudentFields,
    pendingCollegeFields: summary.pendingCollegeFields,
    recommendedFields: summary.recommendedFields,
    canAccessResources: summary.canAccessResources,
    canAccessMockTests: summary.canAccessMockTests,
    placementStatus: (() => {
      const profileData = profile.profile_data && typeof profile.profile_data === "object"
        ? profile.profile_data as Record<string, unknown>
        : {};
      const raw = profileData.placementStatus && typeof profileData.placementStatus === "object"
        ? profileData.placementStatus as Record<string, unknown>
        : {};
      return {
        isPlaced: raw.isPlaced === true,
        placedAt: raw.placedAt ? String(raw.placedAt) : null,
        placedCompany: raw.placedCompany ? String(raw.placedCompany) : null,
        placedRole: raw.placedRole ? String(raw.placedRole) : null,
        placedPackageLpa: raw.placedPackageLpa === undefined || raw.placedPackageLpa === null ? null : Number(raw.placedPackageLpa),
        sourceDriveId: raw.sourceDriveId ? String(raw.sourceDriveId) : null,
        correctionReason: raw.correctionReason ? String(raw.correctionReason) : null,
        correctedAt: raw.correctedAt ? String(raw.correctedAt) : null,
      };
    })(),
  };
}

function hasResumeOnProfile(profileData: ReturnType<typeof normalizeStudentProfileData>) {
  return Boolean(profileData.resumeDriveWebLink || profileData.resumeUrl);
}

function normalizeTenantBranches(config: unknown): string[] {
  if (!config || typeof config !== "object") return [];
  const raw = (config as { branches?: unknown }).branches;
  if (!Array.isArray(raw)) return [];
  return [...new Set(
    raw
      .map((value) => String(value ?? "").trim())
      .filter((value) => value.length >= 2),
  )];
}

function normalizeSemesterValue(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) return null;
  return parsed;
}

function buildProfileFieldTrust(base: ReturnType<typeof buildMyProfileResponse>) {
  const locked = Boolean(base.declarationStatus.profileCertification.isLocked);
  const seededKeys = new Set(base.requiredFields.filter((field) => field.owner === "seeded").map((field) => field.key));
  const keys = [
    "fullName",
    "collegeEmail",
    "prn",
    "rollNumber",
    "branch",
    "batch",
    "degree",
    "currentSemester",
    "cgpa",
    "activeBacklogs",
    "totalHistoricalBacklogs",
    "attendancePct",
    "phone",
    "personalEmail",
    "resumeUrl",
    "targetRoles",
    "preferredLocations",
    "willingToRelocate",
  ] as const;

  return Object.fromEntries(keys.map((key) => [
    key,
    seededKeys.has(key)
      ? { source: "college_verified", label: "College-verified", locked }
      : { source: "student_provided", label: locked ? "Locked after certification" : "Student-provided", locked },
  ]));
}

const PROFILE_FIELD_HELP: Record<string, string> = {
  branch: "Used for branch-first resources and mock recommendations.",
  cgpa: "Used for drive eligibility checks.",
  activeBacklogs: "Used for drive eligibility checks.",
  totalHistoricalBacklogs: "Used for drive eligibility checks.",
  attendancePct: "Used for drive eligibility checks.",
  resumeUrl: "Used in drive applications and resume exports.",
  targetRoles: "Used to recommend resources and mock tests.",
};

function buildProfileReadinessBanner(base: ReturnType<typeof buildMyProfileResponse>) {
  const profile = base.studentEditableProfile;
  const certification = base.declarationStatus.profileCertification;
  const hasResume = Boolean(profile.resumeDriveWebLink || profile.resumeUrl);

  if (certification.isLocked) {
    return {
      tone: "attention",
      title: "Profile locked after certification",
      message: "Your certified profile is read-only until the placement office approves an unlock request.",
      action: "Request unlock",
    };
  }

  if (certification.requiresRecertification) {
    return {
      tone: "warning",
      title: "Needs recertification after changes",
      message: "Review your updated profile and certify it again before using drive applications.",
      action: "Review and certify",
    };
  }

  if (!base.profileCompleteness.isComplete || !certification.isCertified) {
    return {
      tone: "warning",
      title: "Declaration incomplete",
      message: "Complete the required fields and certify your profile to stay drive-ready.",
      action: "Complete profile",
    };
  }

  if (!hasResume) {
    return {
      tone: "warning",
      title: "Resume missing",
      message: "Upload a resume before applying to drives or exporting profile-ready application data.",
      action: "Upload resume",
    };
  }

  return {
    tone: "success",
    title: "Ready for most drives",
    message: "Your profile, certification, and resume are in place for current drive workflows.",
    action: "View drives",
  };
}

function groupEligibilityBlockers(reasons: string[]) {
  const grouped = new Map<string, number>();
  reasons.forEach((reason) => grouped.set(reason, (grouped.get(reason) ?? 0) + 1));
  return [...grouped.entries()].map(([code, count]) => ({
    code,
    count,
    label: ELIGIBILITY_REASON_LABELS[code as keyof typeof ELIGIBILITY_REASON_LABELS] ?? code,
  }));
}

function getTenantPlacementPolicy(config: unknown) {
  const tenantConfig = config && typeof config === "object"
    ? config as Record<string, unknown>
    : {};
  const placementPolicy = tenantConfig.placementPolicy && typeof tenantConfig.placementPolicy === "object"
    ? tenantConfig.placementPolicy as Record<string, unknown>
    : {};

  return {
    excludePlacedStudentsByDefault: placementPolicy.excludePlacedStudentsByDefault === true,
  };
}

async function evaluateEligibilityWithPlacementPolicy(params: {
  tenantId: string;
  criteria: {
    minCgpa?: number;
    maxBacklogs?: number;
    maxActiveBacklogs?: number;
    maxTotalBacklogs?: number;
    branches?: string[];
    minAttendance?: number;
    excludePlacedStudents?: boolean;
  };
  student: {
    cgpa: number;
    activeBacklogs: number;
    totalBacklogs: number;
    branch: string;
    attendancePct: number;
  };
  isPlaced: boolean;
}) {
  const tenant = await MongoAuthRepository.findTenantById(params.tenantId);
  const placementPolicy = getTenantPlacementPolicy(tenant?.config);
  const effectiveExcludePlacedStudents = placementPolicy.excludePlacedStudentsByDefault || params.criteria.excludePlacedStudents === true;
  const evaluation = evaluateStudentEligibility(params.student, params.criteria);

  if (!effectiveExcludePlacedStudents || !params.isPlaced) {
    return {
      ...evaluation,
      effectiveExcludePlacedStudents,
    };
  }

  const reasons = evaluation.reasons.includes("already_placed")
    ? evaluation.reasons
    : ["already_placed", ...evaluation.reasons];

  return {
    eligible: false,
    reasons,
    effectiveExcludePlacedStudents,
  };
}

async function getLatestProfileUnlockRequest(tenantId: string, studentId: string) {
  const db = await getMongoDb();
  const request = await db.collection("profile_unlock_requests").findOne(
    { tenant_id: tenantId, student_id: studentId },
    { projection: { _id: 0 }, sort: { created_at: -1 } },
  );

  if (!request) return null;

  return {
    id: String(request.id),
    status: String(request.status ?? "pending") as ProfileUnlockRequestStatus,
    reasonCategory: String(request.reason_category ?? "other") as ProfileUnlockReasonCategory,
    requestedFields: Array.isArray(request.requested_fields) ? request.requested_fields.map((value) => String(value)) : [],
    explanation: String(request.explanation ?? ""),
    responseNote: request.response_note ? String(request.response_note) : "",
    createdAt: String(request.created_at ?? ""),
    decidedAt: request.decided_at ? String(request.decided_at) : null,
    decidedBy: request.decided_by ? String(request.decided_by) : null,
    resolvedAt: request.resolved_at ? String(request.resolved_at) : null,
  };
}

async function resolveApprovedUnlockRequests(params: {
  tenantId: string;
  studentId: string;
  actorUserId: string;
  note: string;
}) {
  const db = await getMongoDb();
  const now = new Date().toISOString();
  await db.collection("profile_unlock_requests").updateMany(
    {
      tenant_id: params.tenantId,
      student_id: params.studentId,
      status: "approved",
      resolved_at: null,
    },
    {
      $set: {
        status: "resolved",
        resolved_at: now,
        response_note: params.note,
        updated_at: now,
      },
    },
  );
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(value.trim());
      value = "";
      continue;
    }

    value += char;
  }

  cells.push(value.trim());
  return cells;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

type YouTubeSuggestion = {
  title: string;
  url: string;
  thumbnailUrl: string;
  channelName: string;
};

type StudentResourceItem = Awaited<ReturnType<typeof StudentRepository.getResources>>[number];
type ResourceListFilter = "all" | "pdf" | "notes" | "guide" | "notebook" | "external";
type RecommendedResourceItem = StudentResourceItem & {
  recommendationScore: number;
  recommendationReasons: string[];
  recommendationBucket?: string;
  lastViewedAt?: string | null;
  progressPct?: number | null;
};

type RecommendedResourceFlags = {
  weakTopicMatch: boolean;
  branchMatch: boolean;
  upcomingDriveMatch: boolean;
  continueLearningMatch: boolean;
};

type ScoredRecommendedResourceItem = RecommendedResourceItem & {
  recommendationFlags: RecommendedResourceFlags;
};

type ResourceRecommendationPack = {
  id: string;
  title: string;
  description: string;
  items: RecommendedResourceItem[];
};

function normalizeRecommendationText(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function buildRecommendationHaystack(parts: Array<unknown>) {
  return normalizeRecommendationText(parts.filter(Boolean).join(" "));
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function matchesResourceFilterForRecommendation(resource: StudentResourceItem, filter: ResourceListFilter) {
  const type = normalizeRecommendationText(resource.resourceType);
  if (filter === "all") return true;
  if (filter === "pdf") return type === "pdf";
  if (filter === "notes") return type === "text" || type === "notes" || type === "document";
  if (filter === "guide") return type === "markdown";
  if (filter === "notebook") return type === "notebook";
  if (filter === "external") return type === "external_link" || resource.sourceMode === "external";
  return true;
}

function estimateResourceQuality(resource: StudentResourceItem) {
  const studyDocument = resource.studyDocument;
  const resourceSearchMetadata = resource as StudentResourceItem & {
    keyTopics?: string[];
    summaryShort?: string;
  };
  let score = 0;

  if (studyDocument?.whatThisCovers) score += 4;
  if ((studyDocument?.keyConcepts?.length ?? 0) > 0) score += 4;
  if ((studyDocument?.interviewFocus?.length ?? 0) > 0) score += 3;
  if ((studyDocument?.stepByStepUnderstanding?.length ?? 0) > 0) score += 3;
  if ((studyDocument?.practicePrompts?.length ?? 0) > 0) score += 2;
  if ((studyDocument?.importantDefinitions?.length ?? 0) > 0) score += 2;
  if ((resourceSearchMetadata.keyTopics?.length ?? 0) > 0) score += 2;
  if (resourceSearchMetadata.summaryShort) score += 2;
  if (resource.thumbnailUrl) score += 1;
  if (resource.resourceType === "pdf") score += 1;
  if (resource.onePageTriageBucket === "review") score -= 2;
  if (resource.onePageTriageBucket === "hide") score -= 6;

  return score;
}

function buildDifficultyFit(readinessScore: number, difficulty: string): "stretch" | "fit" | "easy" {
  const normalizedDifficulty = normalizeRecommendationText(difficulty);
  if (readinessScore < 40) {
    if (normalizedDifficulty === "easy") return "fit";
    if (normalizedDifficulty === "medium") return "stretch";
    return "stretch";
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

const YOUTUBE_CACHE_TTL_MS = 15 * 60 * 1000;
const youtubeSuggestionCache = new Map<string, { expiresAt: number; items: YouTubeSuggestion[] }>();
const PDF_TEXT_CACHE_TTL_MS = 30 * 60 * 1000;
const pdfTextCache = new Map<string, { expiresAt: number; text: string }>();
const PDF_TEXT_PARSE_MAX_PAGES = 8;
const SEARCH_STOP_WORDS = new Set([
  "and",
  "the",
  "for",
  "from",
  "into",
  "with",
  "what",
  "where",
  "when",
  "why",
  "how",
  "are",
  "is",
  "was",
  "were",
  "this",
  "that",
  "these",
  "those",
  "your",
  "our",
  "you",
  "can",
  "will",
  "have",
  "has",
  "had",
]);
const SEARCH_REFERENCE_MAP: Record<string, string[]> = {
  profit: ["loss", "gain", "cp", "sp", "cost price", "selling price", "discount", "marked price", "markup"],
  loss: ["profit", "cp", "sp", "cost price", "selling price", "discount"],
  percentage: ["percent", "ratio", "proportion"],
  ratio: ["proportion", "percentage"],
  aptitude: ["quant", "reasoning", "verbal", "logical"],
  dsa: ["array", "string", "linked list", "tree", "graph", "dp", "algorithm"],
  sql: ["database", "dbms", "query", "joins", "normalization"],
  dbms: ["database", "sql", "normalization", "transaction"],
  os: ["operating system", "scheduling", "deadlock", "paging", "memory management"],
  networking: ["computer networks", "tcp", "udp", "osi", "routing"],
  oops: ["oop", "object oriented", "inheritance", "polymorphism", "abstraction", "encapsulation"],
  interview: ["hr", "behavioral", "star method", "resume"],
};

function resolveMaterialRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), "../material"),
    path.resolve(process.cwd(), "material"),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found ?? candidates[0];
}

const materialRoot = resolveMaterialRoot();

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenizeQuery(query: string): string[] {
  return [...new Set(
    normalizeSearchText(query)
      .split(/[^a-z0-9]+/i)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3 && !SEARCH_STOP_WORDS.has(term)),
  )];
}

function expandSearchTerms(query: string, relatedTopicNames: string[] = []): string[] {
  const normalizedQuery = normalizeSearchText(query);
  const baseTerms = tokenizeQuery(normalizedQuery);
  const terms = new Set<string>(baseTerms);

  const phraseCandidates = [normalizedQuery, ...relatedTopicNames.map((value) => normalizeSearchText(value))];
  phraseCandidates.forEach((phrase) => {
    if (phrase.length >= 3) terms.add(phrase);
  });

  Object.entries(SEARCH_REFERENCE_MAP).forEach(([key, values]) => {
    const keyNormalized = normalizeSearchText(key);
    if (
      normalizedQuery.includes(keyNormalized) ||
      baseTerms.includes(keyNormalized) ||
      relatedTopicNames.some((name) => normalizeSearchText(name).includes(keyNormalized))
    ) {
      values.forEach((value) => terms.add(normalizeSearchText(value)));
    }
  });

  return [...terms].filter((term) => term.length >= 2);
}

function listTextInDirectory(dirPath: string, extensions: string[]): string[] {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return [];
  const lowerExt = new Set(extensions.map((ext) => ext.toLowerCase()));
  return fs
    .readdirSync(dirPath)
    .filter((name) => lowerExt.has(path.extname(name).toLowerCase()))
    .map((name) => path.join(dirPath, name));
}

function deriveSourcePdf(resource: Record<string, unknown>): string {
  const explicit = String(resource.sourcePdf ?? "").trim();
  if (explicit) {
    return explicit.replace(/\\/g, "/");
  }

  const normalizedUrl = String(resource.url ?? "").trim().replace(/\\/g, "/");
  const marker = "material/";
  const index = normalizedUrl.toLowerCase().indexOf(marker);
  if (index >= 0) {
    return normalizedUrl.slice(index + marker.length);
  }

  return "";
}

function deriveIndexedSearchText(resource: Record<string, unknown>): string {
  const direct = String(resource.searchText ?? "").trim();
  if (direct) return normalizeSearchText(direct);

  const summary = String(resource.summaryShort ?? "").trim();
  const keywords = Array.isArray(resource.keywords) ? resource.keywords.map((value) => String(value)) : [];
  const topics = Array.isArray(resource.keyTopics) ? resource.keyTopics.map((value) => String(value)) : [];
  const combined = [summary, ...topics, ...keywords].filter(Boolean).join(" ");
  return normalizeSearchText(combined);
}

function resolveTextCandidates(materialRoot: string, sourcePdf: string): string[] {
  if (!sourcePdf) return [];

  const absPdf = path.join(materialRoot, sourcePdf);
  const pdfDir = path.dirname(absPdf);
  const baseNoExt = path.basename(absPdf, path.extname(absPdf));
  const directTxt = path.join(pdfDir, `${baseNoExt}.txt`);
  const directMd = path.join(pdfDir, `${baseNoExt}.md`);

  const candidates = [] as string[];
  if (fs.existsSync(directTxt)) {
    candidates.push(directTxt);
  }
  if (fs.existsSync(directMd)) {
    candidates.push(directMd);
  }

  if (candidates.length === 0) {
    const stem = baseNoExt.toLowerCase().replace(/[^a-z0-9]/g, "");
    const fuzzy = listTextInDirectory(pdfDir, [".txt", ".md"]).filter((filePath) => {
      const fileStem = path.basename(filePath, path.extname(filePath)).toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!stem || !fileStem) return false;
      return fileStem.includes(stem.slice(0, 8)) || stem.includes(fileStem.slice(0, 8));
    });
    candidates.push(...fuzzy);
  }

  if (candidates.length === 0) {
    const testsDir = path.join(pdfDir, "TESTS");
    candidates.push(...listTextInDirectory(testsDir, [".txt", ".md"]));
  }

  if (candidates.length === 0) {
    const parentReadmes = [
      path.join(pdfDir, "README.md"),
      path.join(pdfDir, "readme.md"),
      path.join(pdfDir, "README.txt"),
    ];
    parentReadmes.forEach((candidate) => {
      if (fs.existsSync(candidate)) candidates.push(candidate);
    });
  }

  return [...new Set(candidates)].slice(0, 4);
}

async function extractPdfTextFallback(sourcePdf: string): Promise<string> {
  try {
    const absolutePath = path.join(materialRoot, sourcePdf);
    if (!fs.existsSync(absolutePath)) return "";
    const buffer = fs.readFileSync(absolutePath);
    const parsed = await pdfParse(buffer, { max: PDF_TEXT_PARSE_MAX_PAGES });
    return normalizeSearchText(String(parsed.text ?? "")).slice(0, 220_000);
  } catch {
    return "";
  }
}

async function loadSearchTextForPdf(sourcePdf: string): Promise<string> {
  if (!sourcePdf) return "";

  const key = sourcePdf.toLowerCase();
  const cached = pdfTextCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.text;
  }

  try {
    const candidates = resolveTextCandidates(materialRoot, sourcePdf);
    let text = "";

    if (candidates.length > 0) {
      const combined = candidates
        .map((txtPath) => fs.readFileSync(txtPath, "utf8"))
        .join("\n");
      text = normalizeSearchText(combined).slice(0, 300_000);
    } else {
      text = await extractPdfTextFallback(sourcePdf);
    }

    pdfTextCache.set(key, { text, expiresAt: Date.now() + PDF_TEXT_CACHE_TTL_MS });
    return text;
  } catch {
    pdfTextCache.set(key, { text: "", expiresAt: Date.now() + PDF_TEXT_CACHE_TTL_MS });
    return "";
  }
}

async function loadSearchCorpus(resource: Record<string, unknown>): Promise<string> {
  const indexed = deriveIndexedSearchText(resource);
  if (indexed) {
    return indexed;
  }

  const sourcePdf = deriveSourcePdf(resource);
  if (!sourcePdf) return "";
  return loadSearchTextForPdf(sourcePdf);
}

function countOccurrences(text: string, value: string, maxCount = 6): number {
  if (!text || !value) return 0;
  let count = 0;
  let start = 0;
  while (count < maxCount) {
    const index = text.indexOf(value, start);
    if (index < 0) break;
    count += 1;
    start = index + value.length;
  }
  return count;
}

function scoreContentMatch(text: string, query: string, terms: string[]): number {
  if (!text) return 0;
  let score = 0;
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery) {
    score += countOccurrences(text, normalizedQuery, 2) * 18;
  }
  for (const term of terms) {
    score += countOccurrences(text, term, 5) * 5;
  }
  return score;
}

function buildSnippet(text: string, query: string, terms: string[]): string {
  if (!text) return "";
  const normalizedQuery = normalizeSearchText(query);
  let idx = normalizedQuery ? text.indexOf(normalizedQuery) : -1;
  if (idx < 0) {
    for (const term of terms) {
      idx = text.indexOf(term);
      if (idx >= 0) break;
    }
  }
  if (idx < 0) {
    return "";
  }

  const start = Math.max(0, idx - 70);
  const end = Math.min(text.length, idx + normalizedQuery.length + 90);
  return text.slice(start, end).trim();
}

async function rankResourcesByPdfContent(
  resources: Array<Record<string, unknown>>,
  query: string,
  relatedTopics: string[] = [],
): Promise<Array<Record<string, unknown>>> {
  const normalizedQuery = normalizeSearchText(query);
  const terms = expandSearchTerms(query, relatedTopics);
  const baseTerms = tokenizeQuery(query);
  const anchorTerms = baseTerms.filter((term) => term.length >= 4);
  if (!normalizedQuery || resources.length === 0) return resources;

  const scored = await Promise.all(resources.map(async (resource, index) => {
    const title = normalizeSearchText(String(resource.title ?? ""));
    const description = normalizeSearchText(String(resource.description ?? ""));
    const sourcePdf = deriveSourcePdf(resource);
    const sourcePath = normalizeSearchText(sourcePdf);
    const urlPath = normalizeSearchText(String(resource.url ?? ""));
    const resourceType = normalizeSearchText(String(resource.resourceType ?? ""));
    const referenceCorpus = `${title} ${description} ${sourcePath} ${urlPath}`.trim();
    const text = await loadSearchCorpus(resource);
    const contentScore = scoreContentMatch(text, query, terms);

    let score = 0;
    if (title.includes(normalizedQuery)) score += 28;
    if (description.includes(normalizedQuery)) score += 15;
    if (sourcePath.includes(normalizedQuery)) score += 26;
    if (urlPath.includes(normalizedQuery)) score += 10;

    if (resourceType === "pdf") score += 7;

    terms.forEach((term) => {
      score += countOccurrences(title, term, 4) * 8;
      score += countOccurrences(description, term, 4) * 5;
      score += countOccurrences(sourcePath, term, 4) * 7;
      score += countOccurrences(urlPath, term, 3) * 3;
      score += countOccurrences(referenceCorpus, term, 3) * 2;
    });
    score += contentScore;

    const anchorMetadataMatched = anchorTerms.some((term) => referenceCorpus.includes(term));
    const anchorContentMatched = anchorTerms.some((term) => text.includes(term));
    if (anchorMetadataMatched) score += 18;
    if (anchorContentMatched) score += 10;
    if (anchorTerms.length > 0 && !anchorMetadataMatched && !anchorContentMatched) {
      score = Math.floor(score * 0.25);
    }

    const referenceMatched = terms.some((term) => term.length >= 3 && !baseTerms.includes(term) && (
      referenceCorpus.includes(term) || text.includes(term)
    ));

    return {
      resource,
      index,
      score,
      contentMatched: contentScore > 0,
      referenceMatched,
      snippet: contentScore > 0 ? buildSnippet(text, query, terms) : "",
    };
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  return scored.map((item) => ({
    ...item.resource,
    relevanceScore: item.score,
    matchSource: item.contentMatched ? "pdf_content" : (item.referenceMatched ? "reference" : "metadata"),
    matchSnippet: item.snippet || null,
  }));
}

function fallbackYouTubeSuggestions(query: string): YouTubeSuggestion[] {
  const encoded = encodeURIComponent(`${query} placement preparation`);
  return [
    {
      title: `${query} - Placement preparation videos`,
      url: `https://www.youtube.com/results?search_query=${encoded}`,
      thumbnailUrl: `https://placehold.co/480x270/0f172a/ffffff?text=${encodeURIComponent("YouTube Search")}`,
      channelName: "YouTube",
    },
  ];
}

async function fetchYouTubeSuggestions(query: string): Promise<YouTubeSuggestion[]> {
  const key = query.trim().toLowerCase();
  if (!key) return [];

  const cached = youtubeSuggestionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items;
  }

  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${query} placement preparation`)}`;
    const searchResponse = await fetch(searchUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
    });

    if (!searchResponse.ok) {
      const fallback = fallbackYouTubeSuggestions(query);
      youtubeSuggestionCache.set(key, { expiresAt: Date.now() + YOUTUBE_CACHE_TTL_MS, items: fallback });
      return fallback;
    }

    const html = await searchResponse.text();
    const ids = [...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)]
      .map((match) => match[1])
      .filter((id, index, array) => array.indexOf(id) === index)
      .slice(0, 8);

    const metadata = await Promise.allSettled(ids.slice(0, 5).map(async (id) => {
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`;
      const response = await fetch(oembedUrl);
      if (!response.ok) {
        return {
          title: `YouTube Video ${id}`,
          author_name: "YouTube",
          thumbnail_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        };
      }
      return response.json() as Promise<{ title?: string; author_name?: string; thumbnail_url?: string }>;
    }));

    const items = metadata
      .map((item, index) => {
        if (item.status === "rejected") return null;
        const id = ids[index];
        const value = item.value;
        return {
          title: String(value.title ?? `YouTube Video ${index + 1}`),
          url: `https://www.youtube.com/watch?v=${id}`,
          thumbnailUrl: String(value.thumbnail_url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`),
          channelName: String(value.author_name ?? "YouTube"),
        } satisfies YouTubeSuggestion;
      })
      .filter((item): item is YouTubeSuggestion => item !== null);

    const finalItems = items.length > 0 ? items : fallbackYouTubeSuggestions(query);
    youtubeSuggestionCache.set(key, { expiresAt: Date.now() + YOUTUBE_CACHE_TTL_MS, items: finalItems });
    return finalItems;
  } catch {
    const fallback = fallbackYouTubeSuggestions(query);
    youtubeSuggestionCache.set(key, { expiresAt: Date.now() + YOUTUBE_CACHE_TTL_MS, items: fallback });
    return fallback;
  }
}

function scoreRecommendedResource(
  resource: StudentResourceItem,
  context: {
    branch: string;
    branchTrackLabel: string;
    branchFocusAreas: Array<{ topicId: string | null; topicName: string; reason: string }>;
    weakAreas: Array<{ topicId: string; topicName: string; masteryLevel: number }>;
    upcomingDrives: Array<{ company: string; role: string; driveDate: string; status: string }>;
    targetRoles: string[];
    recentResources: Array<{ resourceId: string; title: string; viewedAt: string; resourceType: string; progressPct: number | null }>;
  },
  popularityMap: Map<string, number>,
) {
  const resourceSearchMetadata = resource as StudentResourceItem & {
    summaryShort?: string;
  };
  const haystack = buildRecommendationHaystack([
    resource.title,
    resource.description,
    resourceSearchMetadata.summaryShort,
    resource.studyDocument?.whatThisCovers,
    resource.studyDocument?.topic,
    resource.studyDocument?.subtopic,
    ...(resource.studyDocument?.keyConcepts ?? []),
    ...(resource.studyDocument?.interviewFocus ?? []),
    ...(resource.studyDocument?.recommendedFor ?? []),
    ...(resource.studyDocument?.careerTracks ?? []),
    ...(resource.studyDocument?.branchRelevance ?? []),
  ]);
  const reasons: string[] = [];
  let score = 0;
  let weakTopicMatch = false;
  let branchMatch = false;
  let upcomingDriveMatch = false;
  let continueLearningMatch = false;

  const explicitBranchMatch = (resource.studyDocument?.branchRelevance ?? [])
    .some((value) => normalizeRecommendationText(value).includes(normalizeRecommendationText(context.branchTrackLabel)));
  if (explicitBranchMatch) {
    score += 16;
    branchMatch = true;
    reasons.push(`Matches your ${context.branchTrackLabel} branch track.`);
  }

  for (const focusArea of context.branchFocusAreas) {
    const topicName = normalizeRecommendationText(focusArea.topicName);
    if (!topicName) continue;
    if (resource.topicId && focusArea.topicId && resource.topicId === focusArea.topicId) {
      score += 14;
      branchMatch = true;
      reasons.push(`Supports ${focusArea.topicName}, which is important for your branch.`);
      break;
    }
    if (haystack.includes(topicName)) {
      score += 12;
      branchMatch = true;
      reasons.push(`Aligns with your branch focus area: ${focusArea.topicName}.`);
      break;
    }
  }

  for (const weakArea of context.weakAreas) {
    const weakTopicName = normalizeRecommendationText(weakArea.topicName);
    if (resource.topicId && resource.topicId === weakArea.topicId) {
      score += 26;
      weakTopicMatch = true;
      reasons.push(`Targets a weak topic for you: ${weakArea.topicName}.`);
      break;
    }
    if (weakTopicName && haystack.includes(weakTopicName)) {
      score += 22;
      weakTopicMatch = true;
      reasons.push(`Helps strengthen ${weakArea.topicName}, where you need more practice.`);
      break;
    }
  }

  for (const drive of context.upcomingDrives) {
    const company = normalizeRecommendationText(drive.company);
    const role = normalizeRecommendationText(drive.role);
    if ((company && haystack.includes(company)) || (role && haystack.includes(role))) {
      score += 24;
      upcomingDriveMatch = true;
      reasons.push(`Useful for your upcoming ${drive.company} drive.`);
      break;
    }
  }

  for (const targetRole of context.targetRoles) {
    const normalizedRole = normalizeRecommendationText(targetRole);
    if (normalizedRole && haystack.includes(normalizedRole)) {
      score += 11;
      reasons.push(`Matches your target role: ${targetRole}.`);
      break;
    }
  }

  const recentItem = context.recentResources.find((item) => item.resourceId === resource.id);
  if (recentItem) {
    if ((recentItem.progressPct ?? 0) > 0 && (recentItem.progressPct ?? 0) < 100) {
      score += 18;
      continueLearningMatch = true;
      reasons.push("Continue from where you left off.");
    } else {
      score -= 8;
      reasons.push("You opened this recently, so it is deprioritized for fresh practice.");
    }
  }

  const qualityScore = estimateResourceQuality(resource);
  score += qualityScore;
  if (qualityScore >= 8) {
    reasons.push("High-quality study guide with strong coverage.");
  }

  const popularity = popularityMap.get(resource.id) ?? 0;
  if (popularity >= 12) {
    score += 6;
    reasons.push("Frequently opened by students in recent preparation.");
  } else if (popularity >= 4) {
    score += 3;
  }

  if (resource.sourceMode === "external") {
    score -= 2;
  }

  return {
    ...resource,
    recommendationScore: score,
    recommendationReasons: uniqueById(
      reasons.map((reason, index) => ({ id: `${resource.id}-${index}-${reason}`, value: reason })),
    ).map((item) => item.value).slice(0, 3),
    lastViewedAt: recentItem?.viewedAt ?? null,
    progressPct: recentItem?.progressPct ?? null,
    recommendationFlags: {
      weakTopicMatch,
      branchMatch,
      upcomingDriveMatch,
      continueLearningMatch,
    },
  };
}

function formatCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getReadinessStatus(readinessScore: number): TpoVisibilityStatus {
  if (readinessScore >= 75) return "good";
  if (readinessScore >= 55) return "attention";
  return "concern";
}

function getRiskStatus(category: string | null | undefined): TpoVisibilityStatus {
  if (category === "LOW_RISK") return "good";
  if (category === "MEDIUM_RISK") return "attention";
  return "concern";
}

async function buildTpoVisibilitySummary(profile: Awaited<ReturnType<typeof StudentRepository.getStudentProfile>>) {
  const tenantId = String(profile.tenant_id);
  const userId = String(profile.user_id);
  const studentId = String(profile.id);
  const db = await getMongoDb();
  const now = new Date();
  const start7Date = new Date(now);
  start7Date.setUTCDate(start7Date.getUTCDate() - 7);
  const start7Iso = start7Date.toISOString();

  const profileResponse = buildMyProfileResponse(profile);
  const [dashboard, riskScore, totalMockAttempts, driveApplications] = await Promise.all([
    StudentRepository.getDashboardData(tenantId, studentId),
    RiskAssessmentService.getStudentRiskScore(tenantId, userId).catch(() => null),
    db.collection("student_attempts").countDocuments({
      tenant_id: tenantId,
      student_id: studentId,
      status: "submitted",
    }),
    db.collection("drive_results").countDocuments({
      tenant_id: tenantId,
      student_id: studentId,
      status: { $in: ["applied"] },
    }),
  ]);

  const profileStatusValue = profileResponse.profileCompleteness.isComplete
    ? "Complete"
    : `${Number(profileResponse.profileCompleteness.pct ?? 0).toFixed(0)}% complete`;
  const profileStatus: TpoVisibilityRow = {
    key: "profileStatus",
    label: "Profile status",
    value: profileStatusValue,
    status: profileResponse.profileCompleteness.isComplete ? "good" : "concern",
  };

  const profileCertified: TpoVisibilityRow = {
    key: "profileCertified",
    label: "Profile certified",
    value: profileResponse.declarationStatus.profileCertification.isCertified ? "Certified" : "Not certified yet",
    status: profileResponse.declarationStatus.profileCertification.isCertified ? "good" : "concern",
  };

  const readinessScore = Number(dashboard.readinessScore ?? profile.readiness_score ?? 0);
  const readiness: TpoVisibilityRow = {
    key: "readinessScore",
    label: "Readiness",
    value: `${readinessScore.toFixed(1)}%`,
    status: getReadinessStatus(readinessScore),
  };

  const riskCategoryValue = riskScore?.category === "LOW_RISK"
    ? "Low risk"
    : riskScore?.category === "MEDIUM_RISK"
      ? "Medium risk"
      : riskScore?.category === "HIGH_RISK"
        ? "High risk"
        : "Not available yet";
  const riskCategory: TpoVisibilityRow = {
    key: "riskCategory",
    label: "Risk category",
    value: riskCategoryValue,
    status: riskScore ? getRiskStatus(riskScore.category) : "attention",
  };

  const mockTestsAttempted: TpoVisibilityRow = {
    key: "mockTestsAttempted",
    label: "Mock test participation",
    value: formatCountLabel(totalMockAttempts, "attempt"),
    status: totalMockAttempts >= 5 ? "good" : totalMockAttempts > 0 ? "attention" : "concern",
  };

  const studyHours7d = Number(dashboard.studyHoursWeek ?? 0);
  const studyActivity: TpoVisibilityRow = {
    key: "studyHours7d",
    label: "Study activity this week",
    value: `${studyHours7d.toFixed(1)} hour${studyHours7d === 1 ? "" : "s"}`,
    status: studyHours7d >= 3 ? "good" : studyHours7d > 0 ? "attention" : "concern",
  };

  const driveApplicationsRow: TpoVisibilityRow = {
    key: "driveApplications",
    label: "Drive applications",
    value: formatCountLabel(driveApplications, "application"),
    status: driveApplications > 0 ? "good" : "attention",
  };

  const activeDays7d = Number(dashboard.resourceUsage?.activeDays7d ?? 0);
  const resourceEngagement: TpoVisibilityRow = {
    key: "resourceEngagement",
    label: "Resource engagement",
    value: activeDays7d > 0
      ? `Active this week (${formatCountLabel(activeDays7d, "day")})`
      : "No recent activity",
    status: activeDays7d > 0 ? "good" : "attention",
  };

  return {
    title: "Shared with your TPO",
    description: "This summary shows the placement-readiness signals your placement office can review in Smart Path.",
    rows: [
      profileStatus,
      profileCertified,
      readiness,
      riskCategory,
      mockTestsAttempted,
      studyActivity,
      driveApplicationsRow,
      resourceEngagement,
    ],
    fields: {
      profileStatus,
      profileCertified,
      readinessScore: readiness,
      riskCategory,
      mockTestsAttempted,
      studyHours7d: studyActivity,
      driveApplications: driveApplicationsRow,
      resourceEngagement7d: activeDays7d,
      resourceEngagementLabel: resourceEngagement.value,
      tpoVisibilityNote:
        "Your TPO sees summary progress signals in Smart Path. Individual mock answers and detailed page-by-page browsing are not visible to your TPO.",
    },
    note:
      "Your TPO sees summary progress signals in Smart Path. Individual mock answers and detailed page-by-page browsing are not visible to your TPO.",
    generatedAt: now.toISOString(),
    windowStartedAt: start7Iso,
  };
}

async function buildProfileExperience(profile: Awaited<ReturnType<typeof StudentRepository.getStudentProfile>>) {
  const base = buildMyProfileResponse(profile);
  const tenantId = String(profile.tenant_id);
  const studentId = String(profile.id);
  const todayIso = new Date().toISOString().slice(0, 10);
  const db = await getMongoDb();
  const tenant = await MongoAuthRepository.findTenantById(tenantId);
  const tenantBranches = normalizeTenantBranches(tenant?.config);
  const currentDegree = base.studentEditableProfile.degree;
  const currentProfile = normalizeStudentProfileData(profile.profile_data);
  const hasResume = hasResumeOnProfile(currentProfile);

  const [resumeUsageCount, upcomingDrives, unlockRequest] = await Promise.all([
    db.collection("drive_results").countDocuments({
      tenant_id: tenantId,
      student_id: studentId,
      $or: [
        { resume_drive_file_id_at_application: { $type: "string" } },
        { resume_drive_web_link_at_application: { $type: "string" } },
      ],
    }),
    db.collection("drives").find(
      { tenant_id: tenantId, deleted_at: null, drive_date: { $gte: todayIso }, status: "published" },
      { projection: { _id: 0, id: 1, company: 1, role: 1, drive_date: 1, criteria: 1, status: 1 } },
    ).sort({ drive_date: 1 }).limit(12).toArray(),
    getLatestProfileUnlockRequest(tenantId, studentId),
  ]);

  const actualEligibilityReasons: string[] = [];
  const blockerCounts = new Map<string, number>();
  let readyDriveCount = 0;
  let criteriaEligibleCount = 0;
  let completionUnlockCount = 0;
  let certificationUnlockCount = 0;
  let resumeUnlockCount = 0;

  for (const drive of upcomingDrives) {
    const evaluation = await evaluateEligibilityWithPlacementPolicy({
      tenantId,
      student: {
        cgpa: Number(profile.cgpa ?? 0),
        activeBacklogs: Number(profile.backlogs ?? 0),
        totalBacklogs: Number((profile as unknown as { backlogs_total?: unknown }).backlogs_total ?? 0),
        branch: String(profile.branch ?? ""),
        attendancePct: Number(profile.attendance_pct ?? 0),
      },
      criteria: (drive.criteria ?? {}) as {
        minCgpa?: number;
        maxBacklogs?: number;
        maxActiveBacklogs?: number;
        maxTotalBacklogs?: number;
        branches?: string[];
        minAttendance?: number;
        excludePlacedStudents?: boolean;
      },
      isPlaced: base.placementStatus.isPlaced,
    });

    if (!evaluation.eligible) {
      evaluation.reasons.forEach((reason) => {
        blockerCounts.set(reason, (blockerCounts.get(reason) ?? 0) + 1);
        actualEligibilityReasons.push(reason);
      });
      continue;
    }

    criteriaEligibleCount += 1;
    if (!base.profileCompleteness.isComplete) {
      completionUnlockCount += 1;
      blockerCounts.set("profile_incomplete", (blockerCounts.get("profile_incomplete") ?? 0) + 1);
      continue;
    }
    if (!base.declarationStatus.profileCertification.isCertified) {
      certificationUnlockCount += 1;
      blockerCounts.set("profile_certification", (blockerCounts.get("profile_certification") ?? 0) + 1);
      continue;
    }
    if (!hasResume) {
      resumeUnlockCount += 1;
      blockerCounts.set("missing_resume", (blockerCounts.get("missing_resume") ?? 0) + 1);
      continue;
    }
    readyDriveCount += 1;
  }

  const nextAction = completionUnlockCount > 0
    ? {
        label: "Completing required profile fields",
        unlockCount: completionUnlockCount,
      }
    : !base.declarationStatus.profileCertification.isCertified && certificationUnlockCount > 0
      ? {
          label: "Certifying your profile",
          unlockCount: certificationUnlockCount,
        }
      : !hasResume && resumeUnlockCount > 0
        ? {
            label: "Uploading your resume",
            unlockCount: resumeUnlockCount,
          }
        : null;

  const blockerSummary = [...blockerCounts.entries()]
    .map(([code, count]) => ({
      code,
      count,
      label:
        code === "missing_resume"
          ? "Resume missing"
          : code === "profile_certification"
            ? "Profile certification pending"
            : code === "profile_incomplete"
              ? "Required profile fields missing"
              : ELIGIBILITY_REASON_LABELS[code as keyof typeof ELIGIBILITY_REASON_LABELS] ?? code,
    }))
    .sort((left, right) => right.count - left.count);

  const verificationSection = base.sectionStates.find((section) => section.key === "verification");
  if (verificationSection) {
    verificationSection.status = base.declarationStatus.profileCertification.isCertified
      ? "complete"
      : base.profileCompleteness.isComplete
        ? "needs_review"
        : "missing_required";
    verificationSection.summary = base.declarationStatus.profileCertification.isCertified
      ? "Certified"
      : base.profileCompleteness.isComplete
        ? "Ready to certify"
        : "Complete required fields first";
  }

  return {
    ...base,
    fieldTrust: buildProfileFieldTrust(base),
    fieldHelp: PROFILE_FIELD_HELP,
    readinessBanner: buildProfileReadinessBanner(base),
    liveEligibility: {
      totalUpcomingDrives: upcomingDrives.length,
      criteriaEligibleDrives: criteriaEligibleCount,
      readyForApplicationDrives: readyDriveCount,
      nextAction,
      blockers: blockerSummary,
      groupedEligibilityReasons: groupEligibilityBlockers(actualEligibilityReasons),
    },
    profileOptions: buildProfileOptions({
      branchOptions: [...tenantBranches, base.studentEditableProfile.branch].filter(Boolean),
      degreeOptions: [currentDegree].filter(Boolean),
    }),
    resumeInsights: {
      hasManagedResume: Boolean(base.studentEditableProfile.resumeDriveWebLink),
      hasLegacyResumeLink: Boolean(base.studentEditableProfile.resumeUrl && !base.studentEditableProfile.resumeDriveWebLink),
      usageCount: resumeUsageCount,
      fileSizeLabel: base.studentEditableProfile.resumeSizeBytes
        ? `${(base.studentEditableProfile.resumeSizeBytes / 1024).toFixed(0)} KB`
        : "",
    },
    preferenceVisibility: {
      targetRoles: { visibility: "tpo_visible", label: "Visible to placement office" },
      preferredLocations: { visibility: "tpo_visible", label: "Visible to placement office" },
      willingToRelocate: { visibility: "tpo_visible", label: "Visible to placement office" },
    },
    unlockRequest,
  };
}

async function buildMyProfileResponseWithVisibility(profile: Awaited<ReturnType<typeof StudentRepository.getStudentProfile>>) {
  const studentId = String(profile.id);
  const [base, tpoVisibilitySummary, dashboard, pendingAttempt] = await Promise.all([
    buildProfileExperience(profile),
    buildTpoVisibilitySummary(profile),
    StudentRepository.getDashboardData(String(profile.tenant_id), studentId),
    getPendingAttemptSummary(String(profile.tenant_id), studentId),
  ]);
  const nearestDrive = dashboard.upcomingDrives[0] ?? null;
  const featuredDrivePrep = nearestDrive
    ? {
        driveId: nearestDrive.id,
        company: nearestDrive.company,
        role: nearestDrive.role,
        driveDate: nearestDrive.driveDate,
        daysRemaining: Math.max(
          0,
          Math.ceil((new Date(nearestDrive.driveDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        ),
      }
    : null;
  return {
    ...base,
    tpoVisibilitySummary,
    activeBlockers: mapProfileBlockers(base.liveEligibility.blockers),
    nextBestActions: buildStudentActionFeed({
      profileExperience: base,
      dashboard,
      pendingAttempt,
      featuredDrivePrep,
    }),
  };
}

type StudentActionItem = {
  id: string;
  type:
    | "complete_profile"
    | "certify_profile"
    | "upload_resume"
    | "resume_pending_test"
    | "prepare_drive"
    | "continue_resource"
    | "take_mock"
    | "browse_resources";
  title: string;
  explanation: string;
  targetPath: string;
  ctaLabel: string;
  priority: number;
  meta?: Record<string, string | number | boolean | null>;
};

type StudentBlockerItem = {
  code: string;
  label: string;
  count: number;
  explanation: string;
  targetPath: string;
  ctaLabel: string;
};

async function getPendingAttemptSummary(tenantId: string, studentId: string) {
  const db = await getMongoDb();
  const pending = await db.collection("student_attempts").findOne(
    {
      tenant_id: tenantId,
      student_id: studentId,
      status: "pending",
    },
    {
      projection: {
        _id: 0,
        id: 1,
        test_id: 1,
        started_at: 1,
        updated_at: 1,
        current_question_index: 1,
        draft_answers: 1,
        questions_snapshot: 1,
      },
      sort: { updated_at: -1, started_at: -1 },
    },
  );

  if (!pending) return null;

  const test = await db.collection("mock_tests").findOne(
    {
      id: String(pending.test_id),
      $or: [{ tenant_id: tenantId }, { tenant_id: null }],
    },
    {
      projection: { _id: 0, id: 1, title: 1, difficulty: 1, duration_sec: 1 },
    },
  );

  const draftAnswers = pending.draft_answers && typeof pending.draft_answers === "object"
    ? pending.draft_answers as Record<string, unknown>
    : {};
  const answeredCount = Object.values(draftAnswers).filter((value) => Number.isInteger(value)).length;
  const totalQuestions = Array.isArray(pending.questions_snapshot) ? pending.questions_snapshot.length : 0;

  return {
    attemptId: String(pending.id),
    testId: String(pending.test_id),
    title: String(test?.title ?? "Pending mock test"),
    difficulty: String(test?.difficulty ?? "medium"),
    durationSec: Number(test?.duration_sec ?? 0),
    startedAt: pending.started_at ? String(pending.started_at) : null,
    updatedAt: pending.updated_at ? String(pending.updated_at) : null,
    currentQuestion: Number(pending.current_question_index ?? 0),
    answeredCount,
    totalQuestions,
  };
}

function mapProfileBlockers(blockers: Awaited<ReturnType<typeof buildProfileExperience>>["liveEligibility"]["blockers"]): StudentBlockerItem[] {
  return blockers.map((blocker) => {
    if (blocker.code === "missing_resume") {
      return {
        ...blocker,
        explanation: "Upload your resume to unlock more drive applications and keep exports ready.",
        targetPath: "/profile",
        ctaLabel: "Upload resume",
      };
    }

    if (blocker.code === "profile_certification") {
      return {
        ...blocker,
        explanation: "Certify your profile so published drives can use your latest declared data.",
        targetPath: "/profile",
        ctaLabel: "Review and certify",
      };
    }

    if (blocker.code === "profile_incomplete") {
      return {
        ...blocker,
        explanation: "Finish the required profile details first so the placement workflow can trust your data.",
        targetPath: "/profile",
        ctaLabel: "Complete profile",
      };
    }

    return {
      ...blocker,
      explanation: "Review the current drive criteria and your academic details to understand this blocker.",
      targetPath: "/drives",
      ctaLabel: "Review drives",
    };
  });
}

function buildStudentActionFeed(params: {
  profileExperience: Awaited<ReturnType<typeof buildProfileExperience>>;
  dashboard: Awaited<ReturnType<typeof StudentRepository.getDashboardData>>;
  pendingAttempt: Awaited<ReturnType<typeof getPendingAttemptSummary>>;
  featuredDrivePrep: {
    driveId: string;
    company: string;
    role: string;
    driveDate: string;
    daysRemaining: number | null;
  } | null;
}): StudentActionItem[] {
  const { profileExperience, dashboard, pendingAttempt, featuredDrivePrep } = params;
  const actions: StudentActionItem[] = [];
  const profilePath = "/profile";

  if (!profileExperience.profileCompleteness.isComplete) {
    const missingLabel = profileExperience.missingRequiredFields[0]?.label ?? "required profile details";
    actions.push({
      id: "complete-profile",
      type: "complete_profile",
      title: "Complete your profile",
      explanation: `Finish ${missingLabel} so your placement readiness and drive eligibility stay accurate.`,
      targetPath: profilePath,
      ctaLabel: "Open profile",
      priority: 10,
    });
  }

  if (!profileExperience.declarationStatus.profileCertification.isCertified) {
    actions.push({
      id: "certify-profile",
      type: "certify_profile",
      title: "Certify your profile",
      explanation: "Your current details need certification before you can apply confidently to drives.",
      targetPath: profilePath,
      ctaLabel: "Review and certify",
      priority: 20,
    });
  }

  if (!profileExperience.resumeInsights.hasManagedResume && !profileExperience.resumeInsights.hasLegacyResumeLink) {
    actions.push({
      id: "upload-resume",
      type: "upload_resume",
      title: "Upload your resume",
      explanation: "A managed resume unlocks more drives and ensures the right snapshot is attached when you apply.",
      targetPath: profilePath,
      ctaLabel: "Upload resume",
      priority: 30,
    });
  }

  if (pendingAttempt) {
    actions.push({
      id: "resume-pending-test",
      type: "resume_pending_test",
      title: "Resume your pending mock test",
      explanation: `${pendingAttempt.title} is still open with ${pendingAttempt.answeredCount}/${pendingAttempt.totalQuestions || "?"} questions saved.`,
      targetPath: `/mock-tests/${encodeURIComponent(pendingAttempt.testId)}`,
      ctaLabel: "Resume test",
      priority: 40,
      meta: {
        attemptId: pendingAttempt.attemptId,
        answeredCount: pendingAttempt.answeredCount,
        totalQuestions: pendingAttempt.totalQuestions,
      },
    });
  }

  if (featuredDrivePrep) {
    actions.push({
      id: `prepare-drive-${featuredDrivePrep.driveId}`,
      type: "prepare_drive",
      title: "Prepare for your next drive",
      explanation: `${featuredDrivePrep.company}${featuredDrivePrep.role ? ` - ${featuredDrivePrep.role}` : ""} is next${featuredDrivePrep.daysRemaining === null ? "" : ` in ${featuredDrivePrep.daysRemaining} day(s)`}.`,
      targetPath: "/drives",
      ctaLabel: "Open drives",
      priority: 50,
      meta: {
        driveId: featuredDrivePrep.driveId,
        daysRemaining: featuredDrivePrep.daysRemaining,
      },
    });
  }

  const recentResource = dashboard.resourceUsage.recentResources[0];
  if (recentResource) {
    actions.push({
      id: `continue-resource-${recentResource.resourceId}`,
      type: "continue_resource",
      title: "Continue reading",
      explanation: `Pick up ${recentResource.title} from where you left off instead of restarting from scratch.`,
      targetPath: `/resources/view/${encodeURIComponent(recentResource.resourceId)}`,
      ctaLabel: "Continue resource",
      priority: 60,
      meta: {
        progressPct: recentResource.progressPct,
      },
    });
  } else if (profileExperience.canAccessResources) {
    actions.push({
      id: "browse-resources",
      type: "browse_resources",
      title: "Open a recommended resource",
      explanation: "Start one focused resource so Smart Path can guide you from real study activity, not profile data alone.",
      targetPath: "/resources",
      ctaLabel: "Browse resources",
      priority: 70,
    });
  }

  if (profileExperience.canAccessMockTests && dashboard.recommendedTest) {
    actions.push({
      id: `take-mock-${dashboard.recommendedTest.id}`,
      type: "take_mock",
      title: "Take your next mock test",
      explanation: `${dashboard.recommendedTest.title} matches your current preparation pattern and helps keep your readiness signal fresh.`,
      targetPath: `/mock-tests/${encodeURIComponent(dashboard.recommendedTest.id)}`,
      ctaLabel: "Open mock test",
      priority: 80,
      meta: {
        testId: dashboard.recommendedTest.id,
        difficulty: dashboard.recommendedTest.difficulty,
      },
    });
  }

  return actions.sort((left, right) => left.priority - right.priority);
}

type StudentDriveReadinessNotificationContext = {
  readyToApply: Array<{ driveId: string; company: string; role: string | null; driveDate: string; daysRemaining: number | null }>;
  blockedByResume: Array<{ driveId: string; company: string; role: string | null; driveDate: string; daysRemaining: number | null }>;
  blockedByCertification: Array<{ driveId: string; company: string; role: string | null; driveDate: string; daysRemaining: number | null }>;
  blockedByResumeAndCertification: Array<{ driveId: string; company: string; role: string | null; driveDate: string; daysRemaining: number | null }>;
};

function daysUntilDrive(dateIso: string): number | null {
  if (!dateIso) return null;
  const target = new Date(dateIso);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

async function collectStudentDriveReadinessNotificationContext(params: {
  tenantId: string;
  userId: string;
  profileResponse: ReturnType<typeof buildMyProfileResponse>;
}) {
  const db = await getMongoDb();
  const student = await StudentRepository.getStudentByUserId(params.tenantId, params.userId);
  const drives = await db.collection("drives").find(
    {
      tenant_id: params.tenantId,
      deleted_at: null,
      status: "published",
      drive_date: { $gte: new Date().toISOString().slice(0, 10) },
    },
    { projection: { _id: 0, id: 1, company: 1, role: 1, drive_date: 1, criteria: 1, status: 1 } },
  ).sort({ drive_date: 1 }).limit(10).toArray();

  const profileCertified = params.profileResponse.declarationStatus.profileCertification.isCertified;
  const hasResume =
    Boolean(params.profileResponse.studentEditableProfile.resumeDriveWebLink)
    || Boolean(params.profileResponse.studentEditableProfile.resumeUrl);

  const context: StudentDriveReadinessNotificationContext = {
    readyToApply: [],
    blockedByResume: [],
    blockedByCertification: [],
    blockedByResumeAndCertification: [],
  };

  for (const drive of drives) {
    const evaluation = await evaluateEligibilityWithPlacementPolicy({
      tenantId: params.tenantId,
      student: {
        cgpa: Number(student.cgpa ?? 0),
        activeBacklogs: Number(student.backlogs ?? 0),
        totalBacklogs: Number((student as unknown as { backlogs_total?: unknown }).backlogs_total ?? 0),
        branch: String(student.branch ?? ""),
        attendancePct: Number(student.attendance_pct ?? 0),
      },
      criteria: (drive.criteria ?? {}) as {
        minCgpa?: number;
        maxBacklogs?: number;
        maxActiveBacklogs?: number;
        maxTotalBacklogs?: number;
        branches?: string[];
        minAttendance?: number;
        excludePlacedStudents?: boolean;
      },
      isPlaced: params.profileResponse.placementStatus.isPlaced,
    });

    if (!evaluation.eligible) continue;

    const summary = {
      driveId: String(drive.id ?? ""),
      company: String(drive.company ?? ""),
      role: drive.role ? String(drive.role) : null,
      driveDate: String(drive.drive_date ?? ""),
      daysRemaining: daysUntilDrive(String(drive.drive_date ?? "")),
    };

    if (profileCertified && hasResume) {
      context.readyToApply.push(summary);
      continue;
    }

    if (!profileCertified && !hasResume) {
      context.blockedByResumeAndCertification.push(summary);
      continue;
    }

    if (!profileCertified) {
      context.blockedByCertification.push(summary);
      continue;
    }

    context.blockedByResume.push(summary);
  }

  return {
    studentId: String(student.id),
    ...context,
  };
}

async function publishStudentDriveReadinessNotifications(params: {
  tenantId: string;
  userId: string;
  senderId: string;
  beforeProfile: ReturnType<typeof buildMyProfileResponse>;
  afterProfile: ReturnType<typeof buildMyProfileResponse>;
}) {
  const [beforeContext, afterContext] = await Promise.all([
    collectStudentDriveReadinessNotificationContext({
      tenantId: params.tenantId,
      userId: params.userId,
      profileResponse: params.beforeProfile,
    }),
    collectStudentDriveReadinessNotificationContext({
      tenantId: params.tenantId,
      userId: params.userId,
      profileResponse: params.afterProfile,
    }),
  ]);

  const beforeReady = new Set(beforeContext.readyToApply.map((item) => item.driveId));
  const newlyReady = afterContext.readyToApply.filter((item) => !beforeReady.has(item.driveId)).slice(0, 3);

  for (const drive of newlyReady) {
    await CommunicationService.publishSystemAnnouncementToStudents({
      tenantId: params.tenantId,
      senderId: params.senderId,
      studentIds: [afterContext.studentId],
      systemKey: `student-ready-drive:${afterContext.studentId}:${drive.driveId}`,
      title: `You can now apply for ${drive.company}${drive.role ? ` - ${drive.role}` : ""}`,
      message: `Your profile, certification, and resume now line up for this drive${drive.daysRemaining === null ? "." : ` with ${drive.daysRemaining} day(s) left.`} Open Drives and submit the application while it is still open.`,
      priority: drive.daysRemaining !== null && drive.daysRemaining <= 3 ? "urgent" : "important",
      relatedDriveId: drive.driveId,
    });
  }

  const reminderGroups = [
    {
      items: afterContext.blockedByResume.slice(0, 2),
      prefix: "resume",
      title: "Upload your resume to unlock applications",
      message: (drive: { company: string; role: string | null; daysRemaining: number | null }) =>
        `You already match ${drive.company}${drive.role ? ` - ${drive.role}` : ""}, but you still need to upload your resume before you can apply${drive.daysRemaining === null ? "." : ` with ${drive.daysRemaining} day(s) left.`}`,
    },
    {
      items: afterContext.blockedByCertification.slice(0, 2),
      prefix: "certification",
      title: "Certify your profile to unlock applications",
      message: (drive: { company: string; role: string | null; daysRemaining: number | null }) =>
        `You already match ${drive.company}${drive.role ? ` - ${drive.role}` : ""}, but you still need to certify your profile before you can apply${drive.daysRemaining === null ? "." : ` with ${drive.daysRemaining} day(s) left.`}`,
    },
    {
      items: afterContext.blockedByResumeAndCertification.slice(0, 2),
      prefix: "resume-and-certification",
      title: "Complete your profile steps to apply",
      message: (drive: { company: string; role: string | null; daysRemaining: number | null }) =>
        `You already match ${drive.company}${drive.role ? ` - ${drive.role}` : ""}, but you still need both a certified profile and an uploaded resume before you can apply${drive.daysRemaining === null ? "." : ` with ${drive.daysRemaining} day(s) left.`}`,
    },
  ];

  for (const group of reminderGroups) {
    for (const drive of group.items) {
      await CommunicationService.publishSystemAnnouncementToStudents({
        tenantId: params.tenantId,
        senderId: params.senderId,
        studentIds: [afterContext.studentId],
        systemKey: `student-${group.prefix}-blocker:${afterContext.studentId}:${drive.driveId}`,
        title: group.title,
        message: group.message(drive),
        priority: drive.daysRemaining !== null && drive.daysRemaining <= 3 ? "urgent" : "important",
        relatedDriveId: drive.driveId,
      });
    }
  }
}

function buildGenericPrepBundle(params: {
  drive: { id: string; company: string; role: string; driveDate: string };
  curatedMocks: Awaited<ReturnType<typeof MockTestService.getCuratedTests>> | null;
  resources: null | {
    sections: {
      companyPatternPrep: RecommendedResourceItem[];
      interviewPractice: RecommendedResourceItem[];
      placementEssentials: RecommendedResourceItem[];
      forYourBranch: RecommendedResourceItem[];
    };
  };
}) {
  const { drive, curatedMocks, resources } = params;
  if (!curatedMocks && !resources) return null;

  const mockTests = uniqueById([
    ...(curatedMocks?.preDriveBundle?.items ?? []),
    ...(curatedMocks?.sections.companyPatternPrep ?? []),
    ...(curatedMocks?.sections.placementEssentials ?? []),
    ...(curatedMocks?.sections.forYourBranch ?? []),
  ]).slice(0, 3);

  const resourceItems = uniqueById([
    ...(resources?.sections.companyPatternPrep ?? []),
    ...(resources?.sections.interviewPractice ?? []),
    ...(resources?.sections.placementEssentials ?? []),
    ...(resources?.sections.forYourBranch ?? []),
  ]).slice(0, 3);

  if (mockTests.length === 0 && resourceItems.length === 0) {
    return null;
  }

  return {
    summary: `${drive.company}${drive.role ? ` - ${drive.role}` : ""} prep, blending company signals, branch context, and placement essentials.`,
    mockTests,
    resources: resourceItems,
  };
}

function selectRecommendedResources(
  items: ScoredRecommendedResourceItem[],
  predicate: (item: ScoredRecommendedResourceItem) => boolean,
  limit: number,
  bucket: string,
) {
  return uniqueById(
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

function matchesAnyKeyword(resource: StudentResourceItem, keywords: string[]) {
  if (keywords.length === 0) return false;
  const resourceMetadata = resource as StudentResourceItem & {
    summaryShort?: string;
    searchText?: string;
    keyTopics?: string[];
    keywords?: string[];
  };
  const haystack = buildRecommendationHaystack([
    resource.title,
    resource.description,
    resourceMetadata.summaryShort,
    resourceMetadata.searchText,
    resource.studyDocument?.whatThisCovers,
    resource.studyDocument?.topic,
    resource.studyDocument?.subtopic,
    ...(resource.studyDocument?.keyConcepts ?? []),
    ...(resource.studyDocument?.interviewFocus ?? []),
    ...(resource.studyDocument?.recommendedFor ?? []),
    ...(resource.studyDocument?.careerTracks ?? []),
    ...(resource.studyDocument?.branchRelevance ?? []),
    ...(resource.studyDocument?.contentPacks ?? []),
    ...(resourceMetadata.keyTopics ?? []),
    ...(resourceMetadata.keywords ?? []),
  ]);
  return keywords.some((keyword) => haystack.includes(normalizeRecommendationText(keyword)));
}

function countBranchTaggedResources(items: StudentResourceItem[], branch: string) {
  return items.filter((item) =>
    (item.studyDocument?.branchRelevance ?? []).some((value) => matchesBranchPrepTrackTag(String(value), branch))
  ).length;
}

function buildBranchResourcePacks(input: {
  scoredResources: ScoredRecommendedResourceItem[];
  branchCode: string | null;
  limitPerPack: number;
}) {
  if (!input.branchCode) return [] as ResourceRecommendationPack[];

  return BRANCH_PACK_DEFINITIONS
    .filter((pack) => pack.branch === input.branchCode)
    .map((pack) => ({
      id: pack.id,
      title: pack.title,
      description: pack.description,
      items: uniqueById(
        input.scoredResources
          .filter((item) =>
            item.recommendationFlags.branchMatch
              && (matchesAnyKeyword(item, pack.keywords)
                || (item.studyDocument?.contentPacks ?? []).some((value) => normalizeRecommendationText(value) === normalizeRecommendationText(pack.title))),
          )
          .slice(0, input.limitPerPack),
      ),
    }))
    .filter((pack) => pack.items.length >= 2);
}

function selectPlacementEssentials(scoredResources: ScoredRecommendedResourceItem[], limit: number) {
  return selectRecommendedResources(
    scoredResources,
    (item) =>
      !item.recommendationFlags.branchMatch
        || matchesAnyKeyword(item, COMMON_PLACEMENT_KEYWORDS)
        || item.recommendationFlags.weakTopicMatch
        || item.recommendationFlags.continueLearningMatch,
    limit,
    "placement_essentials",
  );
}

function selectCompanyPatternPrep(scoredResources: ScoredRecommendedResourceItem[], limit: number) {
  return selectRecommendedResources(
    scoredResources,
    (item) => item.recommendationFlags.upcomingDriveMatch || matchesAnyKeyword(item, COMPANY_PREP_KEYWORDS),
    limit,
    "company_pattern_prep",
  );
}

function selectInterviewPractice(scoredResources: ScoredRecommendedResourceItem[], limit: number) {
  return selectRecommendedResources(
    scoredResources,
    (item) => matchesAnyKeyword(item, INTERVIEW_PRACTICE_KEYWORDS),
    limit,
    "interview_practice",
  );
}

function selectTargetRoleBoost(scoredResources: ScoredRecommendedResourceItem[], targetRoles: string[], limit: number) {
  const roleKeywords = targetRoles.flatMap((role) => {
    const normalizedRole = normalizeRecommendationText(role);
    if (normalizedRole.includes("software")) return TARGET_ROLE_KEYWORDS.software;
    if (normalizedRole.includes("analyst")) return TARGET_ROLE_KEYWORDS.analyst;
    if (normalizedRole.includes("graduate engineer") || normalizedRole === "get") return TARGET_ROLE_KEYWORDS.graduate_engineer_trainee;
    return [role];
  });

  if (roleKeywords.length === 0) return [] as ScoredRecommendedResourceItem[];

  return selectRecommendedResources(
    scoredResources,
    (item) => matchesAnyKeyword(item, roleKeywords),
    limit,
    "target_role_boost",
  );
}

export const StudentService = {
  async getPilotDashboard(tenantId: string, userId: string) {
    const db = await getMongoDb();
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    const studentId = String(student.id);
    const todayIso = new Date().toISOString().slice(0, 10);
    const start7Date = new Date();
    start7Date.setUTCDate(start7Date.getUTCDate() - 7);
    const start7DayIso = start7Date.toISOString().slice(0, 10);
    const start7Iso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [user, studyHours7d, upcomingDrives, attempts7d, resources7d, driveResults, totalStudents] = await Promise.all([
      db.collection("users").findOne(
        { tenant_id: tenantId, id: String(student.user_id) },
        { projection: { _id: 0, full_name: 1, email: 1 } },
      ),
      db.collection("study_hours").find(
        { tenant_id: tenantId, student_id: studentId, study_date: { $gte: start7DayIso, $lte: todayIso } },
        { projection: { _id: 0, hours: 1 } },
      ).toArray(),
      db.collection("drives").find(
        { tenant_id: tenantId, deleted_at: null, drive_date: { $gte: todayIso } },
        { projection: { _id: 0, id: 1, company: 1, role: 1, drive_date: 1, criteria: 1, status: 1, eligible_count: 1 } },
      ).sort({ drive_date: 1 }).limit(6).toArray(),
      db.collection("student_attempts").find(
        { tenant_id: tenantId, student_id: studentId, status: "submitted", submitted_at: { $gte: start7Iso } },
        { projection: { _id: 0, id: 1, score: 1, submitted_at: 1, test_id: 1 } },
      ).sort({ submitted_at: -1 }).toArray(),
      db.collection("resource_view_events").find(
        { tenant_id: tenantId, student_id: studentId, event_type: "open", created_at: { $gte: start7Iso } },
        { projection: { _id: 0, resource_id: 1, created_at: 1, metadata: 1 } },
      ).sort({ created_at: -1 }).limit(5).toArray(),
      db.collection("drive_results").find(
        { tenant_id: tenantId, student_id: studentId },
        { projection: { _id: 0, drive_id: 1, status: 1, outcome: 1, result_released_at: 1 } },
      ).toArray(),
      db.collection("students").countDocuments({ tenant_id: tenantId }),
    ]);

    const profileSummary = buildStudentProfileSummary({
      student,
      user: {
        full_name: user?.full_name,
        email: user?.email,
      },
    });
    const profileCompletenessPct = profileSummary.profileCompleteness.pct;
    const driveResultMap = new Map(driveResults.map((item) => [String(item.drive_id), item]));
    const eligibilityChecks = await Promise.all(
      upcomingDrives.map((drive) =>
        evaluateEligibilityWithPlacementPolicy({
          tenantId,
          student: {
            cgpa: Number(student.cgpa ?? 0),
            activeBacklogs: Number(student.backlogs ?? 0),
            totalBacklogs: Number((student as unknown as { backlogs_total?: unknown }).backlogs_total ?? 0),
            branch: String(student.branch ?? ""),
            attendancePct: Number(student.attendance_pct ?? 0),
          },
          criteria: (drive.criteria ?? {}) as {
            minCgpa?: number;
            maxBacklogs?: number;
            maxActiveBacklogs?: number;
            maxTotalBacklogs?: number;
            branches?: string[];
            minAttendance?: number;
            excludePlacedStudents?: boolean;
          },
          isPlaced: Boolean((student.profile_data as Record<string, unknown> | undefined)?.placementStatus && ((student.profile_data as Record<string, unknown>).placementStatus as Record<string, unknown>).isPlaced === true),
        }),
      ),
    );
    const eligibleUpcomingDrives = eligibilityChecks.filter((item) => item.eligible).length;

    return {
      studentName: String(user?.full_name ?? "Student"),
      branch: String(student.branch ?? ""),
      batch: String(student.batch ?? ""),
      cgpa: Number(student.cgpa ?? 0),
      readinessScore: Number(student.readiness_score ?? 0),
      profileCompletenessPct,
      canAccessResources: profileSummary.canAccessResources,
      canAccessMockTests: profileSummary.canAccessMockTests,
      missingStudentFields: profileSummary.missingStudentFields,
      missingSeededFields: profileSummary.missingSeededFields,
      totalStudents,
      studyHours7d: Number(studyHours7d.reduce((sum, row) => sum + Number(row.hours ?? 0), 0).toFixed(1)),
      mockTestsTaken7d: attempts7d.length,
      eligibleUpcomingDrives,
      checklist: [
        { id: "profile", label: "Complete profile", done: profileSummary.profileCompleteness.isComplete },
        { id: "mock", label: "Take one mock test this week", done: attempts7d.length > 0 },
        { id: "resources", label: "Open a placement resource", done: resources7d.length > 0 },
      ],
      upcomingDrives: upcomingDrives.map((drive) => ({
        id: String(drive.id),
        company: String(drive.company ?? ""),
        role: String(drive.role ?? ""),
        driveDate: String(drive.drive_date ?? ""),
        status: String(drive.status ?? "upcoming"),
        eligibleCount: Number(drive.eligible_count ?? 0),
        myStatus: String(driveResultMap.get(String(drive.id))?.status ?? "not_computed"),
        myOutcome: driveResultMap.get(String(drive.id))?.result_released_at
          ? String(driveResultMap.get(String(drive.id))?.outcome ?? "pending")
          : "pending",
      })),
      recentResources: resources7d.map((resource) => {
        const metadata = resource.metadata && typeof resource.metadata === "object"
          ? resource.metadata as Record<string, unknown>
          : {};
        return {
          resourceId: String(resource.resource_id ?? ""),
          title: String(metadata.resourceTitle ?? "Placement resource"),
          viewedAt: String(resource.created_at ?? ""),
        };
      }),
    };
  },

  async listStudentDrives(tenantId: string, userId: string) {
    const db = await getMongoDb();
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    const profile = await StudentRepository.getStudentProfile(tenantId, userId);
    const profileExperience = await buildProfileExperience(profile);
    const profileCertified = profileExperience.declarationStatus.profileCertification.isCertified;
    const hasResume = profileExperience.resumeInsights.hasManagedResume || profileExperience.resumeInsights.hasLegacyResumeLink;
    const drives = await db.collection("drives").find(
      { tenant_id: tenantId, deleted_at: null },
      { projection: { _id: 0, id: 1, company: 1, role: 1, drive_date: 1, criteria: 1, status: 1, eligible_count: 1 } },
    ).sort({ drive_date: 1 }).toArray();

    const [resourceRecommendations, curatedMocks] = await Promise.all([
      profileExperience.canAccessResources
        ? this.getRecommendedResources(tenantId, userId, { filter: "all" })
        : Promise.resolve(null),
      profileExperience.canAccessMockTests
        ? MockTestService.getCuratedTests({ tenantId, userId, role: "student" })
        : Promise.resolve(null),
    ]);

    const driveIds = drives.map((drive) => String(drive.id));
    const results = driveIds.length > 0
      ? await db.collection("drive_results").find(
          { tenant_id: tenantId, student_id: student.id, drive_id: { $in: driveIds } },
          { projection: { _id: 0, drive_id: 1, status: 1, application_state: 1, outcome: 1, remarks: 1, result_released_at: 1, offer_letter_url: 1, offer_letter_reference: 1 } },
        ).toArray()
      : [];
    const resultMap = new Map(results.map((item) => [String(item.drive_id), item]));

    return Promise.all(drives.map(async (drive) => {
      const lifecycle = normalizeDriveLifecycle(drive.status);
      const evaluation = await evaluateEligibilityWithPlacementPolicy({
        tenantId,
        student: {
          cgpa: Number(student.cgpa ?? 0),
          activeBacklogs: Number(student.backlogs ?? 0),
          totalBacklogs: Number((student as unknown as { backlogs_total?: unknown }).backlogs_total ?? 0),
          branch: String(student.branch ?? ""),
          attendancePct: Number(student.attendance_pct ?? 0),
        },
        criteria: (drive.criteria ?? {}) as {
          minCgpa?: number;
          maxBacklogs?: number;
          maxActiveBacklogs?: number;
          maxTotalBacklogs?: number;
          branches?: string[];
          minAttendance?: number;
          excludePlacedStudents?: boolean;
        },
        isPlaced: profileExperience.placementStatus.isPlaced,
      });
      const row = resultMap.get(String(drive.id));
      const isReleased = Boolean(row?.result_released_at);
      const applicationState = String(row?.application_state ?? (row?.status === "applied" ? "applied" : "not_applied"));
      const canApplyNow = evaluation.eligible && profileCertified && hasResume && applicationState !== "applied";
      const actionHint = (() => {
        if (applicationState === "applied") {
          return {
            label: "Application submitted",
            explanation: "Your resume snapshot is attached. Use the prep bundle below to stay ready for the next round.",
            targetPath: "/mock-tests",
            ctaLabel: "Open preparation",
          };
        }
        if (!evaluation.eligible) {
          return {
            label: "Review eligibility blockers",
            explanation: "This drive is blocked by the academic criteria shown below. Fix what you can and watch future drives.",
            targetPath: "/profile",
            ctaLabel: "Review profile",
          };
        }
        if (!profileExperience.profileCompleteness.isComplete) {
          return {
            label: "Complete profile to apply",
            explanation: "Your academic fit is fine, but the placement workflow still needs all required profile fields.",
            targetPath: "/profile",
            ctaLabel: "Complete profile",
          };
        }
        if (!profileCertified) {
          return {
            label: "Certify profile to apply",
            explanation: "Your details match the criteria, but the placement office still needs your certified declaration.",
            targetPath: "/profile",
            ctaLabel: "Review and certify",
          };
        }
        if (!hasResume) {
          return {
            label: "Upload resume to apply",
            explanation: "This drive needs your current resume before you can submit a valid application.",
            targetPath: "/profile",
            ctaLabel: "Upload resume",
          };
        }
        return {
          label: "Ready to apply",
          explanation: "Your current profile and resume are ready for this drive. Open the declaration and apply when you are ready.",
          targetPath: "/drives",
          ctaLabel: "Apply now",
        };
      })();
      const prepBundle = buildGenericPrepBundle({
        drive: {
          id: String(drive.id),
          company: String(drive.company ?? ""),
          role: String(drive.role ?? ""),
          driveDate: String(drive.drive_date ?? ""),
        },
        curatedMocks,
        resources: resourceRecommendations,
      });

      return {
        id: String(drive.id),
        company: String(drive.company ?? ""),
        role: String(drive.role ?? ""),
        driveDate: String(drive.drive_date ?? ""),
        status: lifecycle,
        lifecycle,
        eligibleCount: Number(drive.eligible_count ?? 0),
        isEligible: evaluation.eligible,
        eligibility: {
          finalVerdict: evaluation.eligible ? "eligible" : "not_eligible",
          blockingReasons: evaluation.reasons.map((reason) => ({
            code: reason,
            label: ELIGIBILITY_REASON_LABELS[reason as keyof typeof ELIGIBILITY_REASON_LABELS] ?? reason,
          })),
          advisoryNotes: evaluation.eligible
            ? ["You match the current drive criteria."]
            : ["Fix the blocking items below before you expect placement-office help."],
          criteriaSnapshot: {
            minCgpa: Number(drive.criteria?.minCgpa ?? 0),
            maxBacklogs: Number(drive.criteria?.maxBacklogs ?? 0),
            maxActiveBacklogs: Number(drive.criteria?.maxActiveBacklogs ?? drive.criteria?.maxBacklogs ?? 0),
            maxTotalBacklogs: Number(drive.criteria?.maxTotalBacklogs ?? 0),
            branches: Array.isArray(drive.criteria?.branches) ? drive.criteria.branches : [],
            minAttendance: Number(drive.criteria?.minAttendance ?? 0),
          },
        },
        reasons: evaluation.reasons.map((reason) => ({
          code: reason,
          label: ELIGIBILITY_REASON_LABELS[reason as keyof typeof ELIGIBILITY_REASON_LABELS] ?? reason,
        })),
        criteria: {
          minCgpa: Number(drive.criteria?.minCgpa ?? 0),
          maxBacklogs: Number(drive.criteria?.maxBacklogs ?? 0),
          maxActiveBacklogs: Number(drive.criteria?.maxActiveBacklogs ?? drive.criteria?.maxBacklogs ?? 0),
          maxTotalBacklogs: Number(drive.criteria?.maxTotalBacklogs ?? 0),
          branches: Array.isArray(drive.criteria?.branches) ? drive.criteria.branches : [],
          minAttendance: Number(drive.criteria?.minAttendance ?? 0),
          excludePlacedStudents: Boolean(evaluation.effectiveExcludePlacedStudents),
        },
        myStatus: String(row?.status ?? "not_computed"),
        applicationState,
        canWithdraw: lifecycle === "published" && applicationState === "applied",
        myOutcome: isReleased ? String(row?.outcome ?? "pending") : "pending",
        remarks: isReleased && row?.remarks ? String(row.remarks) : null,
        resultReleasedAt: isReleased ? String(row?.result_released_at ?? "") : null,
        offerLetterUrl: isReleased && row?.offer_letter_url ? String(row.offer_letter_url) : null,
        offerLetterReference: isReleased && row?.offer_letter_reference ? String(row.offer_letter_reference) : null,
        canApplyNow,
        readinessSupport: {
          profileCertified,
          hasResume,
        },
        actionHint,
        prepBundle,
        timeline: {
          registrationStatus: lifecycle === "published" ? "open" : lifecycle === "registration_closed" ? "closed" : lifecycle,
          applicationState,
          profileCertified,
        },
      };
    }));
  },

  async getDriveDeclarationPreview(tenantId: string, userId: string, driveId: string) {
    const db = await getMongoDb();
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    const drive = await db.collection("drives").findOne(
      { tenant_id: tenantId, id: driveId, deleted_at: null },
      { projection: { _id: 0, id: 1, company: 1, role: 1, criteria: 1, status: 1 } },
    );

    if (!drive) {
      throw new AppError("DRIVE_NOT_FOUND", "Drive not found", 404);
    }

    const profile = await StudentRepository.getStudentProfile(tenantId, userId);
    const myProfile = buildMyProfileResponse(profile);
    const criteria = (drive.criteria ?? {}) as {
      minCgpa?: number;
      maxBacklogs?: number;
      maxActiveBacklogs?: number;
      maxTotalBacklogs?: number;
      branches?: string[];
      minAttendance?: number;
      excludePlacedStudents?: boolean;
    };

    const evaluation = await evaluateEligibilityWithPlacementPolicy({
      tenantId,
      criteria,
      student: {
        cgpa: Number(student.cgpa ?? 0),
        activeBacklogs: Number(student.backlogs ?? 0),
        totalBacklogs: Number((student as unknown as { backlogs_total?: unknown }).backlogs_total ?? 0),
        branch: String(student.branch ?? ""),
        attendancePct: Number(student.attendance_pct ?? 0),
      },
      isPlaced: myProfile.placementStatus.isPlaced,
    });

    return {
      driveId: String(drive.id),
      company: String(drive.company ?? ""),
      role: drive.role ? String(drive.role) : null,
      status: normalizeDriveLifecycle(drive.status),
      lifecycle: normalizeDriveLifecycle(drive.status),
      eligible: evaluation.eligible,
      reasons: evaluation.reasons.map((reason) => ({
        code: reason,
        label: ELIGIBILITY_REASON_LABELS[reason as keyof typeof ELIGIBILITY_REASON_LABELS] ?? reason,
      })),
      criteria: {
        minCgpa: criteria.minCgpa ?? null,
        maxActiveBacklogs: criteria.maxActiveBacklogs ?? criteria.maxBacklogs ?? null,
        maxTotalBacklogs: criteria.maxTotalBacklogs ?? null,
        minAttendance: criteria.minAttendance ?? null,
        branches: Array.isArray(criteria.branches) ? criteria.branches : [],
        excludePlacedStudents: evaluation.effectiveExcludePlacedStudents,
      },
      studentValues: {
        cgpa: Number(student.cgpa ?? 0),
        activeBacklogs: Number(student.backlogs ?? 0),
        totalHistoricalBacklogs: Number((student as unknown as { backlogs_total?: unknown }).backlogs_total ?? 0),
        attendancePct: Number(student.attendance_pct ?? 0),
        branch: String(student.branch ?? ""),
      },
      declarationStatus: myProfile.declarationStatus,
      applicationState: "not_applied",
      warning: "Continue only if these values are still correct. If anything is outdated or false, contact the TPO before applying.",
    };
  },

  async applyToDrive(params: {
    tenantId: string;
    userId: string;
    driveId: string;
    confirmDeclaration: boolean;
  }) {
    const drive = await DriveRepository.getDriveById(params.tenantId, params.driveId);
    const preview = await this.getDriveDeclarationPreview(params.tenantId, params.userId, params.driveId);
    const profile = await StudentRepository.getStudentProfile(params.tenantId, params.userId);
    const student = await StudentRepository.getStudentByUserId(params.tenantId, params.userId);
    const todayIso = new Date().toISOString().slice(0, 10);
    const driveDate = String(drive.driveDate ?? "");

    if (!params.confirmDeclaration) {
      throw new AppError("DECLARATION_CONFIRMATION_REQUIRED", "Confirm the declaration before applying to this drive.", 400);
    }

    if (preview.declarationStatus.onboarding.required) {
      throw new AppError("ONBOARDING_DECLARATION_REQUIRED", "Accept the student declaration before using drive applications.", 409);
    }

    if (!preview.declarationStatus.profileCertification.isCertified) {
      throw new AppError("PROFILE_CERTIFICATION_REQUIRED", "Certify your profile before applying to drives.", 409);
    }

    if (!preview.eligible) {
      throw new AppError("DRIVE_NOT_ELIGIBLE", "You are not eligible for this drive", 409, preview.reasons.map((reason) => ({
        field: "eligibility",
        message: reason.label,
      })));
    }

    if (driveDate && driveDate < todayIso) {
      throw new AppError("DRIVE_DEADLINE_PASSED", "The application deadline for this drive has already passed.", 409);
    }

    if (normalizeDriveLifecycle(drive.status) !== "published") {
      throw new AppError("DRIVE_REGISTRATION_CLOSED", "This drive is not open for new applications right now.", 409);
    }

    const existingResult = await DriveRepository.getDriveResultForStudent(params.tenantId, params.driveId, String(student.id));
    if (existingResult && (existingResult.status === "applied" || existingResult.outcome !== "pending")) {
      throw new AppError("DRIVE_ALREADY_APPLIED", "You have already applied to this drive.", 409);
    }

    const normalizedProfile = normalizeStudentProfileData(profile.profile_data);
    let resumeSnapshot:
      | {
        provider: string;
        fileId?: string | null;
        webLink: string;
        filename?: string | null;
        uploadedAt?: string | null;
      }
      | null = null;

    if (normalizedProfile.resumeDriveFileId && normalizedProfile.resumeDriveWebLink) {
      const copied = await GoogleDriveResumeService.copyResumeSnapshot({
        tenantId: params.tenantId,
        driveId: params.driveId,
        studentId: String(student.id),
        fullName: String(profile.full_name ?? student.full_name ?? "student"),
        sourceFileId: normalizedProfile.resumeDriveFileId,
        sourceFilename: normalizedProfile.resumeFilename || "resume.pdf",
        mimeType: normalizedProfile.resumeMimeType || "application/pdf",
        sizeBytes: normalizedProfile.resumeSizeBytes ?? 0,
      });
      resumeSnapshot = {
        provider: copied.provider,
        fileId: copied.fileId,
        webLink: copied.webViewLink,
        filename: copied.filename,
        uploadedAt: copied.uploadedAt,
      };
    } else if (normalizedProfile.resumeUrl) {
      resumeSnapshot = {
        provider: "legacy_link",
        webLink: normalizedProfile.resumeUrl,
        filename: normalizedProfile.resumeFilename || null,
        uploadedAt: normalizedProfile.resumeUploadedAt || null,
      };
    }

    if (!resumeSnapshot?.webLink) {
      throw new AppError(
        "RESUME_REQUIRED",
        "Upload your resume in Profile before applying to drives.",
        409,
      );
    }

    await StudentRepository.upsertStudentDriveDeclaration({
      tenantId: params.tenantId,
      studentId: String(student.id),
      driveId: params.driveId,
      declarationVersion: STUDENT_DECLARATION_POLICY_VERSION,
      snapshot: {
        driveId: preview.driveId,
        company: preview.company,
        role: preview.role,
        criteria: preview.criteria,
        studentValues: preview.studentValues,
        profileCertificationSnapshotHash: buildMyProfileResponse(profile).profileCertificationPreview.snapshotHash,
      },
    });

    await DriveRepository.markDriveApplied(
      params.tenantId,
      params.driveId,
      String(student.id),
      resumeSnapshot,
    );

    await StudentActivityService.logEvent({
      id: `drive-apply:${params.driveId}:${String(student.id)}`,
      tenantId: params.tenantId,
      studentId: String(student.id),
      eventType: "drive_applied",
      eventSource: "drive_results",
      entityId: params.driveId,
      entityType: "drive",
      title: "Applied to drive",
      description: `Applied to ${preview.company}${preview.role ? ` (${preview.role})` : ""}.`,
      metadata: {
        driveId: params.driveId,
        company: preview.company,
        role: preview.role,
      },
      impactScore: 66,
      module: "Drives",
    });

    await StudentActivityService.logEvent({
      id: `drive-declaration:${params.driveId}:${String(student.id)}`,
      tenantId: params.tenantId,
      studentId: String(student.id),
      eventType: "student_drive_declaration_accepted",
      eventSource: "student_declaration",
      entityId: params.driveId,
      entityType: "drive",
      title: "Drive declaration accepted",
      description: `Confirmed drive eligibility values before applying to ${preview.company}.`,
      metadata: {
        driveId: params.driveId,
        company: preview.company,
        role: preview.role,
        declarationVersion: STUDENT_DECLARATION_POLICY_VERSION,
      },
      impactScore: 6,
      module: "Drives",
    });

    return { driveId: params.driveId, status: "applied" as const, applicationState: "applied" as const };
  },

  async withdrawFromDrive(params: {
    tenantId: string;
    userId: string;
    driveId: string;
  }) {
    const student = await StudentRepository.getStudentByUserId(params.tenantId, params.userId);
    const data = await DriveRepository.getDriveResultForStudent(params.tenantId, params.driveId, String(student.id));
    if (!data || data.applicationState !== "applied") {
      throw new AppError("DRIVE_WITHDRAWAL_INVALID", "Only applied drives can be withdrawn.", 409);
    }

    const drive = await DriveRepository.getDriveById(params.tenantId, params.driveId);
    if (normalizeDriveLifecycle(drive.status) !== "published") {
      throw new AppError("DRIVE_WITHDRAWAL_CLOSED", "This drive is no longer open for withdrawal.", 409);
    }

    await DriveRepository.markDriveWithdrawn(params.tenantId, params.driveId, String(student.id));
    await DriveRepository.recountDriveEligibleCount(params.tenantId, params.driveId);

    await StudentActivityService.logEvent({
      id: `drive-withdraw:${params.driveId}:${String(student.id)}`,
      tenantId: params.tenantId,
      studentId: String(student.id),
      eventType: "drive_applied",
      eventSource: "drive_results",
      entityId: params.driveId,
      entityType: "drive",
      title: "Withdrew from drive",
      description: `Withdrew from ${drive.company}${drive.role ? ` (${drive.role})` : ""}.`,
      metadata: {
        driveId: params.driveId,
        company: drive.company,
        role: drive.role,
        applicationState: "withdrawn",
      },
      impactScore: 12,
      module: "Drives",
    });

    return { driveId: params.driveId, applicationState: "withdrawn" as const };
  },

  async getDashboard(tenantId: string, userId: string) {
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    const studentId = String(student.id);
    const [dashboard, profile, pendingAttempt, resourceRecommendations, curatedMocks] = await Promise.all([
      StudentRepository.getDashboardData(tenantId, studentId),
      StudentRepository.getStudentProfile(tenantId, userId),
      getPendingAttemptSummary(tenantId, studentId),
      this.getRecommendedResources(tenantId, userId, { filter: "all" }),
      MockTestService.getCuratedTests({ tenantId, userId, role: "student" }),
    ]);
    const profileExperience = await buildProfileExperience(profile);
    const nearestDrive = dashboard.upcomingDrives[0] ?? null;
    const daysRemaining = nearestDrive
      ? Math.max(
          0,
          Math.ceil((new Date(nearestDrive.driveDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        )
      : null;
    const featuredDrivePrep = nearestDrive
      ? {
          driveId: nearestDrive.id,
          company: nearestDrive.company,
          role: nearestDrive.role,
          driveDate: nearestDrive.driveDate,
          daysRemaining,
          summary: `${nearestDrive.company}${nearestDrive.role ? ` - ${nearestDrive.role}` : ""} is the nearest upcoming drive, so this is the strongest place to focus next.`,
          mockTests: uniqueById([
            ...(curatedMocks.preDriveBundle?.items ?? []),
            ...curatedMocks.sections.companyPatternPrep,
            ...curatedMocks.sections.placementEssentials,
          ]).slice(0, 3),
          resources: uniqueById([
            ...resourceRecommendations.sections.companyPatternPrep,
            ...resourceRecommendations.sections.interviewPractice,
            ...resourceRecommendations.sections.placementEssentials,
          ]).slice(0, 3),
        }
      : null;

    return {
      ...dashboard,
      readinessBanner: profileExperience.readinessBanner,
      activeBlockers: mapProfileBlockers(profileExperience.liveEligibility.blockers),
      nextBestActions: buildStudentActionFeed({
        profileExperience,
        dashboard,
        pendingAttempt,
        featuredDrivePrep: featuredDrivePrep
          ? {
              driveId: featuredDrivePrep.driveId,
              company: featuredDrivePrep.company,
              role: featuredDrivePrep.role,
              driveDate: featuredDrivePrep.driveDate,
              daysRemaining: featuredDrivePrep.daysRemaining,
            }
          : null,
      }),
      pendingAttempt,
      featuredDrivePrep,
    };
  },

  async logStudyHours(input: LogStudyHoursInput) {
    const student = await StudentRepository.getStudentByUserId(input.tenantId, input.userId);
    const studyDate = input.studyDate ?? new Date().toISOString().slice(0, 10);

    const created = await StudentRepository.createStudyHourEntry({
      tenantId: input.tenantId,
      studentId: String(student.id),
      topicId: input.topicId,
      studyDate,
      hours: input.hours,
    });

    const pointsAwarded = await PointsService.awardStudyHoursPoints({
      tenantId: input.tenantId,
      studentId: String(student.id),
      studyHourId: String(created.row.id),
      hours: input.hours,
    });

    const streak = created.isFirstEntryForDate
      ? await StudentRepository.updateStreak({
          tenantId: input.tenantId,
          studentId: String(student.id),
          studyDate,
        })
      : {
          streakCurrent: Number(student.streak_current ?? 0),
          streakLongest: Number(student.streak_longest ?? 0),
        };

    const topicProgress = await StudentRepository.getTopicProgress(input.tenantId, String(student.id));
    const topicName =
      topicProgress.items.find((item) => item.topicId === input.topicId)?.topicName ?? "a topic";

    await StudentActivityService.logEvent({
      id: `study:${String(created.row.id)}`,
      tenantId: input.tenantId,
      studentId: String(student.id),
      eventType: "study_logged",
      eventSource: "study_hours",
      entityId: String(created.row.id),
      entityType: "study_hour",
      title: "Study hours logged",
      description: `${Number(created.row.hours ?? 0).toFixed(1)} hour(s) logged for ${topicName}.`,
      metadata: {
        topicId: input.topicId,
        topicName,
        studyDate,
        hours: Number(created.row.hours ?? 0),
      },
      impactScore: 35,
      createdAt: `${studyDate}T00:00:00.000Z`,
      module: "Study",
    });

    return {
      studyHourId: String(created.row.id),
      studyDate,
      hours: Number(created.row.hours ?? 0),
      pointsAwarded,
      streak,
    };
  },

  async getLeaderboard(tenantId: string, limit: number, cursor?: string) {
    return StudentRepository.getLeaderboard(tenantId, limit, cursor);
  },

  async getStudyHoursHistory(tenantId: string, userId: string, limit = 30) {
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    return StudentRepository.getStudyHoursHistory(tenantId, String(student.id), limit);
  },

  async getPointsHistory(tenantId: string, userId: string, limit = 20) {
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    return StudentRepository.getPointsHistory(tenantId, String(student.id), limit);
  },

  async getMyProfile(tenantId: string, userId: string) {
    const profile = await StudentRepository.getStudentProfile(tenantId, userId);
    return buildMyProfileResponseWithVisibility(profile);
  },

  async getMyDeclarationStatus(tenantId: string, userId: string) {
    const profile = await StudentRepository.getStudentProfile(tenantId, userId);
    const response = buildMyProfileResponse(profile);

    return {
      declarationStatus: response.declarationStatus,
      warningContent: buildOnboardingWarningContent({
        studentName: String(profile.full_name ?? ""),
      }),
    };
  },

  async acceptOnboardingDeclaration(params: {
    tenantId: string;
    userId: string;
    typedValue: string;
  }) {
    const profile = await StudentRepository.getStudentProfile(params.tenantId, params.userId);
    const response = buildMyProfileResponse(profile);
    const expectedTypedValue = response.declarationStatus.onboarding.expectedTypedValue;

    if (params.typedValue.trim() !== expectedTypedValue) {
      throw new AppError(
        "DECLARATION_CONFIRMATION_MISMATCH",
        `Type ${expectedTypedValue} exactly to continue.`,
        400,
      );
    }

    const now = new Date().toISOString();
    const updated = await StudentRepository.updateStudentProfile({
      tenantId: params.tenantId,
      userId: params.userId,
      profileData: buildDeclarationProfileDataPatch({
        profileData: profile.profile_data,
        declaration: {
          onboardingAcceptedAt: now,
          onboardingVersion: STUDENT_DECLARATION_POLICY_VERSION,
          onboardingTypedValue: params.typedValue.trim(),
        },
      }),
    });

    await StudentActivityService.logEvent({
      tenantId: params.tenantId,
      studentId: String(updated.id),
      eventType: "student_declaration_onboarding_accepted",
      eventSource: "student_declaration",
      entityId: String(updated.id),
      entityType: "student_profile",
      title: "Onboarding declaration accepted",
      description: "Accepted the placement data warning and accountability declaration.",
      metadata: {
        declarationVersion: STUDENT_DECLARATION_POLICY_VERSION,
      },
      impactScore: 8,
      module: "Profile",
    });

    return buildMyProfileResponseWithVisibility(updated);
  },

  async getProfileCertificationPreview(tenantId: string, userId: string) {
    const profile = await StudentRepository.getStudentProfile(tenantId, userId);
    const response = buildMyProfileResponse(profile);

    return {
      profileCompleteness: response.profileCompleteness,
      declarationStatus: response.declarationStatus,
      certificationPreview: buildProfileCertificationPreview({
        student: profile,
        user: {
          full_name: profile.full_name,
          email: profile.college_email,
        },
      }),
      materialFieldLabels: getMaterialProfileFieldLabels(),
    };
  },

  async certifyProfile(params: {
    tenantId: string;
    userId: string;
    typedValue: string;
  }) {
    const profile = await StudentRepository.getStudentProfile(params.tenantId, params.userId);
    const response = buildMyProfileResponse(profile);

    if (!response.profileCompleteness.isComplete) {
      throw new AppError("PROFILE_INCOMPLETE", "Complete all required profile fields before certification.", 409);
    }

    if (params.typedValue.trim().toUpperCase() !== PROFILE_CERTIFICATION_TYPED_VALUE) {
      throw new AppError(
        "DECLARATION_CONFIRMATION_MISMATCH",
        `Type ${PROFILE_CERTIFICATION_TYPED_VALUE} exactly to certify your profile.`,
        400,
      );
    }

    const certificationPreview = buildProfileCertificationPreview({
      student: profile,
      user: {
        full_name: profile.full_name,
        email: profile.college_email,
      },
    });
    const now = new Date().toISOString();
    const updated = await StudentRepository.updateStudentProfile({
      tenantId: params.tenantId,
      userId: params.userId,
      profileData: buildDeclarationProfileDataPatch({
        profileData: {
          ...((profile.profile_data ?? {}) as Record<string, unknown>),
          dataConsentAccepted: true,
          accuracyDeclarationAccepted: true,
        },
        declaration: {
          profileCertifiedAt: now,
          profileCertificationVersion: STUDENT_DECLARATION_POLICY_VERSION,
          profileCertificationTypedValue: PROFILE_CERTIFICATION_TYPED_VALUE,
          profileCertificationSnapshotHash: certificationPreview.snapshotHash,
          profileCertificationInvalidatedAt: null,
          profileCertificationInvalidationReason: null,
          profileEditLockedAt: now,
          profileEditUnlockedAt: null,
          profileEditUnlockedBy: null,
          lastCertifiedProfileAt: now,
        },
      }),
    });

    await StudentActivityService.logEvent({
      tenantId: params.tenantId,
      studentId: String(updated.id),
      eventType: "student_profile_certified",
      eventSource: "student_declaration",
      entityId: String(updated.id),
      entityType: "student_profile",
      title: "Profile certified",
      description: "Certified that placement profile details are accurate and ready for drive use.",
      metadata: {
        declarationVersion: STUDENT_DECLARATION_POLICY_VERSION,
        snapshotHash: certificationPreview.snapshotHash,
      },
      impactScore: 12,
      module: "Profile",
    });

    await resolveApprovedUnlockRequests({
      tenantId: params.tenantId,
      studentId: String(updated.id),
      actorUserId: params.userId,
      note: "Student recertified the profile after the unlock approval.",
    });

    const finalProfile = await StudentRepository.getStudentProfile(params.tenantId, params.userId);
    await publishStudentDriveReadinessNotifications({
      tenantId: params.tenantId,
      userId: params.userId,
      senderId: params.userId,
      beforeProfile: response,
      afterProfile: buildMyProfileResponse(finalProfile),
    });

    return buildMyProfileResponseWithVisibility(finalProfile);
  },

  async getMyProfileUnlockRequest(tenantId: string, userId: string) {
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    return {
      unlockRequest: await getLatestProfileUnlockRequest(tenantId, String(student.id)),
    };
  },

  async requestProfileUnlock(params: {
    tenantId: string;
    userId: string;
    reasonCategory: ProfileUnlockReasonCategory;
    requestedFields?: string[];
    explanation: string;
  }) {
    const db = await getMongoDb();
    const profile = await StudentRepository.getStudentProfile(params.tenantId, params.userId);
    const currentProfileResponse = buildMyProfileResponse(profile);
    if (!currentProfileResponse.declarationStatus.profileCertification.isLocked) {
      throw new AppError("PROFILE_NOT_LOCKED", "Your profile is already editable right now.", 409);
    }

    const existing = await getLatestProfileUnlockRequest(params.tenantId, String(profile.id));
    if (existing?.status === "pending") {
      throw new AppError("PROFILE_UNLOCK_ALREADY_REQUESTED", "An unlock request is already pending review.", 409);
    }

    const now = new Date().toISOString();
    const requestId = randomUUID();
    await db.collection("profile_unlock_requests").insertOne({
      id: requestId,
      tenant_id: params.tenantId,
      student_id: String(profile.id),
      requested_by_user_id: params.userId,
      status: "pending",
      reason_category: params.reasonCategory,
      requested_fields: (params.requestedFields ?? []).slice(0, 10),
      explanation: params.explanation.trim(),
      response_note: null,
      decided_at: null,
      decided_by: null,
      resolved_at: null,
      created_at: now,
      updated_at: now,
    });

    await AuditLogService.log({
      tenantId: params.tenantId,
      actorUserId: params.userId,
      actorRole: "student",
      eventType: "student_support_requested",
      metadata: {
        requestId,
        reasonCategory: params.reasonCategory,
        requestedFields: params.requestedFields ?? [],
        supportType: "profile_unlock_request",
      },
    });

    return this.getMyProfileUnlockRequest(params.tenantId, params.userId);
  },

  async reviewProfileUnlockRequest(params: {
    tenantId: string;
    studentId: string;
    actorUserId: string;
    actorRole: string;
    requestId: string;
    decision: "approved" | "denied";
    responseNote?: string;
  }) {
    const db = await getMongoDb();
    const request = await db.collection("profile_unlock_requests").findOne(
      {
        tenant_id: params.tenantId,
        student_id: params.studentId,
        id: params.requestId,
      },
      { projection: { _id: 0 } },
    );

    if (!request) {
      throw new AppError("PROFILE_UNLOCK_REQUEST_NOT_FOUND", "Unlock request not found.", 404);
    }

    if (String(request.status ?? "pending") !== "pending") {
      throw new AppError("PROFILE_UNLOCK_REQUEST_FINALIZED", "This unlock request has already been reviewed.", 409);
    }

    const student = await db.collection("students").findOne(
      { tenant_id: params.tenantId, id: params.studentId },
      { projection: { _id: 0, id: 1, user_id: 1, profile_data: 1, roll_number: 1, branch: 1, batch: 1, cgpa: 1, backlogs: 1, backlogs_total: 1, attendance_pct: 1, skills: 1 } },
    );

    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student not found for this unlock request.", 404);
    }

    const now = new Date().toISOString();
    if (params.decision === "approved") {
      await db.collection("students").updateOne(
        { tenant_id: params.tenantId, id: params.studentId },
        {
          $set: {
            profile_data: buildDeclarationProfileDataPatch({
              profileData: (student.profile_data ?? {}) as Record<string, unknown>,
              declaration: {
                profileEditUnlockedAt: now,
                profileEditUnlockedBy: params.actorUserId,
                profileCertificationInvalidatedAt: now,
                profileCertificationInvalidationReason: params.responseNote?.trim() || "Profile unlocked for student corrections.",
              },
            }),
          },
        },
      );
    }

    await db.collection("profile_unlock_requests").updateOne(
      { tenant_id: params.tenantId, student_id: params.studentId, id: params.requestId },
      {
        $set: {
          status: params.decision,
          response_note: params.responseNote?.trim() || null,
          decided_at: now,
          decided_by: params.actorUserId,
          updated_at: now,
        },
      },
    );

    await AuditLogService.log({
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      eventType: "student_profile_unlock_reviewed",
      metadata: {
        studentId: params.studentId,
        requestId: params.requestId,
        decision: params.decision,
        responseNote: params.responseNote?.trim() || null,
      },
    });

    await CommunicationService.publishSystemAnnouncementToStudents({
      tenantId: params.tenantId,
      senderId: params.actorUserId,
      studentIds: [params.studentId],
      systemKey: `profile-unlock-review:${params.requestId}`,
      title: params.decision === "approved" ? "Your profile unlock request was approved" : "Your profile unlock request was denied",
      message:
        params.decision === "approved"
          ? `Your placement office approved your unlock request. You can now update the requested profile fields${params.responseNote?.trim() ? `.\n\nNote: ${params.responseNote.trim()}` : "."}`
          : `Your placement office reviewed the unlock request and did not approve it${params.responseNote?.trim() ? `.\n\nNote: ${params.responseNote.trim()}` : "."}`,
      priority: "important",
    });

    return {
      requestId: params.requestId,
      decision: params.decision,
      updatedStudent: await this.getStudentByIdForTpo(params.tenantId, params.studentId),
    };
  },

  async updateMyProfile(params: {
    tenantId: string;
    userId: string;
    skills?: string[];
    prn?: string;
    rollNumber?: string;
    branch?: string;
    batch?: string;
    degree?: string;
    currentSemester?: string;
    cgpa?: number | null;
    activeBacklogs?: number | null;
    totalHistoricalBacklogs?: number | null;
    attendancePct?: number | null;
    phone?: string;
    personalEmail?: string;
    resumeUrl?: string;
    targetRoles?: string[];
    preferredLocations?: string[];
    willingToRelocate?: boolean;
    linkedIn?: string;
    githubUrl?: string;
    portfolioUrl?: string;
    internships?: string;
    projects?: string;
    certifications?: string;
    achievements?: string;
    languages?: string[];
    dataConsentAccepted?: boolean;
    accuracyDeclarationAccepted?: boolean;
  }) {
    const before = await StudentRepository.getStudentProfile(params.tenantId, params.userId);
    const currentProfileResponse = buildMyProfileResponse(before);
    if (currentProfileResponse.declarationStatus.profileCertification.isLocked) {
      throw new AppError(
        "PROFILE_LOCKED",
        "Your certified profile is locked. Contact your placement admin to unlock it before making changes.",
        409,
      );
    }

    const tenant = await MongoAuthRepository.findTenantById(params.tenantId);
    const tenantBranches = normalizeTenantBranches(tenant?.config);
    const nextBranch = params.branch !== undefined ? String(params.branch).trim() : String(before.branch ?? "").trim();
    const normalizedDegree = params.degree !== undefined ? normalizeProfileDegree(params.degree) : undefined;
    const normalizedTargetRoles = params.targetRoles !== undefined ? normalizeProfileTargetRoles(params.targetRoles) : undefined;
    const normalizedPreferredLocations = params.preferredLocations !== undefined ? normalizeProfileLocations(params.preferredLocations) : undefined;
    if (tenantBranches.length > 0 && nextBranch && !tenantBranches.includes(nextBranch)) {
      throw new AppError(
        "BRANCH_NOT_ALLOWED",
        "Select a valid branch from your college branch list.",
        400,
      );
    }

    const previousSemester = normalizeSemesterValue(normalizeStudentProfileData(before.profile_data).currentSemester);
    const nextSemester = params.currentSemester !== undefined
      ? normalizeSemesterValue(params.currentSemester)
      : previousSemester;
    if (
      params.currentSemester !== undefined
      && previousSemester !== null
      && nextSemester !== null
      && nextSemester < previousSemester
    ) {
      throw new AppError(
        "SEMESTER_DECREASE_NOT_ALLOWED",
        "Current semester can stay the same or increase, but it cannot be decreased.",
        400,
      );
    }

    const existingProfileData = normalizeStudentProfileData(before.profile_data);
    const mergedProfileDataBase = {
      ...((before.profile_data ?? {}) as Record<string, unknown>),
      ...(params.prn !== undefined ? { prn: params.prn } : {}),
      ...(params.degree !== undefined ? { degree: normalizedDegree } : {}),
      ...(params.currentSemester !== undefined ? { currentSemester: params.currentSemester } : {}),
      ...(params.totalHistoricalBacklogs !== undefined ? { totalHistoricalBacklogs: params.totalHistoricalBacklogs } : {}),
      ...(params.phone !== undefined ? { phone: params.phone } : {}),
      ...(params.personalEmail !== undefined ? { personalEmail: params.personalEmail } : {}),
      ...(params.resumeUrl !== undefined ? { resumeUrl: params.resumeUrl } : {}),
      ...(params.targetRoles !== undefined ? { targetRoles: normalizedTargetRoles } : {}),
      ...(params.preferredLocations !== undefined ? { preferredLocations: normalizedPreferredLocations } : {}),
      ...(params.willingToRelocate !== undefined ? { willingToRelocate: params.willingToRelocate } : {}),
      ...(params.linkedIn !== undefined ? { linkedIn: params.linkedIn } : {}),
      ...(params.githubUrl !== undefined ? { githubUrl: params.githubUrl } : {}),
      ...(params.portfolioUrl !== undefined ? { portfolioUrl: params.portfolioUrl } : {}),
      ...(params.internships !== undefined ? { internships: params.internships } : {}),
      ...(params.projects !== undefined ? { projects: params.projects } : {}),
      ...(params.certifications !== undefined ? { certifications: params.certifications } : {}),
      ...(params.achievements !== undefined ? { achievements: params.achievements } : {}),
      ...(params.languages !== undefined ? { languages: params.languages } : {}),
      ...(params.dataConsentAccepted !== undefined ? { dataConsentAccepted: params.dataConsentAccepted } : {}),
      ...(params.accuracyDeclarationAccepted !== undefined ? { accuracyDeclarationAccepted: params.accuracyDeclarationAccepted } : {}),
    };
    const materialChanges = getMaterialProfileFieldChanges({
      beforeStudent: {
        rollNumber: before.roll_number,
        branch: before.branch,
        batch: before.batch,
        cgpa: before.cgpa,
        backlogs: before.backlogs,
        backlogs_total: before.backlogs_total,
        attendance_pct: before.attendance_pct,
        profile_data: before.profile_data,
      },
      afterStudent: {
        rollNumber: params.rollNumber !== undefined ? params.rollNumber : before.roll_number,
        branch: params.branch !== undefined ? params.branch : before.branch,
        batch: params.batch !== undefined ? params.batch : before.batch,
        cgpa: params.cgpa !== undefined ? params.cgpa : before.cgpa,
        backlogs: params.activeBacklogs !== undefined ? params.activeBacklogs : before.backlogs,
        backlogs_total: params.totalHistoricalBacklogs !== undefined ? params.totalHistoricalBacklogs : before.backlogs_total,
        attendance_pct: params.attendancePct !== undefined ? params.attendancePct : before.attendance_pct,
        profile_data: mergedProfileDataBase,
      },
    });
    const mergedProfileData = mergedProfileDataBase;
    const updatedProfile = await StudentRepository.updateStudentProfile({
      tenantId: params.tenantId,
      userId: params.userId,
      skills: params.skills,
      cgpa: params.cgpa,
      activeBacklogs: params.activeBacklogs,
      totalHistoricalBacklogs: params.totalHistoricalBacklogs,
      attendancePct: params.attendancePct,
      rollNumber: params.rollNumber,
      branch: params.branch,
      batch: params.batch,
      profileData: mergedProfileData,
    });

    const changedFields = [
      params.skills !== undefined ? "skills" : null,
      params.prn !== undefined ? "PRN" : null,
      params.rollNumber !== undefined ? "roll number" : null,
      params.branch !== undefined ? "branch" : null,
      params.batch !== undefined ? "batch" : null,
      params.degree !== undefined ? "degree" : null,
      params.currentSemester !== undefined ? "current semester" : null,
      params.cgpa !== undefined ? "CGPA" : null,
      params.activeBacklogs !== undefined ? "active backlogs" : null,
      params.totalHistoricalBacklogs !== undefined ? "total historical backlogs" : null,
      params.attendancePct !== undefined ? "attendance" : null,
      params.phone !== undefined ? "phone number" : null,
      params.personalEmail !== undefined ? "personal email" : null,
      params.resumeUrl !== undefined ? "resume link" : null,
      params.targetRoles !== undefined ? "target roles" : null,
      params.preferredLocations !== undefined ? "preferred locations" : null,
      params.willingToRelocate !== undefined ? "relocation preference" : null,
      params.linkedIn !== undefined ? "linkedin link" : null,
      params.githubUrl !== undefined ? "github link" : null,
      params.portfolioUrl !== undefined ? "portfolio link" : null,
      params.internships !== undefined ? "internship summary" : null,
      params.projects !== undefined ? "project summary" : null,
      params.certifications !== undefined ? "certifications" : null,
      params.achievements !== undefined ? "achievements" : null,
      params.languages !== undefined ? "languages" : null,
      params.dataConsentAccepted !== undefined ? "privacy consent" : null,
      params.accuracyDeclarationAccepted !== undefined ? "accuracy declaration" : null,
    ].filter((value): value is string => Boolean(value));

    await StudentActivityService.logEvent({
      tenantId: params.tenantId,
      studentId: String(updatedProfile.id),
      eventType: "profile_updated",
      eventSource: "student_profile",
      entityId: String(updatedProfile.id),
      entityType: "student_profile",
      title: "Profile updated",
      description:
        changedFields.length > 0
          ? `Updated ${changedFields.join(", ")}.`
          : "Updated student profile information.",
      metadata: {
        changedFields,
        previousSkillsCount: Array.isArray(before.skills) ? before.skills.length : 0,
        currentSkillsCount: Array.isArray(updatedProfile.skills) ? updatedProfile.skills.length : 0,
        previousResumePresent: hasResumeOnProfile(existingProfileData),
        currentResumePresent: hasResumeOnProfile(normalizeStudentProfileData(updatedProfile.profile_data)),
      },
      impactScore: 32,
      module: "Profile",
    });

    await resolveApprovedUnlockRequests({
      tenantId: params.tenantId,
      studentId: String(updatedProfile.id),
      actorUserId: params.userId,
      note: "Student updated the profile after the unlock approval.",
    });

    const finalProfile = await StudentRepository.getStudentProfile(params.tenantId, params.userId);
    await publishStudentDriveReadinessNotifications({
      tenantId: params.tenantId,
      userId: params.userId,
      senderId: params.userId,
      beforeProfile: currentProfileResponse,
      afterProfile: buildMyProfileResponse(finalProfile),
    });

    return buildMyProfileResponseWithVisibility(finalProfile);
  },

  async uploadMyResume(params: {
    tenantId: string;
    userId: string;
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    };
  }) {
    const profile = await StudentRepository.getStudentProfile(params.tenantId, params.userId);
    const currentProfileResponse = buildMyProfileResponse(profile);
    if (currentProfileResponse.declarationStatus.profileCertification.isLocked) {
      throw new AppError(
        "PROFILE_LOCKED",
        "Your certified profile is locked. Contact your placement admin to unlock it before uploading a new resume.",
        409,
      );
    }

    const mimeType = String(params.file.mimetype ?? "").toLowerCase();
    const originalName = String(params.file.originalname ?? "").trim();
    const isPdf = mimeType.includes("pdf") || originalName.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      throw new AppError("RESUME_FILE_INVALID", "Upload a PDF resume file.", 400);
    }
    if (params.file.size > 3 * 1024 * 1024) {
      throw new AppError("RESUME_FILE_TOO_LARGE", "Keep the resume PDF under 3 MB for now.", 400);
    }

    const currentProfile = normalizeStudentProfileData(profile.profile_data);
    const uploadedResume = await GoogleDriveResumeService.uploadCurrentResume({
      tenantId: params.tenantId,
      studentId: String(profile.id),
      fullName: String(profile.full_name ?? "student"),
      originalFilename: originalName || "resume.pdf",
      buffer: params.file.buffer,
      mimeType: "application/pdf",
      previousFileId: currentProfile.resumeDriveFileId || null,
    });

    const updatedProfile = await StudentRepository.updateStudentProfile({
      tenantId: params.tenantId,
      userId: params.userId,
      profileData: {
        ...((profile.profile_data ?? {}) as Record<string, unknown>),
        resumeStorageProvider: uploadedResume.provider,
        resumeDriveFileId: uploadedResume.fileId,
        resumeDriveWebLink: uploadedResume.webViewLink,
        resumeFilename: uploadedResume.filename,
        resumeMimeType: uploadedResume.mimeType,
        resumeSizeBytes: uploadedResume.sizeBytes,
        resumeUploadedAt: uploadedResume.uploadedAt,
        resumeUrl: uploadedResume.webViewLink,
      },
    });

    await StudentActivityService.logEvent({
      tenantId: params.tenantId,
      studentId: String(updatedProfile.id),
      eventType: "profile_updated",
      eventSource: "student_profile",
      entityId: String(updatedProfile.id),
      entityType: "student_profile",
      title: "Resume uploaded",
      description: "Uploaded a managed resume for drive applications.",
      metadata: {
        resumeStorageProvider: uploadedResume.provider,
        resumeFilename: uploadedResume.filename,
        resumeSizeBytes: uploadedResume.sizeBytes,
      },
      impactScore: 20,
      module: "Profile",
    });

    await resolveApprovedUnlockRequests({
      tenantId: params.tenantId,
      studentId: String(updatedProfile.id),
      actorUserId: params.userId,
      note: "Student uploaded a new resume after the unlock approval.",
    });

    const finalProfile = await StudentRepository.getStudentProfile(params.tenantId, params.userId);
    await publishStudentDriveReadinessNotifications({
      tenantId: params.tenantId,
      userId: params.userId,
      senderId: params.userId,
      beforeProfile: currentProfileResponse,
      afterProfile: buildMyProfileResponse(finalProfile),
    });

    return buildMyProfileResponseWithVisibility(finalProfile);
  },

  async getMastery(tenantId: string, userId: string) {
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    return StudentRepository.getMastery(tenantId, String(student.id));
  },

  async getTopicProgress(tenantId: string, userId: string) {
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    return StudentRepository.getTopicProgress(tenantId, String(student.id));
  },

  async updateTopicProgress(input: {
    tenantId: string;
    userId: string;
    topicId: string;
    status: TopicProgressStatus;
  }) {
    const student = await StudentRepository.getStudentByUserId(input.tenantId, input.userId);
    const updated = await StudentRepository.upsertTopicProgress({
      tenantId: input.tenantId,
      studentId: String(student.id),
      topicId: input.topicId,
      status: input.status,
    });

    if (input.status === "in_progress" || input.status === "complete") {
      await StudentActivityService.logEvent({
        id: `progress:${String(student.id)}:${input.topicId}:${input.status}`,
        tenantId: input.tenantId,
        studentId: String(student.id),
        eventType: input.status === "complete" ? "topic_completed" : "topic_started",
        eventSource: "student_topic_progress",
        entityId: input.topicId,
        entityType: "topic_progress",
        title: input.status === "complete" ? "Topic completed" : "Topic started",
        description: `${updated.topicName} marked as ${input.status.replace("_", " ")}.`,
        metadata: {
          topicId: input.topicId,
          topicName: updated.topicName,
          status: input.status,
        },
        impactScore: input.status === "complete" ? 70 : 30,
        createdAt: updated.completedAt ?? updated.updatedAt ?? new Date().toISOString(),
        module: "Study",
      });
    }

    return updated;
  },

  async updateTopicProgressBulk(input: {
    tenantId: string;
    userId: string;
    topicIds: string[];
    status: TopicProgressStatus;
  }) {
    const student = await StudentRepository.getStudentByUserId(input.tenantId, input.userId);
    const result = await StudentRepository.upsertTopicProgressBulk({
      tenantId: input.tenantId,
      studentId: String(student.id),
      topicIds: input.topicIds,
      status: input.status,
    });

    if ((input.status === "in_progress" || input.status === "complete") && result.updatedCount > 0) {
      const db = await getMongoDb();
      const topics = await db.collection("topics").find(
        {
          id: { $in: input.topicIds },
          $or: [{ tenant_id: input.tenantId }, { tenant_id: null }],
        },
        { projection: { _id: 0, id: 1, name: 1 } },
      ).toArray();
      const topicMap = new Map(topics.map((topic) => [String(topic.id), String(topic.name ?? "Topic")]));

      await StudentActivityService.logEvents(
        input.topicIds
          .filter((topicId) => !result.invalidTopicIds.includes(topicId))
          .map((topicId) => ({
            id: `progress:${String(student.id)}:${topicId}:${input.status}`,
            tenantId: input.tenantId,
            studentId: String(student.id),
            eventType: input.status === "complete" ? "topic_completed" : "topic_started",
            eventSource: "student_topic_progress",
            entityId: topicId,
            entityType: "topic_progress",
            title: input.status === "complete" ? "Topic completed" : "Topic started",
            description: `${topicMap.get(topicId) ?? "Topic"} marked as ${input.status.replace("_", " ")}.`,
            metadata: {
              topicId,
              topicName: topicMap.get(topicId) ?? "Topic",
              status: input.status,
            },
            impactScore: input.status === "complete" ? 70 : 30,
            createdAt: result.updatedAt,
            module: "Study",
          })),
      );
    }

    return result;
  },

  async getVaultCompanies(tenantId: string) {
    return StudentRepository.getVaultCompanies(tenantId);
  },

  async getVaultByCompany(tenantId: string, userId: string, companyId: string) {
    return StudentRepository.getVaultByCompany(tenantId, userId, companyId);
  },

  async getResources(tenantId: string, userId: string, topicId?: string) {
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    return StudentRepository.getResources(tenantId, topicId, String(student.branch ?? ""));
  },

  async getResourcesPage(
    tenantId: string,
    userId: string,
    params?: {
      topicId?: string;
      limit?: number;
      cursor?: string;
      filter?: "all" | "pdf" | "notes" | "guide" | "notebook" | "external";
    },
  ) {
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    return StudentRepository.getResourcesPage(tenantId, {
      ...params,
      branch: String(student.branch ?? ""),
    });
  },

  async getRecommendedResources(
    tenantId: string,
    userId: string,
    params?: {
      filter?: ResourceListFilter;
      limitPerSection?: number;
    },
  ) {
    const db = await getMongoDb();
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    const dashboard = await StudentRepository.getDashboardData(tenantId, String(student.id));
    const profileData = normalizeStudentProfileData(student.profile_data);
    const allResources = await StudentRepository.getResources(tenantId, undefined, String(student.branch ?? ""));
    const filter = params?.filter ?? "all";
    const limitPerSection = Math.max(4, Math.min(params?.limitPerSection ?? 8, 12));
    const resources = allResources.filter((resource) => matchesResourceFilterForRecommendation(resource, filter));
    const resourceIds = resources.map((resource) => resource.id);
    const recentThreshold = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const canonicalBranch = getCanonicalBranchCode(String(student.branch ?? ""));
    const [popularityRows, activeBranchMockCount] = await Promise.all([
      resourceIds.length > 0
        ? db.collection("resource_view_events").aggregate([
            {
              $match: {
                tenant_id: tenantId,
                event_type: "open",
                resource_id: { $in: resourceIds },
                created_at: { $gte: recentThreshold },
              },
            },
            {
              $group: {
                _id: "$resource_id",
                count: { $sum: 1 },
              },
            },
          ]).toArray()
        : Promise.resolve([]),
      canonicalBranch
        ? db.collection("mock_tests").countDocuments({
            is_active: true,
            $or: [{ tenant_id: tenantId }, { tenant_id: null }],
            primary_branches: canonicalBranch,
          })
        : Promise.resolve(0),
    ]);
    const popularityMap = new Map(popularityRows.map((row) => [String(row._id), Number(row.count ?? 0)]));

    const scoredResources = resources
      .map((resource) => scoreRecommendedResource(resource, {
        branch: String(student.branch ?? ""),
        branchTrackLabel: dashboard.branchTrack.label,
        branchFocusAreas: dashboard.branchTrack.focusAreas,
        weakAreas: dashboard.weakAreas,
        upcomingDrives: dashboard.upcomingDrives,
        targetRoles: profileData.targetRoles,
        recentResources: dashboard.resourceUsage.recentResources,
      }, popularityMap))
      .sort((left, right) => right.recommendationScore - left.recommendationScore);

    const bestForYouNow = selectRecommendedResources(scoredResources, () => true, limitPerSection, "best_for_you_now");
    const fixYourWeakAreas = selectRecommendedResources(scoredResources, (item) => item.recommendationFlags.weakTopicMatch, limitPerSection, "fix_weak_areas");
    const branchCore = selectRecommendedResources(scoredResources, (item) => item.recommendationFlags.branchMatch, limitPerSection, "branch_core");
    const placementEssentials = selectPlacementEssentials(scoredResources, limitPerSection);
    const companyPatternPrep = selectCompanyPatternPrep(scoredResources, limitPerSection);
    const interviewPractice = selectInterviewPractice(scoredResources, limitPerSection);
    const targetRoleBoost = selectTargetRoleBoost(scoredResources, profileData.targetRoles, Math.max(4, Math.floor(limitPerSection / 2)));
    const branchPacks = buildBranchResourcePacks({
      scoredResources,
      branchCode: canonicalBranch,
      limitPerPack: Math.min(4, limitPerSection),
    });
    const branchResourceCount = canonicalBranch ? countBranchTaggedResources(resources, canonicalBranch) : 0;
    const branchCoverageQualified = canonicalBranch
      ? branchResourceCount >= 10 && activeBranchMockCount >= 5 && branchPacks.length >= 1
      : false;
    const forYourBranch = uniqueById([
      ...branchCore,
      ...targetRoleBoost,
    ]).slice(0, limitPerSection);
    const usedIds = new Set([
      ...bestForYouNow,
      ...forYourBranch,
      ...placementEssentials,
      ...companyPatternPrep,
      ...interviewPractice,
      ...fixYourWeakAreas,
    ].map((item) => item.id));
    const exploreMore = uniqueById(
      scoredResources
        .filter((item) => !usedIds.has(item.id))
        .slice(0, Math.max(limitPerSection, 12))
        .map((item) => ({
          ...item,
          recommendationBucket: "explore_more",
        })),
    );

    const stripFlags = (
      items: ScoredRecommendedResourceItem[],
    ) => items.map(({ recommendationFlags: _ignored, ...item }) => item);

    return {
      context: {
        branch: String(student.branch ?? ""),
        canonicalBranch,
        branchTrackLabel: dashboard.branchTrack.label,
        targetRoles: profileData.targetRoles,
        branchCoverageQualified,
        branchCoverage: {
          branchTaggedResources: branchResourceCount,
          branchTaggedMockTests: activeBranchMockCount,
          branchPackCount: branchPacks.length,
        },
        upcomingDrives: dashboard.upcomingDrives.slice(0, 3).map((drive) => ({
          company: drive.company,
          role: drive.role,
          driveDate: drive.driveDate,
        })),
      },
      sections: {
        bestForYouNow: stripFlags(bestForYouNow),
        fixYourWeakAreas: stripFlags(fixYourWeakAreas),
        forYourBranch: stripFlags(forYourBranch),
        placementEssentials: stripFlags(placementEssentials),
        companyPatternPrep: stripFlags(companyPatternPrep),
        interviewPractice: stripFlags(interviewPractice),
        exploreMore: stripFlags(exploreMore),
      },
      packs: branchPacks.map((pack) => ({
        ...pack,
        items: stripFlags(pack.items as ScoredRecommendedResourceItem[]),
      })),
    };
  },

  async getResourceById(tenantId: string, resourceId: string) {
    return StudentRepository.getResourceById(tenantId, resourceId);
  },

  async listTopics(tenantId: string, query?: string, limit = 20) {
    return StudentRepository.listTopics(tenantId, query, limit);
  },

  async searchStudyContent(tenantId: string, userId: string, topicQuery: string) {
    const db = await getMongoDb();
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);
    const dashboard = await StudentRepository.getDashboardData(tenantId, String(student.id));
    const profileData = normalizeStudentProfileData(student.profile_data);
    const result = await StudentRepository.searchResourcesByTopicName(
      tenantId,
      topicQuery,
      String(student.branch ?? ""),
    );
    const youtubeVideos = await fetchYouTubeSuggestions(topicQuery);
    const rankedResources = await rankResourcesByPdfContent(
      result.resources as Array<Record<string, unknown>>,
      topicQuery,
      result.matchedTopics.map((topic) => topic.name),
    );
    const pdfFirst = rankedResources.filter((resource) => String(resource.resourceType ?? "").toLowerCase() === "pdf");
    const candidateResources = pdfFirst.length > 0 ? pdfFirst : rankedResources;
    const maxScore = candidateResources.reduce(
      (max, resource) => Math.max(max, Number(resource.relevanceScore ?? 0)),
      0,
    );
    const strongThreshold = Math.max(12, Math.floor(maxScore * 0.28));
    const positiveScore = candidateResources.filter((resource) => Number(resource.relevanceScore ?? 0) > 0);
    const strongMatches = candidateResources.filter(
      (resource) => Number(resource.relevanceScore ?? 0) >= strongThreshold,
    );

    const popularityRows = rankedResources.length > 0
      ? await db.collection("resource_view_events").aggregate([
          {
            $match: {
              tenant_id: tenantId,
              event_type: "open",
              resource_id: { $in: rankedResources.map((resource) => String(resource.id)) },
              created_at: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() },
            },
          },
          { $group: { _id: "$resource_id", count: { $sum: 1 } } },
        ]).toArray()
      : [];
    const popularityMap = new Map(popularityRows.map((row) => [String(row._id), Number(row.count ?? 0)]));
    const scoredRankedResources = rankedResources
      .map((resource) => {
        const recommendation = scoreRecommendedResource(resource as StudentResourceItem, {
          branch: String(student.branch ?? ""),
          branchTrackLabel: dashboard.branchTrack.label,
          branchFocusAreas: dashboard.branchTrack.focusAreas,
          weakAreas: dashboard.weakAreas,
          upcomingDrives: dashboard.upcomingDrives,
          targetRoles: profileData.targetRoles,
          recentResources: dashboard.resourceUsage.recentResources,
        }, popularityMap);
        return {
          ...(resource as StudentResourceItem & {
            relevanceScore?: number;
            matchSource?: "pdf_content" | "metadata" | "reference";
            matchSnippet?: string | null;
          }),
          ...recommendation,
          recommendationBucket: "search",
        };
      })
      .sort((left, right) => {
        const relevanceDelta = Number(right.relevanceScore ?? 0) - Number(left.relevanceScore ?? 0);
        if (relevanceDelta !== 0) return relevanceDelta;
        return right.recommendationScore - left.recommendationScore;
      });

    const finalResources = (() => {
      const strongRecommended = scoredRankedResources.filter(
        (resource) => Number(resource.relevanceScore ?? 0) >= strongThreshold,
      );
      const positiveRecommended = scoredRankedResources.filter(
        (resource) => Number(resource.relevanceScore ?? 0) > 0,
      );
      if (strongRecommended.length > 0) {
        return strongRecommended.slice(0, 120);
      }
      if (positiveRecommended.length > 0) {
        return positiveRecommended.slice(0, 80);
      }
      return scoredRankedResources.slice(0, 80);
    })();

    return {
      query: result.query,
      matchedTopics: result.matchedTopics,
      resources: finalResources,
      youtubeVideos,
    };
  },

  async recordResourceViewEvent(input: {
    tenantId: string;
    userId: string;
    resourceId: string;
    eventType: string;
    sessionId: string;
    durationSec?: number;
    progressPct?: number;
    pageNumber?: number;
    scrollDepthPct?: number;
    sourceContext?: string;
    metadata?: Record<string, unknown>;
  }) {
    const [student, resource] = await Promise.all([
      StudentRepository.getStudentByUserId(input.tenantId, input.userId),
      StudentRepository.getResourceById(input.tenantId, input.resourceId),
    ]);

    if (!resource) {
      throw new AppError("RESOURCE_NOT_FOUND", "Resource not found", 404);
    }

    await StudentRepository.recordResourceViewEvent({
      tenantId: input.tenantId,
      studentId: String(student.id),
      resourceId: input.resourceId,
      eventType: input.eventType,
      sessionId: input.sessionId,
      durationSec: input.durationSec,
      progressPct: input.progressPct,
      pageNumber: input.pageNumber,
      scrollDepthPct: input.scrollDepthPct,
      sourceContext: input.sourceContext,
      metadata: {
        resourceTitle: String(resource.title ?? ""),
        resourceType: String(resource.resourceType ?? ""),
        ...(input.metadata ?? {}),
      },
    });

    if (input.eventType === "open" || input.eventType === "external_redirect") {
      await StudentActivityService.logEvent({
        tenantId: input.tenantId,
        studentId: String(student.id),
        eventType: input.eventType === "open" ? "resource_opened" : "resource_external_redirect",
        eventSource: "resource_viewer",
        entityId: input.resourceId,
        entityType: "resource",
        title: input.eventType === "open" ? "Opened learning resource" : "Opened external learning resource",
        description: input.eventType === "open"
          ? `Viewed ${String(resource.title ?? "resource")}.`
          : `Opened external resource ${String(resource.title ?? "resource")}.`,
        impactScore: input.eventType === "open" ? 28 : 18,
        module: "Resources",
        metadata: {
          resourceTitle: String(resource.title ?? ""),
          resourceType: String(resource.resourceType ?? ""),
          sessionId: input.sessionId,
          sourceContext: input.sourceContext ?? "resource_library",
        },
      });
    }

    return { ok: true };
  },

  async listStudentsForTpo(
    tenantId: string,
    params: {
      limit: number;
      cursor?: string;
      q?: string;
      batch?: string;
      branch?: string;
      prn?: string;
      cgpaMin?: number;
      cgpaMax?: number;
      readinessMin?: number;
      readinessMax?: number;
      attendanceMin?: number;
      attendanceMax?: number;
      backlogsMin?: number;
      backlogsMax?: number;
      totalHistoricalBacklogsMin?: number;
      totalHistoricalBacklogsMax?: number;
      profileCompletenessMin?: number;
      profileCompletenessMax?: number;
      missingResume?: boolean;
      waitingOnStudent?: boolean;
      waitingOnCollege?: boolean;
      canAccessResources?: boolean;
      canAccessMockTests?: boolean;
      targetRole?: string;
      preferredLocation?: string;
      willingToRelocate?: boolean;
      eligibleForUpcomingDrive?: boolean;
      isCertified?: boolean;
      hasResume?: boolean;
      isPlaced?: boolean;
      isActive7d?: boolean;
      appliedRecently?: boolean;
      needsIntervention?: boolean;
      sortBy: "cgpa" | "created_at" | "readiness_score" | "profile_completeness" | "risk_score" | "upcoming_drive_impact" | "activity";
      sortDir: "asc" | "desc";
    },
  ) {
    return StudentRepository.listStudentsForTpo(tenantId, params);
  },

  async getStudentByIdForTpo(tenantId: string, studentId: string) {
    const detail = await StudentRepository.getStudentByIdForTpo(tenantId, studentId);
    const driveDeclarations = await StudentRepository.listStudentDriveDeclarations(tenantId, studentId);
    const unlockRequest = await getLatestProfileUnlockRequest(tenantId, studentId);
    const driveDeclarationMap = new Map(driveDeclarations.map((item) => [item.driveId, item]));
    const summary = buildStudentProfileSummary({
      student: {
        roll_number: detail.rollNumber,
        branch: detail.branch,
        batch: detail.batch,
        cgpa: detail.cgpa,
        backlogs: detail.backlogs,
        backlogs_total: detail.totalHistoricalBacklogs,
        attendance_pct: detail.attendancePct,
        skills: detail.skills,
        profile_data: detail.profileData,
      },
      user: {
        full_name: detail.fullName,
        email: detail.email,
      },
    });
    const declarationStatus = buildStudentDeclarationStatus({
      student: {
        roll_number: detail.rollNumber,
        branch: detail.branch,
        batch: detail.batch,
        cgpa: detail.cgpa,
        backlogs: detail.backlogs,
        backlogs_total: detail.totalHistoricalBacklogs,
        attendance_pct: detail.attendancePct,
        skills: detail.skills,
        profile_data: detail.profileData,
      },
      user: {
        full_name: detail.fullName,
        email: detail.email,
      },
    });

    return {
      ...detail,
      profileCompletenessPct: summary.profileCompleteness.pct,
      declarationStatus: {
        ...declarationStatus,
        profileCertification: {
          ...declarationStatus.profileCertification,
          isCompleteButUncertified: summary.profileCompleteness.isComplete && !declarationStatus.profileCertification.isCertified,
        },
      },
      missingRequiredFields: summary.missingRequiredFields,
      missingStudentFields: summary.missingStudentFields,
      pendingCollegeFields: summary.pendingCollegeFields,
      unlockRequest,
      driveParticipation: detail.driveParticipation.map((entry) => ({
        ...entry,
        declarationAcceptedAt: driveDeclarationMap.get(entry.driveId)?.acceptedAt ?? null,
        declarationVersion: driveDeclarationMap.get(entry.driveId)?.declarationVersion ?? null,
      })),
    };
  },

  async updateStudentAcademicForTpo(
    tenantId: string,
    studentId: string,
    updates: {
      cgpa?: number;
      backlogs?: number;
      totalHistoricalBacklogs?: number;
      attendancePct?: number;
      rollNumber?: string;
      prn?: string;
      degree?: string;
      currentSemester?: string;
      branch?: string;
      batch?: string;
    },
  ) {
    return StudentRepository.updateStudentAcademicForTpo(tenantId, studentId, updates);
  },

  async reviewPlacementStatus(params: {
    tenantId: string;
    studentId: string;
    actorUserId: string;
    actorRole: string;
    isPlaced: boolean;
    placedCompany?: string | null;
    placedRole?: string | null;
    placedPackageLpa?: number | null;
    sourceDriveId?: string | null;
    reason: string;
  }) {
    const updatedPlacementStatus = await StudentRepository.reviewPlacementStatus(params);
    await AuditLogService.log({
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      eventType: "student_placement_status_reviewed",
      metadata: {
        studentId: params.studentId,
        isPlaced: params.isPlaced,
        placedCompany: params.placedCompany ?? null,
        placedRole: params.placedRole ?? null,
        sourceDriveId: params.sourceDriveId ?? null,
        reason: params.reason,
      },
    });

    return {
      placementStatus: updatedPlacementStatus,
      updatedStudent: await this.getStudentByIdForTpo(params.tenantId, params.studentId),
    };
  },

  parseCsvPreview(csv: string) {
    const lines = csv
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0);

    if (lines.length < 2) {
      return {
        headers: [] as string[],
        rows: [] as Array<Record<string, string>>,
        mapping: null as null | Record<string, string>,
        errors: [{ row: 0, message: "CSV must include header and at least one row" }],
      };
    }

    const headers = parseCsvLine(lines[0]).map((value) => value.trim());
    const normalized = headers.map((header) => normalizeHeader(header));

    const rows = lines.slice(1).map((line) => {
      const values = parseCsvLine(line).map((value) => value.trim());
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] ?? "";
      });
      return row;
    });

    const pick = (aliases: string[]) => {
      const aliasSet = new Set(aliases.map((alias) => normalizeHeader(alias)));
      const foundIndex = normalized.findIndex((value) => aliasSet.has(value));
      return foundIndex >= 0 ? headers[foundIndex] : "";
    };

    const mapping = {
      fullName: pick(["full_name", "fullname", "name"]),
      email: pick(["email", "email_id"]),
      prn: pick(["prn", "prn_number", "registration_number", "registrationnumber"]),
      rollNumber: pick(["roll_number", "rollnumber", "roll_no", "rollno"]),
      degree: pick(["degree", "program", "course"]),
      branch: pick(["branch", "department"]),
      batch: pick(["batch", "graduation_year", "grad_year"]),
      currentSemester: pick(["current_semester", "semester", "current_year"]),
      cgpa: pick(["cgpa", "gpa"]),
      backlogs: pick(["backlogs", "backlog"]),
      totalHistoricalBacklogs: pick(["total_historical_backlogs", "total_backlogs", "backlogs_total"]),
      attendancePct: pick(["attendance_pct", "attendance", "attendance_percentage"]),
    };

    const errors: Array<{ row: number; message: string }> = [];

    if (!mapping.fullName || !mapping.email || !mapping.rollNumber || !mapping.branch || !mapping.batch) {
      errors.push({
        row: 1,
        message: "Missing required columns. Required: fullName, email, rollNumber, branch, batch",
      });
    }

    rows.forEach((row, index) => {
      const rowErrors: Array<{ row: number; message: string }> = [];
      const rowNumber = index + 2;

      if (mapping.fullName && !row[mapping.fullName]) rowErrors.push({ row: rowNumber, message: "fullName missing" });
      if (mapping.email && !row[mapping.email]) rowErrors.push({ row: rowNumber, message: "email missing" });
      if (mapping.rollNumber && !row[mapping.rollNumber]) rowErrors.push({ row: rowNumber, message: "rollNumber missing" });
      if (mapping.branch && !row[mapping.branch]) rowErrors.push({ row: rowNumber, message: "branch missing" });
      if (mapping.batch && !row[mapping.batch]) rowErrors.push({ row: rowNumber, message: "batch missing" });

      if (mapping.cgpa && row[mapping.cgpa]) {
        const cgpa = Number(row[mapping.cgpa]);
        if (!Number.isFinite(cgpa) || cgpa < 0 || cgpa > 10) {
          rowErrors.push({ row: rowNumber, message: "cgpa must be a number between 0 and 10" });
        }
      }

      if (mapping.backlogs && row[mapping.backlogs]) {
        const backlogs = Number(row[mapping.backlogs]);
        if (!Number.isFinite(backlogs) || backlogs < 0) {
          rowErrors.push({ row: rowNumber, message: "backlogs must be a non-negative number" });
        }
      }

      if (mapping.totalHistoricalBacklogs && row[mapping.totalHistoricalBacklogs]) {
        const totalHistoricalBacklogs = Number(row[mapping.totalHistoricalBacklogs]);
        if (!Number.isFinite(totalHistoricalBacklogs) || totalHistoricalBacklogs < 0) {
          rowErrors.push({ row: rowNumber, message: "totalHistoricalBacklogs must be a non-negative number" });
        }
      }

      if (mapping.attendancePct && row[mapping.attendancePct]) {
        const attendancePct = Number(row[mapping.attendancePct]);
        if (!Number.isFinite(attendancePct) || attendancePct < 0 || attendancePct > 100) {
          rowErrors.push({ row: rowNumber, message: "attendancePct must be a number between 0 and 100" });
        }
      }

      errors.push(...rowErrors);
    });

    return {
      headers,
      rows,
      mapping,
      errors,
    };
  },

  async confirmCsvUpload(
    tenantId: string,
    payload: {
      mapping: {
        fullName: string;
        email: string;
        prn?: string;
        rollNumber: string;
        degree?: string;
        branch: string;
        batch: string;
        currentSemester?: string;
        cgpa?: string;
        backlogs?: string;
        totalHistoricalBacklogs?: string;
        attendancePct?: string;
      };
      rows: Array<Record<string, string>>;
    },
  ) {
    return StudentRepository.upsertStudentsFromCsv(tenantId, payload.rows, payload.mapping);
  },
};
