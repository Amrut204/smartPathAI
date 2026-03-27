import fs from "node:fs";
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
import { DriveRepository } from "../repositories/drive.repository.js";
import { PointsService } from "./points.service.js";
import { StudentActivityService } from "./student-activity.service.js";
import { evaluateStudentEligibility, ELIGIBILITY_REASON_LABELS } from "./eligibility.logic.js";

interface LogStudyHoursInput {
  tenantId: string;
  userId: string;
  topicId: string;
  studyDate?: string;
  hours: number;
}

type TopicProgressStatus = "incomplete" | "in_progress" | "complete";

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
    requiredFields: summary.requiredFields,
    missingRequiredFields: summary.missingRequiredFields,
    missingSeededFields: summary.missingSeededFields,
    missingStudentFields: summary.missingStudentFields,
    pendingCollegeFields: summary.pendingCollegeFields,
    recommendedFields: summary.recommendedFields,
    canAccessResources: summary.canAccessResources,
    canAccessMockTests: summary.canAccessMockTests,
  };
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

function selectRecommendedResources(
  items: Array<RecommendedResourceItem & {
    recommendationFlags: {
      weakTopicMatch: boolean;
      branchMatch: boolean;
      upcomingDriveMatch: boolean;
      continueLearningMatch: boolean;
    };
  }>,
  predicate: (item: RecommendedResourceItem & { recommendationFlags: { weakTopicMatch: boolean; branchMatch: boolean; upcomingDriveMatch: boolean; continueLearningMatch: boolean } }) => boolean,
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
    const eligibleUpcomingDrives = upcomingDrives.filter((drive) =>
      evaluateStudentEligibility(
        {
          cgpa: Number(student.cgpa ?? 0),
          activeBacklogs: Number(student.backlogs ?? 0),
          totalBacklogs: Number((student as unknown as { backlogs_total?: unknown }).backlogs_total ?? 0),
          branch: String(student.branch ?? ""),
          attendancePct: Number(student.attendance_pct ?? 0),
        },
        (drive.criteria ?? {}) as {
          minCgpa?: number;
          maxBacklogs?: number;
          maxActiveBacklogs?: number;
          maxTotalBacklogs?: number;
          branches?: string[];
          minAttendance?: number;
          excludePlacedStudents?: boolean;
        },
      ).eligible,
    ).length;

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
    const drives = await db.collection("drives").find(
      { tenant_id: tenantId, deleted_at: null },
      { projection: { _id: 0, id: 1, company: 1, role: 1, drive_date: 1, criteria: 1, status: 1, eligible_count: 1 } },
    ).sort({ drive_date: 1 }).toArray();

    const driveIds = drives.map((drive) => String(drive.id));
    const results = driveIds.length > 0
      ? await db.collection("drive_results").find(
          { tenant_id: tenantId, student_id: student.id, drive_id: { $in: driveIds } },
          { projection: { _id: 0, drive_id: 1, status: 1, outcome: 1, remarks: 1, result_released_at: 1, offer_letter_url: 1, offer_letter_reference: 1 } },
        ).toArray()
      : [];
    const resultMap = new Map(results.map((item) => [String(item.drive_id), item]));

      return drives.map((drive) => {
        const evaluation = evaluateStudentEligibility(
          {
            cgpa: Number(student.cgpa ?? 0),
            activeBacklogs: Number(student.backlogs ?? 0),
            totalBacklogs: Number((student as unknown as { backlogs_total?: unknown }).backlogs_total ?? 0),
            branch: String(student.branch ?? ""),
            attendancePct: Number(student.attendance_pct ?? 0),
          },
          (drive.criteria ?? {}) as {
            minCgpa?: number;
            maxBacklogs?: number;
            maxActiveBacklogs?: number;
            maxTotalBacklogs?: number;
            branches?: string[];
            minAttendance?: number;
            excludePlacedStudents?: boolean;
          },
        );
        const row = resultMap.get(String(drive.id));
        const isReleased = Boolean(row?.result_released_at);

      return {
        id: String(drive.id),
        company: String(drive.company ?? ""),
        role: String(drive.role ?? ""),
        driveDate: String(drive.drive_date ?? ""),
        status: String(drive.status ?? "upcoming"),
        eligibleCount: Number(drive.eligible_count ?? 0),
        isEligible: evaluation.eligible,
        reasons: evaluation.reasons.map((reason) => ({
          code: reason,
          label: ELIGIBILITY_REASON_LABELS[reason],
        })),
        criteria: {
          minCgpa: Number(drive.criteria?.minCgpa ?? 0),
          maxBacklogs: Number(drive.criteria?.maxBacklogs ?? 0),
          branches: Array.isArray(drive.criteria?.branches) ? drive.criteria.branches : [],
          minAttendance: Number(drive.criteria?.minAttendance ?? 0),
        },
        myStatus: String(row?.status ?? "not_computed"),
        myOutcome: isReleased ? String(row?.outcome ?? "pending") : "pending",
        remarks: isReleased && row?.remarks ? String(row.remarks) : null,
        resultReleasedAt: isReleased ? String(row?.result_released_at ?? "") : null,
        offerLetterUrl: isReleased && row?.offer_letter_url ? String(row.offer_letter_url) : null,
        offerLetterReference: isReleased && row?.offer_letter_reference ? String(row.offer_letter_reference) : null,
      };
    });
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

    const evaluation = evaluateStudentEligibility(
      {
        cgpa: Number(student.cgpa ?? 0),
        activeBacklogs: Number(student.backlogs ?? 0),
        totalBacklogs: Number((student as unknown as { backlogs_total?: unknown }).backlogs_total ?? 0),
        branch: String(student.branch ?? ""),
        attendancePct: Number(student.attendance_pct ?? 0),
      },
      criteria,
    );

    return {
      driveId: String(drive.id),
      company: String(drive.company ?? ""),
      role: drive.role ? String(drive.role) : null,
      status: String(drive.status ?? "upcoming"),
      eligible: evaluation.eligible,
      reasons: evaluation.reasons.map((reason) => ({
        code: reason,
        label: ELIGIBILITY_REASON_LABELS[reason],
      })),
      criteria: {
        minCgpa: criteria.minCgpa ?? null,
        maxActiveBacklogs: criteria.maxActiveBacklogs ?? criteria.maxBacklogs ?? null,
        maxTotalBacklogs: criteria.maxTotalBacklogs ?? null,
        minAttendance: criteria.minAttendance ?? null,
        branches: Array.isArray(criteria.branches) ? criteria.branches : [],
        excludePlacedStudents: criteria.excludePlacedStudents ?? false,
      },
      studentValues: {
        cgpa: Number(student.cgpa ?? 0),
        activeBacklogs: Number(student.backlogs ?? 0),
        totalHistoricalBacklogs: Number((student as unknown as { backlogs_total?: unknown }).backlogs_total ?? 0),
        attendancePct: Number(student.attendance_pct ?? 0),
        branch: String(student.branch ?? ""),
      },
      declarationStatus: myProfile.declarationStatus,
      warning: "Continue only if these values are still correct. If anything is outdated or false, contact the TPO before applying.",
    };
  },

  async applyToDrive(params: {
    tenantId: string;
    userId: string;
    driveId: string;
    confirmDeclaration: boolean;
  }) {
    const preview = await this.getDriveDeclarationPreview(params.tenantId, params.userId, params.driveId);
    const profile = await StudentRepository.getStudentProfile(params.tenantId, params.userId);
    const student = await StudentRepository.getStudentByUserId(params.tenantId, params.userId);
    const drive = await DriveRepository.getDriveById(params.tenantId, params.driveId);

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

    const driveDate = new Date(`${drive.driveDate}T23:59:59.999Z`);
    if (Number.isNaN(driveDate.getTime()) || driveDate.getTime() < Date.now()) {
      throw new AppError("DRIVE_DEADLINE_PASSED", "This drive is no longer accepting applications.", 409);
    }

    const existingResult = await DriveRepository.getDriveResultForStudent(params.tenantId, params.driveId, String(student.id));
    if (existingResult && (existingResult.status === "applied" || existingResult.outcome !== "pending")) {
      throw new AppError("DRIVE_ALREADY_APPLIED", "You have already applied to this drive.", 409);
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

    await DriveRepository.markDriveApplied(params.tenantId, params.driveId, String(student.id));

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

    return { driveId: params.driveId, status: "applied" as const };
  },

  async getDashboard(tenantId: string, userId: string) {
    const student = await StudentRepository.getStudentByUserId(tenantId, userId);

    return StudentRepository.getDashboardData(tenantId, String(student.id));
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
    return buildMyProfileResponse(profile);
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

    return buildMyProfileResponse(updated);
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

    return buildMyProfileResponse(updated);
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
      ...(params.degree !== undefined ? { degree: params.degree } : {}),
      ...(params.currentSemester !== undefined ? { currentSemester: params.currentSemester } : {}),
      ...(params.totalHistoricalBacklogs !== undefined ? { totalHistoricalBacklogs: params.totalHistoricalBacklogs } : {}),
      ...(params.phone !== undefined ? { phone: params.phone } : {}),
      ...(params.personalEmail !== undefined ? { personalEmail: params.personalEmail } : {}),
      ...(params.resumeUrl !== undefined ? { resumeUrl: params.resumeUrl } : {}),
      ...(params.targetRoles !== undefined ? { targetRoles: params.targetRoles } : {}),
      ...(params.preferredLocations !== undefined ? { preferredLocations: params.preferredLocations } : {}),
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
        previousResumePresent: Boolean(existingProfileData.resumeUrl),
        currentResumePresent: Boolean(normalizeStudentProfileData(updatedProfile.profile_data).resumeUrl),
      },
      impactScore: 32,
      module: "Profile",
    });

    return this.getMyProfile(params.tenantId, params.userId);
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

    const popularityRows = resourceIds.length > 0
      ? await db.collection("resource_view_events").aggregate([
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
      : [];
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
    const prepareForUpcomingDrives = selectRecommendedResources(scoredResources, (item) => item.recommendationFlags.upcomingDriveMatch, limitPerSection, "prepare_upcoming_drives");
    const basedOnYourBranch = selectRecommendedResources(scoredResources, (item) => item.recommendationFlags.branchMatch, limitPerSection, "based_on_branch");
    const continueLearning = selectRecommendedResources(scoredResources, (item) => item.recommendationFlags.continueLearningMatch, limitPerSection, "continue_learning");
    const usedIds = new Set([
      ...bestForYouNow,
      ...fixYourWeakAreas,
      ...prepareForUpcomingDrives,
      ...basedOnYourBranch,
      ...continueLearning,
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
      items: Array<RecommendedResourceItem & {
        recommendationFlags: {
          weakTopicMatch: boolean;
          branchMatch: boolean;
          upcomingDriveMatch: boolean;
          continueLearningMatch: boolean;
        };
      }>,
    ) => items.map(({ recommendationFlags: _ignored, ...item }) => item);

    return {
      context: {
        branch: String(student.branch ?? ""),
        branchTrackLabel: dashboard.branchTrack.label,
        targetRoles: profileData.targetRoles,
        upcomingDrives: dashboard.upcomingDrives.slice(0, 3).map((drive) => ({
          company: drive.company,
          role: drive.role,
          driveDate: drive.driveDate,
        })),
      },
      sections: {
        bestForYouNow: stripFlags(bestForYouNow),
        fixYourWeakAreas: stripFlags(fixYourWeakAreas),
        prepareForUpcomingDrives: stripFlags(prepareForUpcomingDrives),
        basedOnYourBranch: stripFlags(basedOnYourBranch),
        continueLearning: stripFlags(continueLearning),
        exploreMore: stripFlags(exploreMore),
      },
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
      sortBy: "cgpa" | "created_at" | "readiness_score" | "profile_completeness";
      sortDir: "asc" | "desc";
    },
  ) {
    return StudentRepository.listStudentsForTpo(tenantId, params);
  },

  async getStudentByIdForTpo(tenantId: string, studentId: string) {
    const detail = await StudentRepository.getStudentByIdForTpo(tenantId, studentId);
    const driveDeclarations = await StudentRepository.listStudentDriveDeclarations(tenantId, studentId);
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
