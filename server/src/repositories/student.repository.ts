import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { hash as bcryptHash } from "bcryptjs";

import { getBranchPrepTrack, matchesBranchPrepTrackTag } from "../config/branch-prep.config.js";
import { AppError } from "../middleware/error-handler.js";
import { buildStudentProfileSummary, normalizeStudentProfileData } from "../utils/student-profile.js";
import { buildStudentDeclarationStatus } from "../utils/student-declaration.js";
import {
  buildLocalResourceFileUrl,
  isManagedCloudUrl,
  resolveCloudPublicUrl,
  resolveLocalStorageKey,
  resolveMaterialRoot,
  resolveStorageMode,
} from "../utils/storage.js";
import { getMongoDb } from "../utils/mongodb.js";

const materialRoot = resolveMaterialRoot();
const localResourceVisibilityCache = new Map<string, boolean>();

type StudentRecord = {
  [key: string]: unknown;
  id: unknown;
  tenant_id?: unknown;
  user_id: unknown;
  roll_number?: unknown;
  branch?: unknown;
  batch?: unknown;
  cgpa?: unknown;
  backlogs?: unknown;
  backlogs_total?: unknown;
  attendance_pct?: unknown;
  points?: unknown;
  streak_current?: unknown;
  streak_longest?: unknown;
  readiness_score?: unknown;
  profile_data?: unknown;
  skills?: unknown;
  full_name?: unknown;
  college_email?: unknown;
};
type PlacementStatusSummary = {
  isPlaced: boolean;
  placedAt: string | null;
  placedCompany: string | null;
  placedRole: string | null;
  placedPackageLpa: number | null;
  sourceDriveId: string | null;
  correctionReason: string | null;
  correctedAt: string | null;
};
const studyDocumentManifestStatusCache = new Map<string, string>();
const studyDocumentContentCache = new Map<string, {
  status: string;
  title?: string;
  topic?: string;
  subtopic?: string;
  branchRelevance?: string[];
  careerTracks?: string[];
  contentPacks?: string[];
  difficulty?: string;
  whatThisCovers?: string;
  keyConcepts?: string[];
  importantDefinitions?: string[];
  coreExplanation?: string;
  stepByStepUnderstanding?: string[];
  interviewFocus?: string[];
  commonMistakes?: string[];
  quickRevisionPoints?: string[];
  practicePrompts?: string[];
  recommendedFor?: string[];
  searchText?: string;
  sourceQualityNotes?: string;
}>();
const hiddenOnePagePdfPathSet = new Set<string>();
const onePagePdfTriageMap = new Map<string, { bucket: string; suggestedLabel: string }>();
const resourceListCache = new Map<string, {
  expiresAt: number;
  items: Array<ReturnType<typeof toResourceDto>>;
}>();
let resourceViewIndexesEnsured = false;
const studyDocumentManifestPath = path.resolve(process.cwd(), "../analysis_output/study_documents/manifest.jsonl");
const hiddenOnePagePdfPath = path.resolve(process.cwd(), "../analysis_output/one_page_pdf_triage/hide_paths.txt");
const onePagePdfTriageManifestPath = path.resolve(process.cwd(), "../analysis_output/one_page_pdf_triage/triage_manifest.jsonl");
const analysisCacheCheckIntervalMs = 15000;
let analysisCacheLastCheckAt = 0;
let studyDocumentManifestMtimeMs = 0;
let hiddenOnePagePdfMtimeMs = 0;
let onePagePdfTriageManifestMtimeMs = 0;
const resourceListCacheTtlMs = 5 * 60 * 1000;

function normalizeBranchCacheKey(branch: string | null | undefined) {
  return String(branch ?? "").trim().toUpperCase() || "ALL";
}

function filterResourcesForStudentBranch<T extends {
  studyDocument?: {
    branchRelevance?: string[];
  };
}>(items: T[], branch: string | null | undefined) {
  const normalizedBranch = String(branch ?? "").trim();
  if (!normalizedBranch) {
    return items;
  }

  return items.filter((item) => {
    const branchRelevance = item.studyDocument?.branchRelevance;
    if (!Array.isArray(branchRelevance) || branchRelevance.length === 0) {
      return true;
    }

    return branchRelevance.some((value) => matchesBranchPrepTrackTag(String(value), normalizedBranch));
  });
}

if (existsSync(studyDocumentManifestPath)) {
  try {
    const lines = readFileSync(studyDocumentManifestPath, "utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const item = JSON.parse(line) as {
          relative_path?: string;
          status?: string;
          title?: string;
          topic?: string;
          subtopic?: string;
          branch_relevance?: string[];
          career_tracks?: string[];
          content_pack_labels?: string[];
          difficulty?: string;
          what_this_covers?: string;
          key_concepts?: string[];
          important_definitions?: string[];
          core_explanation?: string;
          step_by_step_understanding?: string[];
          interview_focus?: string[];
          common_mistakes?: string[];
          quick_revision_points?: string[];
          practice_prompts?: string[];
          recommended_for?: string[];
          search_text?: string;
          source_quality_notes?: string;
        };
        const relativePath = normalizeLocalRelativePath(item.relative_path);
        const status = String(item.status ?? "").trim().toLowerCase();
        if (relativePath && status) {
          studyDocumentManifestStatusCache.set(relativePath, status);
          studyDocumentContentCache.set(relativePath, {
            status,
            title: item.title ? String(item.title) : undefined,
            topic: item.topic ? String(item.topic) : undefined,
            subtopic: item.subtopic ? String(item.subtopic) : undefined,
            branchRelevance: Array.isArray(item.branch_relevance) ? item.branch_relevance.map((value) => String(value)) : undefined,
            careerTracks: Array.isArray(item.career_tracks) ? item.career_tracks.map((value) => String(value)) : undefined,
            contentPacks: Array.isArray(item.content_pack_labels) ? item.content_pack_labels.map((value) => String(value)) : undefined,
            difficulty: item.difficulty ? String(item.difficulty) : undefined,
            whatThisCovers: item.what_this_covers ? String(item.what_this_covers) : undefined,
            keyConcepts: Array.isArray(item.key_concepts) ? item.key_concepts.map((value) => String(value)) : undefined,
            importantDefinitions: Array.isArray(item.important_definitions) ? item.important_definitions.map((value) => String(value)) : undefined,
            coreExplanation: item.core_explanation ? String(item.core_explanation) : undefined,
            stepByStepUnderstanding: Array.isArray(item.step_by_step_understanding) ? item.step_by_step_understanding.map((value) => String(value)) : undefined,
            interviewFocus: Array.isArray(item.interview_focus) ? item.interview_focus.map((value) => String(value)) : undefined,
            commonMistakes: Array.isArray(item.common_mistakes) ? item.common_mistakes.map((value) => String(value)) : undefined,
            quickRevisionPoints: Array.isArray(item.quick_revision_points) ? item.quick_revision_points.map((value) => String(value)) : undefined,
            practicePrompts: Array.isArray(item.practice_prompts) ? item.practice_prompts.map((value) => String(value)) : undefined,
            recommendedFor: Array.isArray(item.recommended_for) ? item.recommended_for.map((value) => String(value)) : undefined,
            searchText: item.search_text ? String(item.search_text) : undefined,
            sourceQualityNotes: item.source_quality_notes ? String(item.source_quality_notes) : undefined,
          });
        }
      } catch {
        // Ignore malformed manifest rows and continue loading valid entries.
      }
    }
  } catch {
    // Ignore manifest loading failures and fall back to file-content checks only.
  }
}

if (existsSync(hiddenOnePagePdfPath)) {
  try {
    const lines = readFileSync(hiddenOnePagePdfPath, "utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const normalizedMaterialPath = normalizeLocalRelativePath(line);
      if (normalizedMaterialPath) {
        hiddenOnePagePdfPathSet.add(normalizedMaterialPath);
      }
    }
  } catch {
    // Ignore hidden-path manifest loading failures and fall back to default visibility rules.
  }
}

if (existsSync(onePagePdfTriageManifestPath)) {
  try {
    const lines = readFileSync(onePagePdfTriageManifestPath, "utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const item = JSON.parse(line) as { relative_path?: string; bucket?: string; suggested_label?: string };
        const relativePath = normalizeLocalRelativePath(item.relative_path);
        const bucket = String(item.bucket ?? "").trim().toLowerCase();
        const suggestedLabel = String(item.suggested_label ?? "").trim().toLowerCase();
        if (relativePath && bucket) {
          onePagePdfTriageMap.set(relativePath, {
            bucket,
            suggestedLabel,
          });
        }
      } catch {
        // Ignore malformed triage rows and continue loading valid entries.
      }
    }
  } catch {
    // Ignore triage manifest loading failures and fall back to default behavior.
  }
}

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

function tokenizeQuery(value: string): string[] {
  return [...new Set(
    String(value ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3),
  )];
}

function maxIsoDate(values: Array<string | null | undefined>) {
  const filtered = values.filter((value): value is string => Boolean(value));
  if (filtered.length === 0) {
    return null;
  }

  return filtered.sort((a, b) => b.localeCompare(a))[0];
}

function normalizeLocalRelativePath(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^material\//i, "")
    .replace(/^\/+/g, "")
    .toLowerCase();
}

function emptyPlacementStatus(): PlacementStatusSummary {
  return {
    isPlaced: false,
    placedAt: null,
    placedCompany: null,
    placedRole: null,
    placedPackageLpa: null,
    sourceDriveId: null,
    correctionReason: null,
    correctedAt: null,
  };
}

function normalizePlacementStatus(profileData: unknown): PlacementStatusSummary {
  const record = profileData && typeof profileData === "object"
    ? profileData as Record<string, unknown>
    : {};
  const raw = record.placementStatus && typeof record.placementStatus === "object"
    ? record.placementStatus as Record<string, unknown>
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
}

function readManifestLines(filePath: string) {
  return readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
}

async function readManifestLinesAsync(filePath: string) {
  return (await readFile(filePath, "utf8")).split(/\r?\n/).filter(Boolean);
}

async function loadStudyDocumentManifest() {
  studyDocumentManifestStatusCache.clear();
  studyDocumentContentCache.clear();

  if (!existsSync(studyDocumentManifestPath)) {
    studyDocumentManifestMtimeMs = 0;
    return;
  }

  const stats = await stat(studyDocumentManifestPath);
  studyDocumentManifestMtimeMs = stats.mtimeMs;

  for (const line of await readManifestLinesAsync(studyDocumentManifestPath)) {
    try {
      const item = JSON.parse(line) as {
        relative_path?: string;
        status?: string;
        title?: string;
        topic?: string;
        subtopic?: string;
        branch_relevance?: string[];
        career_tracks?: string[];
        content_pack_labels?: string[];
        difficulty?: string;
        what_this_covers?: string;
        key_concepts?: string[];
        important_definitions?: string[];
        core_explanation?: string;
        step_by_step_understanding?: string[];
        interview_focus?: string[];
        common_mistakes?: string[];
        quick_revision_points?: string[];
        practice_prompts?: string[];
        recommended_for?: string[];
        search_text?: string;
        source_quality_notes?: string;
      };
      const relativePath = normalizeLocalRelativePath(item.relative_path);
      const status = String(item.status ?? "").trim().toLowerCase();
      if (relativePath && status) {
        studyDocumentManifestStatusCache.set(relativePath, status);
        studyDocumentContentCache.set(relativePath, {
          status,
          title: item.title ? String(item.title) : undefined,
          topic: item.topic ? String(item.topic) : undefined,
          subtopic: item.subtopic ? String(item.subtopic) : undefined,
          branchRelevance: Array.isArray(item.branch_relevance) ? item.branch_relevance.map((value) => String(value)) : undefined,
          careerTracks: Array.isArray(item.career_tracks) ? item.career_tracks.map((value) => String(value)) : undefined,
          contentPacks: Array.isArray(item.content_pack_labels) ? item.content_pack_labels.map((value) => String(value)) : undefined,
          difficulty: item.difficulty ? String(item.difficulty) : undefined,
          whatThisCovers: item.what_this_covers ? String(item.what_this_covers) : undefined,
          keyConcepts: Array.isArray(item.key_concepts) ? item.key_concepts.map((value) => String(value)) : undefined,
          importantDefinitions: Array.isArray(item.important_definitions) ? item.important_definitions.map((value) => String(value)) : undefined,
          coreExplanation: item.core_explanation ? String(item.core_explanation) : undefined,
          stepByStepUnderstanding: Array.isArray(item.step_by_step_understanding) ? item.step_by_step_understanding.map((value) => String(value)) : undefined,
          interviewFocus: Array.isArray(item.interview_focus) ? item.interview_focus.map((value) => String(value)) : undefined,
          commonMistakes: Array.isArray(item.common_mistakes) ? item.common_mistakes.map((value) => String(value)) : undefined,
          quickRevisionPoints: Array.isArray(item.quick_revision_points) ? item.quick_revision_points.map((value) => String(value)) : undefined,
          practicePrompts: Array.isArray(item.practice_prompts) ? item.practice_prompts.map((value) => String(value)) : undefined,
          recommendedFor: Array.isArray(item.recommended_for) ? item.recommended_for.map((value) => String(value)) : undefined,
          searchText: item.search_text ? String(item.search_text) : undefined,
          sourceQualityNotes: item.source_quality_notes ? String(item.source_quality_notes) : undefined,
        });
      }
    } catch {
      // Ignore malformed manifest rows and continue loading valid entries.
    }
  }
}

async function loadHiddenOnePagePdfPaths() {
  hiddenOnePagePdfPathSet.clear();

  if (!existsSync(hiddenOnePagePdfPath)) {
    hiddenOnePagePdfMtimeMs = 0;
    return;
  }

  const stats = await stat(hiddenOnePagePdfPath);
  hiddenOnePagePdfMtimeMs = stats.mtimeMs;

  for (const line of await readManifestLinesAsync(hiddenOnePagePdfPath)) {
    const normalizedMaterialPath = normalizeLocalRelativePath(line);
    if (normalizedMaterialPath) {
      hiddenOnePagePdfPathSet.add(normalizedMaterialPath);
    }
  }
}

async function loadOnePagePdfTriageManifest() {
  onePagePdfTriageMap.clear();

  if (!existsSync(onePagePdfTriageManifestPath)) {
    onePagePdfTriageManifestMtimeMs = 0;
    return;
  }

  const stats = await stat(onePagePdfTriageManifestPath);
  onePagePdfTriageManifestMtimeMs = stats.mtimeMs;

  for (const line of await readManifestLinesAsync(onePagePdfTriageManifestPath)) {
    try {
      const item = JSON.parse(line) as { relative_path?: string; bucket?: string; suggested_label?: string };
      const relativePath = normalizeLocalRelativePath(item.relative_path);
      const bucket = String(item.bucket ?? "").trim().toLowerCase();
      const suggestedLabel = String(item.suggested_label ?? "").trim().toLowerCase();
      if (relativePath && bucket) {
        onePagePdfTriageMap.set(relativePath, {
          bucket,
          suggestedLabel,
        });
      }
    } catch {
      // Ignore malformed triage rows and continue loading valid entries.
    }
  }
}

async function refreshAnalysisCachesIfNeeded(force = false) {
  const now = Date.now();
  if (!force && now - analysisCacheLastCheckAt < analysisCacheCheckIntervalMs) {
    return;
  }

  analysisCacheLastCheckAt = now;
  let shouldClearVisibilityCache = false;

  try {
    const nextStudyMtime = existsSync(studyDocumentManifestPath) ? (await stat(studyDocumentManifestPath)).mtimeMs : 0;
    if (force || nextStudyMtime !== studyDocumentManifestMtimeMs) {
      await loadStudyDocumentManifest();
      shouldClearVisibilityCache = true;
    }
  } catch {
    // Ignore transient file read failures and continue using current cache state.
  }

  try {
    const nextHiddenMtime = existsSync(hiddenOnePagePdfPath) ? (await stat(hiddenOnePagePdfPath)).mtimeMs : 0;
    if (force || nextHiddenMtime !== hiddenOnePagePdfMtimeMs) {
      await loadHiddenOnePagePdfPaths();
      shouldClearVisibilityCache = true;
    }
  } catch {
    // Ignore transient file read failures and continue using current cache state.
  }

  try {
    const nextTriageMtime = existsSync(onePagePdfTriageManifestPath) ? (await stat(onePagePdfTriageManifestPath)).mtimeMs : 0;
    if (force || nextTriageMtime !== onePagePdfTriageManifestMtimeMs) {
      await loadOnePagePdfTriageManifest();
    }
  } catch {
    // Ignore transient file read failures and continue using current cache state.
  }

  if (shouldClearVisibilityCache) {
    localResourceVisibilityCache.clear();
  }
}

void refreshAnalysisCachesIfNeeded(true);
const analysisCacheRefreshTimer = setInterval(() => {
  void refreshAnalysisCachesIfNeeded();
}, analysisCacheCheckIntervalMs);
analysisCacheRefreshTimer.unref?.();

function extractSearchMetadata(resource: Record<string, unknown>) {
  const searchIndex = resource.search_index && typeof resource.search_index === "object"
    ? resource.search_index as Record<string, unknown>
    : null;

  if (!searchIndex) return {};

  return {
    summaryShort: searchIndex.summary_short ? String(searchIndex.summary_short) : undefined,
    searchText: searchIndex.search_text ? String(searchIndex.search_text) : undefined,
    summaryStatus: searchIndex.status ? String(searchIndex.status) : undefined,
    keywords: Array.isArray(searchIndex.keywords) ? searchIndex.keywords.map((value) => String(value)) : undefined,
    keyTopics: Array.isArray(searchIndex.key_topics) ? searchIndex.key_topics.map((value) => String(value)) : undefined,
  };
}

function buildStudyDocumentPayload(relativePath: string) {
  const document = studyDocumentContentCache.get(relativePath);
  if (!document || document.status !== "ok") {
    return undefined;
  }

  return {
    title: document.title,
    topic: document.topic,
    subtopic: document.subtopic,
    branchRelevance: document.branchRelevance ?? [],
    careerTracks: document.careerTracks ?? [],
    contentPacks: document.contentPacks ?? [],
    difficulty: document.difficulty,
    whatThisCovers: document.whatThisCovers,
    keyConcepts: document.keyConcepts ?? [],
    importantDefinitions: document.importantDefinitions ?? [],
    coreExplanation: document.coreExplanation,
    stepByStepUnderstanding: document.stepByStepUnderstanding ?? [],
    interviewFocus: document.interviewFocus ?? [],
    commonMistakes: document.commonMistakes ?? [],
    quickRevisionPoints: document.quickRevisionPoints ?? [],
    practicePrompts: document.practicePrompts ?? [],
    recommendedFor: document.recommendedFor ?? [],
    searchText: document.searchText,
    sourceQualityNotes: document.sourceQualityNotes,
  };
}

function cleanResourceTitle(title: string) {
  return title
    .replace(/^pdfcoffee\.com[_\s-]*/i, "")
    .replace(/\bpdf free\b/gi, "")
    .replace(/\bpublicationpdf\b/gi, "publication")
    .replace(/\bskillvertex\b/gi, "")
    .replace(/\bbd6e1c73\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+[-_]\s+/g, " ")
    .trim();
}

function cleanResourceDescription(description: string) {
  return description
    .replace(/^Imported from [^.]+\.\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildMergedStudyDocument(
  resource: Record<string, unknown>,
  studyDocument?: ReturnType<typeof buildStudyDocumentPayload>,
) {
  const resourceBranchRelevance = Array.isArray(resource.branch_relevance) ? resource.branch_relevance.map((value) => String(value)) : [];
  const resourceCareerTracks = Array.isArray(resource.career_tracks) ? resource.career_tracks.map((value) => String(value)) : [];
  const resourceContentPacks = Array.isArray(resource.content_pack_labels) ? resource.content_pack_labels.map((value) => String(value)) : [];
  const resourceRecommendedFor = Array.isArray(resource.recommended_for) ? resource.recommended_for.map((value) => String(value)) : [];

  if (!studyDocument) {
    if (resourceBranchRelevance.length === 0 && resourceCareerTracks.length === 0 && resourceContentPacks.length === 0 && resourceRecommendedFor.length === 0) {
      return undefined;
    }

    return {
      title: undefined,
      topic: undefined,
      subtopic: undefined,
      branchRelevance: resourceBranchRelevance,
      careerTracks: resourceCareerTracks,
      contentPacks: resourceContentPacks,
      difficulty: undefined,
      whatThisCovers: undefined,
      keyConcepts: [],
      importantDefinitions: [],
      coreExplanation: undefined,
      stepByStepUnderstanding: [],
      interviewFocus: [],
      commonMistakes: [],
      quickRevisionPoints: [],
      practicePrompts: [],
      recommendedFor: resourceRecommendedFor,
      searchText: undefined,
      sourceQualityNotes: undefined,
    };
  }

  return {
    ...studyDocument,
    branchRelevance: [...new Set([...(studyDocument.branchRelevance ?? []), ...resourceBranchRelevance])],
    careerTracks: [...new Set([...(studyDocument.careerTracks ?? []), ...resourceCareerTracks])],
    contentPacks: [...new Set([...(studyDocument.contentPacks ?? []), ...resourceContentPacks])],
    recommendedFor: [...new Set([...(studyDocument.recommendedFor ?? []), ...resourceRecommendedFor])],
  };
}

function toResourceDto(resource: Record<string, unknown>, options?: { includeSearchMetadata?: boolean }) {
  const resolvedUrl = resolveResourceUrlValue(
    resource.url ? String(resource.url) : "",
    resource.source_pdf ? String(resource.source_pdf) : "",
  );
  const localRelativePath = extractLocalRelativePathFromUrl(resolvedUrl);
  const onePageTriage = onePagePdfTriageMap.get(localRelativePath);
  const studyDocument = buildMergedStudyDocument(resource, buildStudyDocumentPayload(localRelativePath));
  const title = cleanResourceTitle(String(resource.title));
  const description = cleanResourceDescription(resource.description ? String(resource.description) : "");
  const base = {
    id: String(resource.id),
    title: studyDocument?.title?.trim() || title,
    description: studyDocument?.whatThisCovers?.trim() || description,
    url: resolvedUrl,
    resourceType: String(resource.resource_type),
    thumbnailUrl: resource.thumbnail_url ? String(resource.thumbnail_url) : null,
    durationSec: Number(resource.duration_sec ?? 0),
    topicId: resource.topic_id ? String(resource.topic_id) : null,
    sourcePdf: resource.source_pdf ? String(resource.source_pdf) : null,
    sourceMode: isManagedCloudUrl(resolvedUrl) ? "cloud" : (/^https?:\/\//i.test(resolvedUrl) ? "external" : "local"),
    onePageTriageBucket: onePageTriage?.bucket,
    onePageSuggestedLabel: onePageTriage?.suggestedLabel,
    studyDocument,
  };

  return options?.includeSearchMetadata
    ? {
        ...base,
        ...extractSearchMetadata(resource),
        ...(studyDocument?.searchText ? { searchText: studyDocument.searchText } : {}),
        ...(studyDocument?.keyConcepts?.length ? { keyTopics: studyDocument.keyConcepts } : {}),
      }
    : base;
}

function resolveResourceUrlValue(url: string, sourcePdf: string) {
  const fallbackUrl = String(url ?? "").trim();
  if (isManagedCloudUrl(fallbackUrl)) {
    return fallbackUrl;
  }

  const source = String(sourcePdf ?? "").trim();
  if (source && !/^https?:\/\//i.test(source)) {
    return buildLocalResourceFileUrl(source);
  }

  if (/^https?:\/\//i.test(fallbackUrl)) {
    return fallbackUrl;
  }

  return buildLocalResourceFileUrl(fallbackUrl);
}

function deriveStorageUrl(params: {
  asset?: Record<string, unknown> | null;
  fallbackUrl?: string | null;
  fallbackSourcePdf?: string | null;
}): string {
  const publicUrl = resolveCloudPublicUrl(params.asset);
  if (publicUrl) {
    return publicUrl;
  }

  const localKey = resolveLocalStorageKey({
    asset: params.asset,
    sourcePdf: params.fallbackSourcePdf,
    fallbackUrl: params.fallbackUrl,
  });
  if (localKey) return buildLocalResourceFileUrl(localKey);

  const fallbackUrl = String(params.fallbackUrl ?? "").trim();
  if (/^https?:\/\//i.test(fallbackUrl)) {
    return fallbackUrl;
  }

  return buildLocalResourceFileUrl(fallbackUrl);
}

function toResourceDtoWithAsset(
  resource: Record<string, unknown>,
  asset?: Record<string, unknown> | null,
  options?: { includeSearchMetadata?: boolean },
) {
  const resolvedUrl = deriveStorageUrl({
    asset,
    fallbackUrl: resource.url ? String(resource.url) : "",
    fallbackSourcePdf: resource.source_pdf ? String(resource.source_pdf) : "",
  });
  const localRelativePath = extractLocalRelativePathFromUrl(resolvedUrl);
  const onePageTriage = onePagePdfTriageMap.get(localRelativePath);
  const studyDocument = buildMergedStudyDocument(resource, buildStudyDocumentPayload(localRelativePath));
  const title = cleanResourceTitle(String(resource.title));
  const description = cleanResourceDescription(resource.description ? String(resource.description) : "");

  const base = {
    id: String(resource.id),
    title: studyDocument?.title?.trim() || title,
    description: studyDocument?.whatThisCovers?.trim() || description,
    url: resolvedUrl,
    resourceType: String(resource.resource_type),
    thumbnailUrl: resource.thumbnail_url ? String(resource.thumbnail_url) : null,
    durationSec: Number(resource.duration_sec ?? 0),
    topicId: resource.topic_id ? String(resource.topic_id) : null,
    sourcePdf: resource.source_pdf ? String(resource.source_pdf) : null,
    sourceMode: resolveStorageMode(asset),
    onePageTriageBucket: onePageTriage?.bucket,
    onePageSuggestedLabel: onePageTriage?.suggestedLabel,
    studyDocument,
  };

  return options?.includeSearchMetadata
    ? {
        ...base,
        ...extractSearchMetadata(resource),
        ...(studyDocument?.searchText ? { searchText: studyDocument.searchText } : {}),
        ...(studyDocument?.keyConcepts?.length ? { keyTopics: studyDocument.keyConcepts } : {}),
      }
    : base;
}

type TopicProgressStatus = "incomplete" | "in_progress" | "complete";

function buildSharedResourcePipeline(params: {
  topicId?: string;
  regex?: { $regex: string; $options: string };
  queryTerms?: string[];
  topicIds?: string[];
  limit?: number;
  includeSearchMetadata?: boolean;
}) {
  const {
    topicId,
    regex,
    queryTerms = [],
    topicIds = [],
    limit = 400,
    includeSearchMetadata = false,
  } = params;

  const resourceFilter: Record<string, unknown> = {
    is_active: true,
  };

  if (topicId) {
    resourceFilter.topic_id = topicId;
  } else if (topicIds.length > 0) {
    resourceFilter.$or = [{ topic_id: { $in: topicIds } }];
  } else if (regex) {
    const tokenMatches = queryTerms.map((term) => {
      const tokenRegex = { $regex: escapeRegex(term), $options: "i" };
      return {
        $or: [
          { title: tokenRegex },
          { description: tokenRegex },
          { source_pdf: tokenRegex },
          { url: tokenRegex },
          { "search_index.search_text": tokenRegex },
          { "search_index.summary_short": tokenRegex },
          { "search_index.keywords": tokenRegex },
          { "search_index.key_topics": tokenRegex },
          { "asset.storage_key": tokenRegex },
          { "asset.public_url": tokenRegex },
        ],
      };
    });

    resourceFilter.$or = [
      { title: regex },
      { description: regex },
      { source_pdf: regex },
      { url: regex },
      { "search_index.search_text": regex },
      { "search_index.summary_short": regex },
      { "search_index.keywords": regex },
      { "search_index.key_topics": regex },
      { "asset.storage_key": regex },
      { "asset.public_url": regex },
      ...tokenMatches,
    ];
  }

  return [
    {
      $match: {
        is_active: true,
      },
    },
    {
      $lookup: {
        from: "assets",
        localField: "asset_id",
        foreignField: "id",
        as: "asset",
      },
    },
    { $unwind: { path: "$asset", preserveNullAndEmptyArrays: true } },
    { $match: resourceFilter },
    {
      $project: {
        _id: 0,
        id: "$id",
        title: "$title",
        description: "$description",
        url: "$url",
        resource_type: "$resource_type",
        thumbnail_url: "$thumbnail_url",
        duration_sec: "$duration_sec",
        topic_id: "$topic_id",
        source_pdf: "$source_pdf",
        branch_relevance: "$branch_relevance",
        career_tracks: "$career_tracks",
        content_pack_labels: "$content_pack_labels",
        recommended_for: "$recommended_for",
        created_at: "$created_at",
        asset: "$asset",
        ...(includeSearchMetadata ? { search_index: "$search_index" } : {}),
      },
    },
    { $sort: { created_at: -1, id: 1 } },
    { $limit: Math.max(1, Math.min(limit, 5000)) },
  ];
}

async function fetchSharedResources(params: {
  topicId?: string;
  regex?: { $regex: string; $options: string };
  queryTerms?: string[];
  topicIds?: string[];
  limit?: number;
  includeSearchMetadata?: boolean;
}) {
  const db = await getMongoDb();
  const pipeline = buildSharedResourcePipeline(params);
  const rows = await db.collection("shared_resources").aggregate(pipeline).toArray();
  return rows.map((row) =>
    toResourceDtoWithAsset(
      row as Record<string, unknown>,
      (row as { asset?: Record<string, unknown> }).asset,
      { includeSearchMetadata: params.includeSearchMetadata },
    ));
}

async function fetchRelatedMocksForCompany(
  tenantId: string,
  studentId: string,
  companyId: string,
  limit = 8,
) {
  const db = await getMongoDb();
  const tests = await db.collection("mock_tests").find(
    {
      is_active: true,
      company_id: companyId,
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
  ).sort({ created_at: -1 }).limit(limit).toArray();

  if (tests.length === 0) {
    return [];
  }

  const attemptCounts = await db.collection("student_attempts").aggregate([
    {
      $match: {
        tenant_id: tenantId,
        student_id: studentId,
        status: "submitted",
        test_id: { $in: tests.map((test) => String(test.id)) },
      },
    },
    {
      $group: {
        _id: "$test_id",
        count: { $sum: 1 },
      },
    },
  ]).toArray();

  const topicIds = [...new Set(tests.map((test) => test.topic_id).filter((value): value is string => Boolean(value)))];
  const topics = topicIds.length > 0
    ? await db.collection("topics").find(
        { id: { $in: topicIds }, $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
        { projection: { _id: 0, id: 1, name: 1 } },
      ).toArray()
    : [];
  const topicMap = new Map(topics.map((topic) => [String(topic.id), String(topic.name ?? "")]));
  const attemptCountMap = new Map(attemptCounts.map((row) => [String(row._id), Number(row.count ?? 0)]));

  return tests.map((test) => ({
    id: String(test.id),
    title: String(test.title ?? "Mock Test"),
    topicId: test.topic_id ? String(test.topic_id) : null,
    companyId: test.company_id ? String(test.company_id) : null,
    topicName: test.topic_id ? topicMap.get(String(test.topic_id)) ?? null : null,
    companyName: null,
    durationSec: Number(test.duration_sec ?? 0),
    difficulty: String(test.difficulty ?? "medium"),
    attemptCount: attemptCountMap.get(String(test.id)) ?? 0,
  }));
}

function dedupeResourceItems(items: Array<ReturnType<typeof toResourceDto>>) {
  const seen = new Set<string>();
  const output: Array<ReturnType<typeof toResourceDto>> = [];

  for (const item of items) {
    if (!isVisibleLocalResource(item)) continue;

    const key = [
      String(item.title ?? "").trim().toLowerCase(),
      String(item.url ?? "").trim().toLowerCase(),
      String(item.resourceType ?? "").trim().toLowerCase(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

type ResourceListFilter = "all" | "pdf" | "notes" | "guide" | "notebook" | "external";

function matchesResourceListFilter(
  resource: ReturnType<typeof toResourceDto>,
  filter: ResourceListFilter,
) {
  const type = String(resource.resourceType ?? "").toLowerCase();
  if (filter === "all") return true;
  if (filter === "pdf") return type === "pdf";
  if (filter === "notes") return type === "text" || type === "notes" || type === "document";
  if (filter === "guide") return type === "markdown";
  if (filter === "notebook") return type === "notebook";
  if (filter === "external") return type === "external_link" || resource.sourceMode === "external";
  return true;
}

async function ensureResourceViewIndexes() {
  if (resourceViewIndexesEnsured) return;
  const db = await getMongoDb();
  await Promise.all([
    db.collection("resource_view_events").createIndex({ tenant_id: 1, resource_id: 1, created_at: -1 }),
    db.collection("resource_view_events").createIndex({ tenant_id: 1, student_id: 1, created_at: -1 }),
    db.collection("resource_view_events").createIndex({ tenant_id: 1, session_id: 1, created_at: -1 }),
    db.collection("resource_view_events").createIndex({ tenant_id: 1, student_id: 1, resource_id: 1, session_id: 1, event_type: 1 }),
  ]);
  resourceViewIndexesEnsured = true;
}

function isTextLikeResourceType(resourceType: string) {
  const value = resourceType.trim().toLowerCase();
  return value === "markdown" || value === "text" || value === "notes" || value === "document";
}

function extractLocalRelativePathFromUrl(url: string): string {
  const value = String(url ?? "").trim();
  if (!value) return "";

  if (value.startsWith("/api/v1/resources/file?")) {
    const query = value.split("?")[1] ?? "";
    const params = new URLSearchParams(query);
    return normalizeLocalRelativePath(params.get("path"));
  }

  if (value.startsWith("material/")) {
    return normalizeLocalRelativePath(value.slice("material/".length));
  }

  return normalizeLocalRelativePath(value);
}

function isVisibleLocalResource(item: ReturnType<typeof toResourceDto>) {
  if (item.sourceMode !== "local") return true;

  const relativePath = extractLocalRelativePathFromUrl(String(item.url ?? ""));
  if (!relativePath) return true;

  if (hiddenOnePagePdfPathSet.has(relativePath)) {
    return false;
  }

  if (!isTextLikeResourceType(String(item.resourceType ?? ""))) return true;

  if (/(^|\/)readme\.(md|markdown|txt)$/i.test(relativePath)) {
    const status = studyDocumentManifestStatusCache.get(relativePath);
    return status === "ok";
  }

  const cacheKey = relativePath;
  const cached = localResourceVisibilityCache.get(cacheKey);
  if (typeof cached === "boolean") {
    return cached;
  }

  const absolutePath = path.resolve(materialRoot, relativePath);
  let isVisible = true;

  try {
    if (!absolutePath.startsWith(materialRoot) || !existsSync(absolutePath)) {
      isVisible = false;
    } else {
      const stats = statSync(absolutePath);
      if (!stats.isFile() || stats.size === 0) {
        isVisible = false;
      } else {
        const sample = readFileSync(absolutePath, "utf8").trim();
        isVisible = sample.length > 0;
      }
    }
  } catch {
    isVisible = false;
  }

  localResourceVisibilityCache.set(cacheKey, isVisible);
  return isVisible;
}

export const StudentRepository = {
  async getStudentByUserId(tenantId: string, userId: string): Promise<StudentRecord> {
    const db = await getMongoDb();
    const data = await db.collection("students").findOne(
      { tenant_id: tenantId, user_id: userId },
      {
        projection: {
          _id: 0,
          id: 1,
          tenant_id: 1,
          user_id: 1,
          roll_number: 1,
          branch: 1,
          batch: 1,
          cgpa: 1,
          backlogs: 1,
          backlogs_total: 1,
          attendance_pct: 1,
          points: 1,
          streak_current: 1,
          streak_longest: 1,
          readiness_score: 1,
          profile_data: 1,
          skills: 1,
        },
      },
    );

    if (!data) {
      throw new AppError("STUDENT_NOT_FOUND", "Student profile not found", 404);
    }

    return data as unknown as StudentRecord;
  },

  async getDashboardData(tenantId: string, studentId: string) {
    const db = await getMongoDb();
    const todayIso = new Date().toISOString().slice(0, 10);
    const weekStartIso = startOfWeekIso(new Date());

    const start7 = startOfWeekIso(new Date());

    const [studyToday, studyWeek, student, weakAreas, upcomingDrives, resourceViewEvents] = await Promise.all([
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
        { projection: { points: 1, readiness_score: 1, streak_current: 1, streak_longest: 1, branch: 1 } },
      ),
      db.collection("topic_mastery").find(
        { tenant_id: tenantId, student_id: studentId },
        { projection: { topic_id: 1, mastery_level: 1 } },
      ).sort({ mastery_level: 1 }).limit(3).toArray(),
      db.collection("drives").find(
        { tenant_id: tenantId, drive_date: { $gte: todayIso }, deleted_at: null },
        { projection: { id: 1, company: 1, role: 1, drive_date: 1, status: 1 } },
      ).sort({ drive_date: 1 }).limit(3).toArray(),
      db.collection("resource_view_events").find(
        { tenant_id: tenantId, student_id: studentId, created_at: { $gte: `${start7}T00:00:00.000Z` } },
        { projection: { _id: 0, event_type: 1, duration_sec: 1, created_at: 1, metadata: 1 } },
      ).sort({ created_at: -1 }).toArray(),
    ]);

    if (!student) {
      throw new AppError("DASHBOARD_DATA_ERROR", "Missing student data", 500);
    }

    const studentPoints = Number(student.points ?? 0);
    const branch = String(student.branch ?? "");
    const branchTrack = getBranchPrepTrack(branch, { fallback: "placement_essentials" });
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
    const branchFocusTopics = await db.collection("topics").find(
      {
        name: { $in: branchTrack.focusAreas.map((item) => item.topicName) },
        $or: [{ tenant_id: tenantId }, { tenant_id: null }],
      },
      { projection: { _id: 0, id: 1, name: 1 } },
    ).toArray();
    branchFocusTopics.forEach((topic) => topicIds.add(String(topic.id)));

    const topics = topicIds.size > 0
      ? await db.collection("topics").find(
          { id: { $in: [...topicIds] }, $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
          { projection: { _id: 0, id: 1, name: 1 } },
        ).toArray()
      : [];
    const topicNameMap = new Map(topics.map((topic) => [String(topic.id), String(topic.name)]));
    const topicIdByName = new Map(topics.map((topic) => [String(topic.name), String(topic.id)]));

    const preferredTopicIds = weakAreas.length > 0
      ? weakAreas.map((item) => String(item.topic_id))
      : branchTrack.focusAreas
          .map((item) => topicIdByName.get(item.topicName))
          .filter((value): value is string => Boolean(value));

    const recommendedTest = await db.collection("mock_tests").findOne(
      {
        is_active: true,
        $or: [{ tenant_id: tenantId }, { tenant_id: null }],
        ...(preferredTopicIds.length > 0 ? { topic_id: { $in: preferredTopicIds } } : {}),
      },
      { projection: { _id: 0, id: 1, title: 1, difficulty: 1, duration_sec: 1 }, sort: { created_at: -1 } },
    );

    const studyHoursToday = studyToday.reduce((sum, row) => sum + Number(row.hours ?? 0), 0);
    const studyHoursWeek = studyWeek.reduce((sum, row) => sum + Number(row.hours ?? 0), 0);
    const branchTrackAreas = branchTrack.focusAreas.map((item) => ({
      topicId: topicIdByName.get(item.topicName) ?? null,
      topicName: item.topicName,
      reason: item.reason,
    }));
    const resourceOpenEvents = resourceViewEvents.filter((item) => String(item.event_type ?? "") === "open");
    const resourceCloseEvents = resourceViewEvents.filter((item) => String(item.event_type ?? "") === "close");
    const resourceActiveDays = new Set(
      resourceViewEvents.map((item) => String(item.created_at ?? "").slice(0, 10)).filter(Boolean),
    ).size;
    const readingMinutes7d = Number(
      (
        resourceCloseEvents.reduce((sum, item) => sum + Number(item.duration_sec ?? 0), 0) / 60
      ).toFixed(1),
    );
    const lastResourceEvent = resourceViewEvents[0];
    const lastResourceTitle = lastResourceEvent?.metadata && typeof lastResourceEvent.metadata === "object"
      ? String((lastResourceEvent.metadata as Record<string, unknown>).resourceTitle ?? "").trim()
      : "";
    const recentResourceMap = new Map<string, {
      resourceId: string;
      title: string;
      viewedAt: string;
      resourceType: string;
      progressPct: number | null;
    }>();
    for (const event of resourceOpenEvents) {
      const metadata = event.metadata && typeof event.metadata === "object"
        ? event.metadata as Record<string, unknown>
        : {};
      const resourceId = String(event.resource_id ?? "");
      if (!resourceId || recentResourceMap.has(resourceId)) continue;
      recentResourceMap.set(resourceId, {
        resourceId,
        title: String(metadata.resourceTitle ?? "Learning resource"),
        viewedAt: String(event.created_at ?? ""),
        resourceType: String(metadata.resourceType ?? "resource"),
        progressPct: typeof event.progress_pct === "number" ? Number(event.progress_pct) : null,
      });
      if (recentResourceMap.size >= 5) break;
    }
    const studyTopicOptions = [
      ...branchTrackAreas
        .filter((item): item is { topicId: string; topicName: string; reason: string } => Boolean(item.topicId)),
      ...weakAreas.map((item) => ({
        topicId: String(item.topic_id),
        topicName: topicNameMap.get(String(item.topic_id)) ?? String(item.topic_id),
        reason: "Weak area detected from recent test performance.",
      })),
      ...studiedTopicRows.map((row) => ({
        topicId: String(row._id),
        topicName: topicNameMap.get(String(row._id)) ?? String(row._id),
        reason: "Recently studied topic.",
      })),
    ].reduce<Array<{ topicId: string; topicName: string; reason: string }>>((acc, item) => {
      if (!item.topicId || acc.some((existing) => existing.topicId === item.topicId)) {
        return acc;
      }
      acc.push(item);
      return acc;
    }, []);

    return {
      branch,
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
      branchTrack: {
        label: branchTrack.label,
        summary: branchTrack.summary,
        focusAreas: branchTrackAreas,
        recommendedActions: branchTrack.recommendedActions,
        starterPrompts: branchTrack.starterPrompts,
      },
      studyTopicOptions,
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
      resourceUsage: {
        resourcesOpened7d: resourceOpenEvents.length,
        readingMinutes7d,
        activeDays7d: resourceActiveDays,
        lastViewedAt: lastResourceEvent ? String(lastResourceEvent.created_at ?? "") : null,
        lastViewedTitle: lastResourceTitle || null,
        recentResources: [...recentResourceMap.values()],
      },
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

  async getStudentProfile(tenantId: string, userId: string): Promise<StudentRecord> {
    const db = await getMongoDb();
    const [student, user] = await Promise.all([
      db.collection("students").findOne(
        { tenant_id: tenantId, user_id: userId },
        {
          projection: {
            _id: 0,
            id: 1,
            tenant_id: 1,
            user_id: 1,
            roll_number: 1,
            branch: 1,
            batch: 1,
            cgpa: 1,
            backlogs: 1,
            backlogs_total: 1,
            attendance_pct: 1,
            skills: 1,
            profile_data: 1,
          },
        },
      ),
      db.collection("users").findOne(
        { tenant_id: tenantId, id: userId },
        { projection: { _id: 0, full_name: 1, email: 1 } },
      ),
    ]);

    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student profile not found", 404);
    }

    return {
      ...student,
      full_name: user?.full_name ?? "",
      college_email: user?.email ?? "",
    } as unknown as StudentRecord;
  },

  async updateStudentProfile(params: {
    tenantId: string;
    userId: string;
    skills?: string[];
    cgpa?: number | null;
    activeBacklogs?: number | null;
    totalHistoricalBacklogs?: number | null;
    attendancePct?: number | null;
    rollNumber?: string;
    branch?: string;
    batch?: string;
    profileData?: Record<string, unknown>;
  }) {
    const db = await getMongoDb();

    const studentUpdates: Record<string, unknown> = {};
    if (params.skills !== undefined) studentUpdates.skills = params.skills;
    if (params.cgpa !== undefined) studentUpdates.cgpa = params.cgpa;
    if (params.activeBacklogs !== undefined) studentUpdates.backlogs = params.activeBacklogs;
    if (params.totalHistoricalBacklogs !== undefined) studentUpdates.backlogs_total = params.totalHistoricalBacklogs;
    if (params.attendancePct !== undefined) studentUpdates.attendance_pct = params.attendancePct;
    if (params.rollNumber !== undefined) studentUpdates.roll_number = params.rollNumber;
    if (params.branch !== undefined) studentUpdates.branch = params.branch;
    if (params.batch !== undefined) studentUpdates.batch = params.batch;
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

  async upsertPlacementStatusFromDriveResult(params: {
    tenantId: string;
    studentId: string;
    driveId: string;
    company: string;
    role?: string | null;
    packageLpa?: number | null;
    placedAt: string;
    actorUserId: string;
  }) {
    const db = await getMongoDb();
    const existingStudent = await db.collection("students").findOne(
      { tenant_id: params.tenantId, id: params.studentId },
      { projection: { _id: 0, profile_data: 1 } },
    );

    if (!existingStudent) {
      throw new AppError("STUDENT_NOT_FOUND", "Student not found", 404);
    }

    const existingProfileData = (existingStudent.profile_data ?? {}) as Record<string, unknown>;
    const nextPlacementStatus = {
      isPlaced: true,
      placedAt: params.placedAt,
      placedCompany: params.company,
      placedRole: params.role ?? null,
      placedPackageLpa: params.packageLpa ?? null,
      sourceDriveId: params.driveId,
      correctionReason: null,
      correctedAt: null,
    };

    await db.collection("students").updateOne(
      { tenant_id: params.tenantId, id: params.studentId },
      {
        $set: {
          profile_data: {
            ...existingProfileData,
            placementStatus: nextPlacementStatus,
          },
          updated_at: params.placedAt,
        },
      },
    );

    await db.collection("student_placement_history").updateOne(
      {
        tenant_id: params.tenantId,
        student_id: params.studentId,
        source_drive_id: params.driveId,
        status: "placed",
      },
      {
        $set: {
          company: params.company,
          role: params.role ?? null,
          package_lpa: params.packageLpa ?? null,
          placed_at: params.placedAt,
          updated_at: params.placedAt,
          created_by: params.actorUserId,
          status: "placed",
        },
        $setOnInsert: {
          id: randomUUID(),
          tenant_id: params.tenantId,
          student_id: params.studentId,
          source_drive_id: params.driveId,
          created_at: params.placedAt,
        },
      },
      { upsert: true },
    );

    return nextPlacementStatus;
  },

  async reviewPlacementStatus(params: {
    tenantId: string;
    studentId: string;
    actorUserId: string;
    isPlaced: boolean;
    placedCompany?: string | null;
    placedRole?: string | null;
    placedPackageLpa?: number | null;
    sourceDriveId?: string | null;
    reason: string;
  }) {
    const db = await getMongoDb();
    const now = new Date().toISOString();
    const existingStudent = await db.collection("students").findOne(
      { tenant_id: params.tenantId, id: params.studentId },
      { projection: { _id: 0, profile_data: 1 } },
    );

    if (!existingStudent) {
      throw new AppError("STUDENT_NOT_FOUND", "Student not found", 404);
    }

    const existingProfileData = (existingStudent.profile_data ?? {}) as Record<string, unknown>;
    const placementStatus = params.isPlaced
      ? {
          isPlaced: true,
          placedAt: now,
          placedCompany: params.placedCompany ?? null,
          placedRole: params.placedRole ?? null,
          placedPackageLpa: params.placedPackageLpa ?? null,
          sourceDriveId: params.sourceDriveId ?? null,
          correctionReason: params.reason,
          correctedAt: now,
        }
      : {
          isPlaced: false,
          placedAt: null,
          placedCompany: null,
          placedRole: null,
          placedPackageLpa: null,
          sourceDriveId: params.sourceDriveId ?? null,
          correctionReason: params.reason,
          correctedAt: now,
        };

    await db.collection("students").updateOne(
      { tenant_id: params.tenantId, id: params.studentId },
      {
        $set: {
          profile_data: {
            ...existingProfileData,
            placementStatus,
          },
          updated_at: now,
        },
      },
    );

    await db.collection("student_placement_history").insertOne({
      id: randomUUID(),
      tenant_id: params.tenantId,
      student_id: params.studentId,
      source_drive_id: params.sourceDriveId ?? null,
      company: params.placedCompany ?? null,
      role: params.placedRole ?? null,
      package_lpa: params.placedPackageLpa ?? null,
      placed_at: placementStatus.placedAt,
      status: params.isPlaced ? "placed" : "corrected",
      correction_reason: params.reason,
      created_by: params.actorUserId,
      created_at: now,
      updated_at: now,
    });

    return normalizePlacementStatus({ placementStatus });
  },

  async upsertStudentDriveDeclaration(params: {
    tenantId: string;
    studentId: string;
    driveId: string;
    declarationVersion: string;
    snapshot: Record<string, unknown>;
  }) {
    const db = await getMongoDb();
    const now = new Date().toISOString();

    await db.collection("student_drive_declarations").updateOne(
      {
        tenant_id: params.tenantId,
        student_id: params.studentId,
        drive_id: params.driveId,
      },
      {
        $set: {
          declaration_version: params.declarationVersion,
          snapshot: params.snapshot,
          accepted_at: now,
          updated_at: now,
        },
        $setOnInsert: {
          id: randomUUID(),
          tenant_id: params.tenantId,
          student_id: params.studentId,
          drive_id: params.driveId,
          created_at: now,
        },
      },
      { upsert: true },
    );

    return {
      driveId: params.driveId,
      acceptedAt: now,
      declarationVersion: params.declarationVersion,
    };
  },

  async getStudentDriveDeclaration(tenantId: string, studentId: string, driveId: string) {
    const db = await getMongoDb();
    const row = await db.collection("student_drive_declarations").findOne(
      { tenant_id: tenantId, student_id: studentId, drive_id: driveId },
      {
        projection: {
          _id: 0,
          drive_id: 1,
          accepted_at: 1,
          declaration_version: 1,
          snapshot: 1,
        },
      },
    );

    if (!row) return null;

    return {
      driveId: String(row.drive_id),
      acceptedAt: row.accepted_at ? String(row.accepted_at) : null,
      declarationVersion: row.declaration_version ? String(row.declaration_version) : null,
      snapshot: row.snapshot && typeof row.snapshot === "object"
        ? row.snapshot as Record<string, unknown>
        : {},
    };
  },

  async listStudentDriveDeclarations(tenantId: string, studentId: string) {
    const db = await getMongoDb();
    const rows = await db.collection("student_drive_declarations").find(
      { tenant_id: tenantId, student_id: studentId },
      {
        projection: {
          _id: 0,
          drive_id: 1,
          accepted_at: 1,
          declaration_version: 1,
        },
      },
    ).toArray();

    return rows.map((row) => ({
      driveId: String(row.drive_id),
      acceptedAt: row.accepted_at ? String(row.accepted_at) : null,
      declarationVersion: row.declaration_version ? String(row.declaration_version) : null,
    }));
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

  async getVaultByCompany(tenantId: string, userId: string, companyId: string) {
    const db = await getMongoDb();
    const student = await this.getStudentByUserId(tenantId, userId);
    const company = await db.collection("companies").findOne(
      { id: companyId, $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
      { projection: { _id: 0, id: 1, name: 1, slug: 1, logo_url: 1 } },
    );

    if (!company) {
      throw new AppError("COMPANY_NOT_FOUND", "Company not found", 404);
    }

    const companyName = String(company.name ?? "");
    const companyRegex = { $regex: escapeRegex(companyName), $options: "i" };

    const vaultItems = await db.collection("vault_items").find(
      { tenant_id: tenantId, company_id: companyId },
      { projection: { _id: 0, id: 1, type: 1, title: 1, content: 1, difficulty: 1, topic_id: 1, created_at: 1 } },
    ).sort({ created_at: -1 }).toArray();

    const typedItems = vaultItems.map((item) => ({
      id: String(item.id),
      type: String(item.type),
      title: item.title ? String(item.title) : `${companyName} ${String(item.type)}`,
      content: String(item.content),
      difficulty: item.difficulty ? String(item.difficulty) : null,
      topicId: item.topic_id ? String(item.topic_id) : null,
      createdAt: String(item.created_at),
    }));

    const topicIds = [...new Set(typedItems.map((item) => item.topicId).filter((value): value is string => Boolean(value)))];
    const topicRows = topicIds.length > 0
      ? await db.collection("topics").find(
          { id: { $in: topicIds }, $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
          { projection: { _id: 0, id: 1, name: 1 } },
        ).toArray()
      : [];
    const topicMap = new Map(topicRows.map((topic) => [String(topic.id), String(topic.name ?? "")]));

    const itemTypeCounts = typedItems.reduce<Record<string, number>>((acc, item) => {
      acc[item.type] = (acc[item.type] ?? 0) + 1;
      return acc;
    }, {});

    const topTopics = [...typedItems.reduce<Map<string, number>>((acc, item) => {
      const topicName = item.topicId ? topicMap.get(item.topicId) : null;
      if (topicName) {
        acc.set(topicName, (acc.get(topicName) ?? 0) + 1);
      }
      return acc;
    }, new Map<string, number>()).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    const relatedMocks = await fetchRelatedMocksForCompany(tenantId, String(student.id), companyId, 8);

    const relatedResources = dedupeResourceItems([
      ...(await fetchSharedResources({
        regex: companyRegex,
        limit: 24,
        includeSearchMetadata: true,
      })),
      ...(
        await db.collection("resources").find(
          {
            tenant_id: tenantId,
            is_active: true,
            $or: [
              { title: companyRegex },
              { description: companyRegex },
              { source_pdf: companyRegex },
              { "search_index.search_text": companyRegex },
              { "search_index.summary_short": companyRegex },
            ],
          },
          {
            projection: {
              _id: 0,
              id: 1,
              title: 1,
              description: 1,
              url: 1,
              resource_type: 1,
              thumbnail_url: 1,
              duration_sec: 1,
              topic_id: 1,
              source_pdf: 1,
              search_index: 1,
              branch_relevance: 1,
              career_tracks: 1,
              content_pack_labels: 1,
              recommended_for: 1,
            },
          },
        ).sort({ created_at: -1 }).limit(24).toArray()
      ).map((resource) => toResourceDto(resource, { includeSearchMetadata: true })),
    ])
      .filter((resource) => isVisibleLocalResource(resource))
      .slice(0, 8);

    const upcomingDrivesRows = await db.collection("drives").find(
      {
        tenant_id: tenantId,
        deleted_at: null,
        company: companyName,
      },
      { projection: { _id: 0, id: 1, company: 1, role: 1, drive_date: 1, status: 1, eligible_count: 1 } },
    ).sort({ drive_date: 1 }).limit(5).toArray();

    const relatedMockIds = relatedMocks.map((item) => item.id);
    const [attemptRows, resourceOpens] = await Promise.all([
      relatedMockIds.length > 0
        ? db.collection("student_attempts").find(
            {
              tenant_id: tenantId,
              student_id: String(student.id),
              test_id: { $in: relatedMockIds },
              status: "submitted",
            },
            { projection: { _id: 0, test_id: 1, score: 1, submitted_at: 1, topic_breakdown: 1 } },
          ).toArray()
        : Promise.resolve([]),
      relatedResources.length > 0
        ? db.collection("resource_view_events").find(
            {
              tenant_id: tenantId,
              student_id: String(student.id),
              resource_id: { $in: relatedResources.map((item) => item.id) },
              event_type: "open",
            },
            { projection: { _id: 0, resource_id: 1, created_at: 1 } },
          ).toArray()
        : Promise.resolve([]),
    ]);

    const globalResourceOpenCounts = relatedResources.length > 0
      ? await db.collection("resource_view_events").aggregate([
          {
            $match: {
              tenant_id: tenantId,
              resource_id: { $in: relatedResources.map((item) => item.id) },
              event_type: "open",
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

    const attemptedMockIds = new Set(attemptRows.map((row) => String(row.test_id)));
    const avgMockScore = attemptRows.length > 0
      ? Number((attemptRows.reduce((sum, row) => sum + Number(row.score ?? 0), 0) / attemptRows.length).toFixed(1))
      : 0;
    const lastAttemptAt = maxIsoDate(attemptRows.map((row) => String(row.submitted_at ?? "")));
    const openedResourceIds = new Set(resourceOpens.map((row) => String(row.resource_id)));
    const lastResourceOpenAt = maxIsoDate(resourceOpens.map((row) => String(row.created_at ?? "")));
    const globalOpenCountMap = new Map(globalResourceOpenCounts.map((row) => [String(row._id), Number(row.count ?? 0)]));

    const weakTopicScores = new Map<string, number>();
    for (const row of attemptRows) {
      const breakdown = row.topic_breakdown && typeof row.topic_breakdown === "object"
        ? row.topic_breakdown as Record<string, { correct?: number; total?: number }>
        : {};
      for (const [topicId, value] of Object.entries(breakdown)) {
        const total = Number(value?.total ?? 0);
        const correct = Number(value?.correct ?? 0);
        if (total <= 0) continue;
        const accuracy = correct / total;
        weakTopicScores.set(topicId, Math.min(weakTopicScores.get(topicId) ?? 1, accuracy));
      }
    }
    const weakTopicNames = [...weakTopicScores.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, 4)
      .map(([topicId]) => topicMap.get(topicId))
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());

    const scoredResources = relatedResources.map((resource) => {
      const summaryShort = "summaryShort" in resource ? String(resource.summaryShort ?? "") : "";
      const keyTopics = "keyTopics" in resource && Array.isArray(resource.keyTopics)
        ? resource.keyTopics.map((value) => String(value))
        : [];
      const haystack = `${resource.title} ${resource.description} ${summaryShort} ${keyTopics.join(" ")}`.toLowerCase();
      const topTopicMatches = topTopics.filter((topic) => haystack.includes(topic.name.toLowerCase())).length;
      const weakTopicMatches = weakTopicNames.filter((topic) => haystack.includes(topic)).length;
      const companyMention = haystack.includes(companyName.toLowerCase());
      const globalOpenCount = globalOpenCountMap.get(resource.id) ?? 0;
      const openedByStudent = openedResourceIds.has(resource.id);
      const rankScore =
        (companyMention ? 50 : 0) +
        topTopicMatches * 14 +
        weakTopicMatches * 18 +
        Math.min(globalOpenCount, 25) +
        (avgMockScore < 65 ? 8 : 0) -
        (openedByStudent ? 12 : 0);

      const rankingReasons = [
        companyMention ? `Explicitly mentions ${companyName}` : null,
        weakTopicMatches > 0 ? `Covers weaker areas: ${weakTopicNames.slice(0, weakTopicMatches).join(", ")}` : null,
        topTopicMatches > 0 ? `Matches common ${companyName} focus topics` : null,
        globalOpenCount >= 5 ? `Popular with students (${globalOpenCount} opens)` : null,
        openedByStudent ? "Already opened by you" : null,
      ].filter((value): value is string => Boolean(value));

      return {
        ...resource,
        companyRelevanceScore: rankScore,
        companyRankingReasons: rankingReasons,
        globalOpenCount,
        openedByStudent,
      };
    }).sort((a, b) => b.companyRelevanceScore - a.companyRelevanceScore);

    const quickStart = [
      ...typedItems.filter((item) => item.type === "tip"),
      ...typedItems.filter((item) => item.type === "past_paper"),
      ...typedItems.filter((item) => item.type === "experience"),
      ...typedItems.filter((item) => item.type === "question"),
    ]
      .filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index)
      .slice(0, 4)
      .map((item) => ({
        ...item,
        topicName: item.topicId ? topicMap.get(item.topicId) ?? null : null,
      }));

    const mapVaultItems = (items: typeof typedItems) =>
      items.map((item) => ({
        ...item,
        topicName: item.topicId ? topicMap.get(item.topicId) ?? null : null,
      }));

    return {
      company: {
        id: String(company.id),
        name: companyName,
        slug: String(company.slug ?? ""),
        logoUrl: company.logo_url ? String(company.logo_url) : null,
      },
      stats: {
        totalItems: typedItems.length,
        mockCount: relatedMocks.length,
        resourceCount: relatedResources.length,
        upcomingDriveCount: upcomingDrivesRows.length,
        typeCounts: {
          question: itemTypeCounts.question ?? 0,
          tip: itemTypeCounts.tip ?? 0,
          pastPaper: itemTypeCounts.past_paper ?? 0,
          experience: itemTypeCounts.experience ?? 0,
        },
      },
      studentProgress: {
        attemptedMocks: attemptedMockIds.size,
        mockCoveragePct: relatedMocks.length > 0 ? Math.round((attemptedMockIds.size / relatedMocks.length) * 100) : 0,
        avgMockScore,
        openedResources: openedResourceIds.size,
        resourceCoveragePct: relatedResources.length > 0 ? Math.round((openedResourceIds.size / relatedResources.length) * 100) : 0,
        lastAttemptAt,
        lastResourceOpenAt,
      },
      prepSignals: {
        topTopics,
        recommendedFocus: topTopics.slice(0, 3).map((item) => item.name),
        weakTopics: weakTopicNames,
        roundHints: [
          itemTypeCounts.past_paper ? "Online Assessment" : null,
          itemTypeCounts.question ? "Technical Screening" : null,
          itemTypeCounts.experience ? "Interview Experience" : null,
          itemTypeCounts.tip ? "Last-Minute Revision" : null,
        ].filter((value): value is string => Boolean(value)),
      },
      sections: {
        quickStart,
        pastPapers: mapVaultItems(typedItems.filter((item) => item.type === "past_paper")),
        interviewExperiences: mapVaultItems(typedItems.filter((item) => item.type === "experience")),
        quickTips: mapVaultItems(typedItems.filter((item) => item.type === "tip")),
        questionBank: mapVaultItems(typedItems.filter((item) => item.type === "question")),
        relatedMocks,
        relatedResources: scoredResources,
        upcomingDrives: upcomingDrivesRows.map((drive) => ({
          id: String(drive.id),
          company: String(drive.company ?? companyName),
          role: String(drive.role ?? "Role"),
          driveDate: String(drive.drive_date),
          status: String(drive.status ?? "upcoming"),
          eligibleCount: Number(drive.eligible_count ?? 0),
        })),
      },
    };
  },

  async getResources(tenantId: string, topicId?: string, branch?: string) {
    const cacheKey = `${tenantId}::${topicId ?? "*"}::${normalizeBranchCacheKey(branch)}`;
    const cached = resourceListCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.items;
    }

    const shared = await fetchSharedResources({
      topicId,
      limit: 2500,
      includeSearchMetadata: false,
    });

    const db = await getMongoDb();
    const filter: Record<string, unknown> = { tenant_id: tenantId, is_active: true };
    if (topicId) filter.topic_id = topicId;

    const data = await db.collection("resources").find(
      filter,
      { projection: { _id: 0, id: 1, title: 1, description: 1, url: 1, resource_type: 1, thumbnail_url: 1, duration_sec: 1, topic_id: 1, source_pdf: 1, branch_relevance: 1, career_tracks: 1, content_pack_labels: 1, recommended_for: 1 } },
    ).sort({ created_at: -1 }).toArray();

    const legacy = data.map((resource) => toResourceDto(resource, { includeSearchMetadata: false }));
    const items = filterResourcesForStudentBranch(
      dedupeResourceItems([...shared, ...legacy]),
      branch,
    );
    resourceListCache.set(cacheKey, {
      expiresAt: Date.now() + resourceListCacheTtlMs,
      items,
    });
    return items;
  },

  async getResourcesPage(
    tenantId: string,
    params?: {
      topicId?: string;
      limit?: number;
      cursor?: string;
      filter?: ResourceListFilter;
      branch?: string;
    },
  ) {
    const limit = Math.max(1, Math.min(Number(params?.limit ?? 24), 100));
    const allItems = await this.getResources(tenantId, params?.topicId, params?.branch);
    const filteredItems = params?.filter && params.filter !== "all"
      ? allItems.filter((item) => matchesResourceListFilter(item, params.filter!))
      : allItems;
    const startIndex = params?.cursor
      ? Math.max(0, filteredItems.findIndex((item) => item.id === params.cursor) + 1)
      : 0;
    const slicedItems = filteredItems.slice(startIndex, startIndex + limit + 1);
    const hasMore = slicedItems.length > limit;
    const items = hasMore ? slicedItems.slice(0, limit) : slicedItems;

    return {
      items,
      hasMore,
      nextCursor: hasMore ? String(items[items.length - 1]?.id ?? "") : null,
    };
  },

  async getResourceById(tenantId: string, resourceId: string) {
    const db = await getMongoDb();
    const [sharedRow] = await db.collection("shared_resources").aggregate([
      { $match: { id: resourceId, is_active: true } },
      {
        $lookup: {
          from: "assets",
          localField: "asset_id",
          foreignField: "id",
          as: "asset",
        },
      },
      { $unwind: { path: "$asset", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          id: 1,
          title: 1,
          description: 1,
          url: 1,
          resource_type: 1,
          thumbnail_url: 1,
          duration_sec: 1,
          topic_id: 1,
          source_pdf: 1,
          search_index: 1,
          branch_relevance: 1,
          career_tracks: 1,
          content_pack_labels: 1,
          recommended_for: 1,
          asset: "$asset",
        },
      },
      { $limit: 1 },
    ]).toArray();

    const sharedResource = sharedRow
      ? toResourceDtoWithAsset(
          sharedRow as Record<string, unknown>,
          (sharedRow as { asset?: Record<string, unknown> }).asset,
          { includeSearchMetadata: true },
        )
      : null;

    if (sharedResource && isVisibleLocalResource(sharedResource)) {
      return sharedResource;
    }

    const legacy = await db.collection("resources").findOne(
      { tenant_id: tenantId, is_active: true, id: resourceId },
      { projection: { _id: 0, id: 1, title: 1, description: 1, url: 1, resource_type: 1, thumbnail_url: 1, duration_sec: 1, topic_id: 1, source_pdf: 1, search_index: 1, branch_relevance: 1, career_tracks: 1, content_pack_labels: 1, recommended_for: 1 } },
    );

    if (!legacy) {
      return null;
    }

    const dto = toResourceDto(legacy, { includeSearchMetadata: true });
    return isVisibleLocalResource(dto) ? dto : null;
  },

  async recordResourceViewEvent(params: {
    tenantId: string;
    studentId: string;
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
    await ensureResourceViewIndexes();
    const db = await getMongoDb();
    const now = new Date().toISOString();
    const payload = {
      tenant_id: params.tenantId,
      student_id: params.studentId,
      resource_id: params.resourceId,
      event_type: params.eventType,
      session_id: params.sessionId,
      duration_sec: Number(params.durationSec ?? 0),
      progress_pct: typeof params.progressPct === "number" ? Number(params.progressPct) : null,
      page_number: typeof params.pageNumber === "number" ? Number(params.pageNumber) : null,
      scroll_depth_pct: typeof params.scrollDepthPct === "number" ? Number(params.scrollDepthPct) : null,
      source_context: params.sourceContext ?? "resource_library",
      metadata: params.metadata ?? {},
      updated_at: now,
    };

    if (params.eventType === "heartbeat" || params.eventType === "external_redirect") {
      await db.collection("resource_view_events").insertOne({
        id: randomUUID(),
        ...payload,
        created_at: now,
      });
      return;
    }

    await db.collection("resource_view_events").updateOne(
      {
        tenant_id: params.tenantId,
        student_id: params.studentId,
        resource_id: params.resourceId,
        session_id: params.sessionId,
        event_type: params.eventType,
      },
      {
        $set: payload,
        $setOnInsert: {
          id: randomUUID(),
          created_at: now,
        },
      },
      { upsert: true },
    );
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

  async searchResourcesByTopicName(tenantId: string, topicQuery: string, branch?: string) {
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
    const queryTerms = tokenizeQuery(query);
    const matchedTopics = await db.collection("topics").find(
      {
        $or: [{ tenant_id: tenantId }, { tenant_id: null }],
        name: regex,
      },
      { projection: { _id: 0, id: 1, name: 1 } },
    ).sort({ name: 1 }).limit(10).toArray();

    const topicIds = matchedTopics.map((topic) => String(topic.id));
    const sharedResources = await fetchSharedResources({
      regex,
      queryTerms,
      topicIds,
      limit: 1500,
      includeSearchMetadata: true,
    });

    const filter: Record<string, unknown> = {
      tenant_id: tenantId,
      is_active: true,
    };

    const metadataPhraseConditions = [
      { title: regex },
      { description: regex },
      { source_pdf: regex },
      { url: regex },
      { "search_index.search_text": regex },
      { "search_index.summary_short": regex },
      { "search_index.keywords": regex },
      { "search_index.key_topics": regex },
    ];
    const tokenConditions = queryTerms.flatMap((term) => {
      const tokenRegex = { $regex: escapeRegex(term), $options: "i" };
      return [
        { title: tokenRegex },
        { description: tokenRegex },
        { source_pdf: tokenRegex },
        { url: tokenRegex },
        { "search_index.search_text": tokenRegex },
        { "search_index.summary_short": tokenRegex },
        { "search_index.keywords": tokenRegex },
        { "search_index.key_topics": tokenRegex },
      ];
    });

    const orConditions: Array<Record<string, unknown>> = [...metadataPhraseConditions, ...tokenConditions];
    if (topicIds.length > 0) {
      orConditions.unshift({ topic_id: { $in: topicIds } });
    }
    filter.$or = orConditions;

    const resources = await db.collection("resources").find(
      filter,
      { projection: { _id: 0, id: 1, title: 1, description: 1, url: 1, resource_type: 1, thumbnail_url: 1, duration_sec: 1, topic_id: 1, source_pdf: 1, search_index: 1, branch_relevance: 1, career_tracks: 1, content_pack_labels: 1, recommended_for: 1 } },
    ).sort({ created_at: -1 }).limit(350).toArray();

    const legacyResources = resources.map((resource) => toResourceDto(resource, { includeSearchMetadata: true }));

    return {
      query,
      matchedTopics: matchedTopics.map((topic) => ({
        id: String(topic.id),
        name: String(topic.name),
      })),
      resources: filterResourcesForStudentBranch(
        dedupeResourceItems([...sharedResources, ...legacyResources]),
        branch,
      ),
    };
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
    const db = await getMongoDb();
    const todayIso = new Date().toISOString().slice(0, 10);
    const start7 = new Date(Date.now() - (7 * 86_400_000)).toISOString().slice(0, 10);
    const start14 = new Date(Date.now() - (14 * 86_400_000)).toISOString().slice(0, 10);
    const start30 = new Date(Date.now() - (30 * 86_400_000)).toISOString().slice(0, 10);

    const [
      data,
      drives,
      driveResults,
      resourceViewEvents,
      attempts,
      aiConversations,
    ] = await Promise.all([
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
            cgpa: 1,
            backlogs: 1,
            backlogs_total: 1,
            attendance_pct: 1,
            readiness_score: 1,
            profile_data: 1,
            skills: 1,
            created_at: 1,
          },
        },
      ).toArray(),
      db.collection("drives").find(
        { tenant_id: tenantId, deleted_at: null },
        { projection: { _id: 0, id: 1, drive_date: 1, company: 1, role: 1, status: 1 } },
      ).toArray(),
      db.collection("drive_results").find(
        { tenant_id: tenantId },
        {
          projection: {
            _id: 0,
            student_id: 1,
            drive_id: 1,
            status: 1,
            outcome: 1,
            application_state: 1,
            created_at: 1,
            updated_at: 1,
          },
        },
      ).toArray(),
      db.collection("resource_view_events").find(
        { tenant_id: tenantId, created_at: { $gte: `${start30}T00:00:00.000Z` } },
        { projection: { _id: 0, student_id: 1, created_at: 1 } },
      ).toArray(),
      db.collection("student_attempts").find(
        { tenant_id: tenantId, status: "submitted", submitted_at: { $gte: `${start30}T00:00:00.000Z` } },
        { projection: { _id: 0, student_id: 1, submitted_at: 1, score: 1 } },
      ).toArray(),
      db.collection("ai_conversations").find(
        { tenant_id: tenantId, updated_at: { $gte: `${start30}T00:00:00.000Z` } },
        { projection: { _id: 0, student_id: 1, updated_at: 1 } },
      ).toArray(),
    ]);

    const userIds = data.map((row) => String(row.user_id));
    const users = userIds.length > 0
      ? await db.collection("users").find(
          { tenant_id: tenantId, id: { $in: userIds } },
          { projection: { id: 1, full_name: 1, email: 1 } },
        ).toArray()
      : [];
    const userMap = new Map(users.map((user) => [String(user.id), user]));

    const normalizedQuery = params.q?.trim().toLowerCase() ?? "";
    const prnQuery = params.prn?.trim().toLowerCase() ?? "";
    const targetRoleQuery = params.targetRole?.trim().toLowerCase() ?? "";
    const preferredLocationQuery = params.preferredLocation?.trim().toLowerCase() ?? "";
    const upcomingDriveMap = new Map(
      drives
        .filter((drive) => String(drive.status ?? "") === "upcoming" || String(drive.drive_date ?? "") >= todayIso)
        .map((drive) => [String(drive.id), {
          driveDate: String(drive.drive_date ?? ""),
          company: String(drive.company ?? ""),
          role: drive.role ? String(drive.role) : null,
          status: String(drive.status ?? ""),
        }]),
    );
    const driveResultsByStudent = new Map<string, Array<Record<string, unknown>>>();
    const resourceViewsByStudent = new Map<string, string[]>();
    const attemptsByStudent = new Map<string, Array<{ submittedAt: string; score: number }>>();
    const aiByStudent = new Map<string, string[]>();

    driveResults.forEach((entry) => {
      const key = String(entry.student_id ?? "");
      const list = driveResultsByStudent.get(key) ?? [];
      list.push(entry as Record<string, unknown>);
      driveResultsByStudent.set(key, list);
    });
    resourceViewEvents.forEach((entry) => {
      const key = String(entry.student_id ?? "");
      const list = resourceViewsByStudent.get(key) ?? [];
      list.push(String(entry.created_at ?? ""));
      resourceViewsByStudent.set(key, list);
    });
    attempts.forEach((entry) => {
      const key = String(entry.student_id ?? "");
      const list = attemptsByStudent.get(key) ?? [];
      list.push({
        submittedAt: String(entry.submitted_at ?? ""),
        score: Number(entry.score ?? 0),
      });
      attemptsByStudent.set(key, list);
    });
    aiConversations.forEach((entry) => {
      const key = String(entry.student_id ?? "");
      const list = aiByStudent.get(key) ?? [];
      list.push(String(entry.updated_at ?? ""));
      aiByStudent.set(key, list);
    });

    const allItems = data.map((row) => {
      const user = userMap.get(String(row.user_id));
      const normalizedProfile = normalizeStudentProfileData(row.profile_data);
      const placementStatus = normalizePlacementStatus(row.profile_data);
      const summary = buildStudentProfileSummary({
        student: row as Record<string, unknown>,
        user: {
          full_name: user?.full_name,
          email: user?.email,
        },
      });
      const declarationStatus = buildStudentDeclarationStatus({
        student: row as Record<string, unknown>,
        user: {
          full_name: user?.full_name,
          email: user?.email,
        },
      });
      const studentId = String(row.id);
      const profileCertified = declarationStatus.profileCertification.isCertified;
      const hasResumeReady = Boolean(
        summary.studentEditableProfile.resumeStorageProvider
        || summary.studentEditableProfile.resumeDriveFileId
        || summary.studentEditableProfile.resumeDriveWebLink
        || summary.studentEditableProfile.resumeUrl,
      );
      const driveList = (driveResultsByStudent.get(studentId) ?? [])
        .filter((item) => upcomingDriveMap.has(String(item.drive_id ?? "")));
      const activitySignals = [
        ...(resourceViewsByStudent.get(studentId) ?? []),
        ...(attemptsByStudent.get(studentId) ?? []).map((item) => item.submittedAt),
        ...(aiByStudent.get(studentId) ?? []),
        ...driveList.flatMap((item) => [String(item.updated_at ?? ""), String(item.created_at ?? "")]),
      ];
      const lastActiveAt = maxIsoDate(activitySignals);
      const isActive7d = Boolean(lastActiveAt && lastActiveAt.slice(0, 10) >= start7);
      const attempts30d = attemptsByStudent.get(studentId) ?? [];
      const lastMockSubmittedAt = maxIsoDate(attempts30d.map((item) => item.submittedAt));
      const recentMockAttempts14d = attempts30d.filter((item) => item.submittedAt.slice(0, 10) >= start14).length;
      const mockAvg = attempts30d.length > 0
        ? Number((attempts30d.reduce((sum, item) => sum + item.score, 0) / attempts30d.length).toFixed(2))
        : 0;
      const eligibleUpcomingDriveIds = new Set(
        driveList
          .filter((item) => String(item.status ?? "") === "eligible" || ["shortlisted", "selected"].includes(String(item.outcome ?? "")))
          .map((item) => String(item.drive_id ?? "")),
      );
      const blockedUpcomingDriveIds = new Set(
        driveList
          .filter((item) => !eligibleUpcomingDriveIds.has(String(item.drive_id ?? "")))
          .map((item) => String(item.drive_id ?? "")),
      );
      const nearestUpcomingDriveDate = [...new Set(
        driveList
          .map((item) => upcomingDriveMap.get(String(item.drive_id ?? ""))?.driveDate ?? "")
          .filter(Boolean),
      )].sort((left, right) => left.localeCompare(right))[0] ?? null;
      const appliedRecently = driveList.some((item) => {
        const applicationState = String(item.application_state ?? "");
        const appliedAt = String(item.updated_at ?? item.created_at ?? "");
        return applicationState === "applied" && appliedAt.slice(0, 10) >= start30;
      });
      const profileComplete = summary.profileCompleteness.pct >= 100;

      let interventionLabel = "Stable";
      if (!hasResumeReady) {
        interventionLabel = "Resume missing";
      } else if (placementStatus.isPlaced) {
        interventionLabel = "Placed";
      } else if (!profileCertified) {
        interventionLabel = "Uncertified";
      } else if (!profileComplete) {
        interventionLabel = "Incomplete profile";
      } else if (eligibleUpcomingDriveIds.size > 0 && !appliedRecently) {
        interventionLabel = "Eligible but not applied";
      } else if (profileComplete && profileCertified && hasResumeReady && !isActive7d) {
        interventionLabel = "Ready but inactive";
      } else if (blockedUpcomingDriveIds.size > 0 && eligibleUpcomingDriveIds.size === 0) {
        interventionLabel = "Academically blocked";
      } else if (recentMockAttempts14d === 0 || mockAvg < 55) {
        interventionLabel = "Needs mock push";
      }

      let primaryBlocker: string | null = null;
      if (!hasResumeReady) {
        primaryBlocker = "Resume missing";
      } else if (placementStatus.isPlaced) {
        primaryBlocker = "Already placed";
      } else if (!profileCertified) {
        primaryBlocker = "Profile certification pending";
      } else if (!profileComplete) {
        primaryBlocker = "Profile incomplete";
      } else if (blockedUpcomingDriveIds.size > 0 && Number(row.backlogs ?? 0) > 0) {
        primaryBlocker = "Backlog criteria";
      } else if (blockedUpcomingDriveIds.size > 0) {
        primaryBlocker = "Drive criteria not met";
      } else if (!isActive7d) {
        primaryBlocker = "No recent activity";
      }

      let riskScore = 0;
      if (!hasResumeReady) riskScore += 30;
      if (placementStatus.isPlaced) riskScore = Math.max(0, riskScore - 25);
      if (!profileCertified) riskScore += 25;
      if (!profileComplete) riskScore += 20;
      if (!isActive7d) riskScore += 15;
      if (eligibleUpcomingDriveIds.size > 0 && !appliedRecently) riskScore += 20;
      if ((recentMockAttempts14d === 0 || mockAvg < 55) && eligibleUpcomingDriveIds.size > 0) riskScore += 10;
      if (blockedUpcomingDriveIds.size > 0 && eligibleUpcomingDriveIds.size === 0) riskScore += 10;
      riskScore = Math.min(riskScore, 100);
      const needsIntervention = placementStatus.isPlaced ? false : riskScore > 0 || interventionLabel !== "Stable";

      return {
        id: studentId,
        userId: String(row.user_id),
        createdAt: String(row.created_at ?? ""),
        fullName: String(user?.full_name ?? ""),
        email: String(user?.email ?? ""),
        prn: normalizedProfile.prn,
        rollNumber: row.roll_number ? String(row.roll_number) : "",
        branch: String(row.branch ?? ""),
        batch: String(row.batch ?? ""),
        cgpa: Number(row.cgpa ?? 0),
        backlogs: Number(row.backlogs ?? 0),
        totalHistoricalBacklogs: Number(row.backlogs_total ?? normalizedProfile.totalHistoricalBacklogs ?? 0),
        attendancePct: Number(row.attendance_pct ?? 0),
        readinessScore: Number(row.readiness_score ?? 0),
        profileCompletenessPct: summary.profileCompleteness.pct,
        missingRequiredCount: summary.missingRequiredFields.length,
        missingResume: !hasResumeReady,
        waitingOnStudent: summary.missingStudentFields.length > 0,
        waitingOnCollege: summary.pendingCollegeFields.length > 0,
        canAccessResources: summary.canAccessResources,
        canAccessMockTests: summary.canAccessMockTests,
        isProfileCertified: profileCertified,
        isProfileLocked: declarationStatus.profileCertification.isLocked,
        placementStatus,
        hasResumeReady,
        isActive7d,
        appliedRecently,
        eligibleUpcomingDriveCount: eligibleUpcomingDriveIds.size,
        blockedUpcomingDriveCount: blockedUpcomingDriveIds.size,
        nearestUpcomingDriveDate,
        primaryBlocker,
        needsIntervention,
        interventionLabel,
        lastActiveAt,
        riskScore,
        mockAttempts30d: attempts30d.length,
        lastMockSubmittedAt,
        targetRoles: summary.studentEditableProfile.targetRoles,
        preferredLocations: summary.studentEditableProfile.preferredLocations,
        willingToRelocate: summary.studentEditableProfile.willingToRelocate,
      };
    }).filter((item) => {
      if (normalizedQuery) {
        const haystack = [item.fullName, item.email, item.rollNumber, item.prn]
          .map((value) => value.toLowerCase())
          .join(" ");
        if (!haystack.includes(normalizedQuery)) return false;
      }

      if (params.batch && item.batch !== params.batch) return false;
      if (params.branch && item.branch !== params.branch) return false;
      if (prnQuery && !item.prn.toLowerCase().includes(prnQuery)) return false;
      if (params.cgpaMin !== undefined && item.cgpa < params.cgpaMin) return false;
      if (params.cgpaMax !== undefined && item.cgpa > params.cgpaMax) return false;
      if (params.readinessMin !== undefined && item.readinessScore < params.readinessMin) return false;
      if (params.readinessMax !== undefined && item.readinessScore > params.readinessMax) return false;
      if (params.attendanceMin !== undefined && item.attendancePct < params.attendanceMin) return false;
      if (params.attendanceMax !== undefined && item.attendancePct > params.attendanceMax) return false;
      if (params.backlogsMin !== undefined && item.backlogs < params.backlogsMin) return false;
      if (params.backlogsMax !== undefined && item.backlogs > params.backlogsMax) return false;
      if (
        params.totalHistoricalBacklogsMin !== undefined
        && item.totalHistoricalBacklogs < params.totalHistoricalBacklogsMin
      ) return false;
      if (
        params.totalHistoricalBacklogsMax !== undefined
        && item.totalHistoricalBacklogs > params.totalHistoricalBacklogsMax
      ) return false;
      if (
        params.profileCompletenessMin !== undefined
        && item.profileCompletenessPct < params.profileCompletenessMin
      ) return false;
      if (
        params.profileCompletenessMax !== undefined
        && item.profileCompletenessPct > params.profileCompletenessMax
      ) return false;
      if (params.missingResume !== undefined && item.missingResume !== params.missingResume) return false;
      if (params.waitingOnStudent !== undefined && item.waitingOnStudent !== params.waitingOnStudent) return false;
      if (params.waitingOnCollege !== undefined && item.waitingOnCollege !== params.waitingOnCollege) return false;
      if (params.canAccessResources !== undefined && item.canAccessResources !== params.canAccessResources) return false;
      if (params.canAccessMockTests !== undefined && item.canAccessMockTests !== params.canAccessMockTests) return false;
      if (
        targetRoleQuery
        && !item.targetRoles.some((role) => role.toLowerCase().includes(targetRoleQuery))
      ) return false;
      if (
        preferredLocationQuery
        && !item.preferredLocations.some((location) => location.toLowerCase().includes(preferredLocationQuery))
      ) return false;
      if (params.willingToRelocate !== undefined && item.willingToRelocate !== params.willingToRelocate) return false;
      if (params.eligibleForUpcomingDrive !== undefined && (item.eligibleUpcomingDriveCount > 0) !== params.eligibleForUpcomingDrive) return false;
      if (params.isCertified !== undefined && item.isProfileCertified !== params.isCertified) return false;
      if (params.hasResume !== undefined && item.hasResumeReady !== params.hasResume) return false;
      if (params.isPlaced !== undefined && item.placementStatus.isPlaced !== params.isPlaced) return false;
      if (params.isActive7d !== undefined && item.isActive7d !== params.isActive7d) return false;
      if (params.appliedRecently !== undefined && item.appliedRecently !== params.appliedRecently) return false;
      if (params.needsIntervention !== undefined && item.needsIntervention !== params.needsIntervention) return false;

      return true;
    });

    const sortDirection = params.sortDir === "asc" ? 1 : -1;
    const sortedItems = [...allItems].sort((left, right) => {
      const compareNumber = (a: number, b: number) => (a === b ? 0 : a > b ? 1 : -1);
      const compareString = (a: string, b: string) => a.localeCompare(b);
      const compareNullableString = (a: string | null, b: string | null) => {
        if (!a && !b) return 0;
        if (!a) return 1;
        if (!b) return -1;
        return a.localeCompare(b);
      };

      let result = 0;
      if (params.sortBy === "cgpa") {
        result = compareNumber(left.cgpa, right.cgpa);
      } else if (params.sortBy === "risk_score") {
        result = compareNumber(left.riskScore, right.riskScore);
      } else if (params.sortBy === "upcoming_drive_impact") {
        result = compareNumber(left.eligibleUpcomingDriveCount, right.eligibleUpcomingDriveCount);
        if (result === 0) {
          result = compareNullableString(left.nearestUpcomingDriveDate, right.nearestUpcomingDriveDate) * -1;
        }
      } else if (params.sortBy === "activity") {
        result = compareNullableString(left.lastActiveAt, right.lastActiveAt);
      } else if (params.sortBy === "readiness_score") {
        result = compareNumber(left.readinessScore, right.readinessScore);
      } else if (params.sortBy === "profile_completeness") {
        result = compareNumber(left.profileCompletenessPct, right.profileCompletenessPct);
      } else {
        result = compareString(left.createdAt, right.createdAt);
      }

      if (result === 0) {
        result = left.id.localeCompare(right.id);
      }

      return result * sortDirection;
    });

    const startIndex = params.cursor
      ? Math.max(0, sortedItems.findIndex((item) => item.id === params.cursor) + 1)
      : 0;
    const slicedItems = sortedItems.slice(startIndex, startIndex + params.limit + 1);
    const hasMore = slicedItems.length > params.limit;
    const items = hasMore ? slicedItems.slice(0, params.limit) : slicedItems;

    return {
      items,
      hasMore,
      nextCursor: hasMore ? String(items[items.length - 1]?.id) : null,
    };
  },

  async getStudentByIdForTpo(tenantId: string, studentId: string) {
    const db = await getMongoDb();

    const student = await db.collection("students").findOne(
      { tenant_id: tenantId, id: studentId },
      { projection: { _id: 0, id: 1, user_id: 1, roll_number: 1, branch: 1, batch: 1, cgpa: 1, backlogs: 1, backlogs_total: 1, attendance_pct: 1, skills: 1, readiness_score: 1, profile_data: 1 } },
    );

    if (!student) {
      throw new AppError("STUDENT_NOT_FOUND", "Student not found", 404);
    }

    const resourceWindow30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const resourceWindow7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [user, attempts, mastery, driveResults, placementHistory, resourceEvents30d] = await Promise.all([
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
        {
          projection: {
            drive_id: 1,
            status: 1,
            outcome: 1,
            registered: 1,
            appeared: 1,
            offer_date: 1,
            designation_offered: 1,
            final_ctc_lpa: 1,
            joining_status: 1,
            offer_letter_reference: 1,
            offer_letter_url: 1,
            joining_letter_url: 1,
            selection_source: 1,
            verification_status: 1,
            non_placement_reason: 1,
            action_plan: 1,
            result_released_at: 1,
            result_released_by: 1,
            result_notification_status: 1,
            result_notification_communication_id: 1,
            offer_letter_shared_at: 1,
            offer_letter_shared_by: 1,
            student_result_viewed_at: 1,
            created_at: 1,
            updated_at: 1,
          },
        },
      ).sort({ updated_at: -1 }).toArray(),
      db.collection("student_placement_history").find(
        { tenant_id: tenantId, student_id: studentId },
        { projection: { _id: 0 } },
      ).sort({ created_at: -1 }).limit(20).toArray(),
      db.collection("resource_view_events").find(
        {
          tenant_id: tenantId,
          student_id: studentId,
          event_type: { $in: ["open", "external_redirect"] },
          created_at: { $gte: resourceWindow30d },
        },
        { projection: { _id: 0, created_at: 1, event_type: 1 } },
      ).sort({ created_at: -1 }).limit(120).toArray(),
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

    const resourceActiveDays7d = new Set(
      resourceEvents30d
        .map((event) => String(event.created_at ?? ""))
        .filter((createdAt) => createdAt >= resourceWindow7d)
        .map((createdAt) => createdAt.slice(0, 10)),
    ).size;
    const lastMockSubmittedAt = attempts[0]?.submitted_at ? String(attempts[0].submitted_at) : null;
    const lastResourceViewedAt = resourceEvents30d[0]?.created_at ? String(resourceEvents30d[0].created_at) : null;
    const lastPlatformActivityAt = [lastMockSubmittedAt, lastResourceViewedAt]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.localeCompare(left))[0] ?? null;

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
      totalHistoricalBacklogs: Number((student as { backlogs_total?: unknown }).backlogs_total ?? 0),
      attendancePct: Number(student.attendance_pct ?? 0),
      skills: (student.skills ?? []) as string[],
      readinessScore: Number(student.readiness_score ?? 0),
      profileData: (student.profile_data ?? {}) as Record<string, unknown>,
      placementStatus: normalizePlacementStatus(student.profile_data),
      placementHistory: placementHistory.map((entry) => ({
        id: String(entry.id ?? ""),
        status: String(entry.status ?? ""),
        company: entry.company ? String(entry.company) : null,
        role: entry.role ? String(entry.role) : null,
        packageLpa: entry.package_lpa === undefined || entry.package_lpa === null ? null : Number(entry.package_lpa),
        placedAt: entry.placed_at ? String(entry.placed_at) : null,
        sourceDriveId: entry.source_drive_id ? String(entry.source_drive_id) : null,
        correctionReason: entry.correction_reason ? String(entry.correction_reason) : null,
        createdAt: String(entry.created_at ?? ""),
        createdBy: entry.created_by ? String(entry.created_by) : null,
      })),
      engagementSummary: {
        mockAttempts30d: attempts.length,
        resourceOpens30d: resourceEvents30d.filter((event) => String(event.event_type ?? "") === "open").length,
        resourceActiveDays7d,
        lastMockSubmittedAt,
        lastResourceViewedAt,
        lastPlatformActivityAt,
      },
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
          registered: item.registered === undefined || item.registered === null ? null : Boolean(item.registered),
          appeared: item.appeared === undefined || item.appeared === null ? null : Boolean(item.appeared),
          offerDate: item.offer_date ? String(item.offer_date) : null,
          designationOffered: item.designation_offered ? String(item.designation_offered) : null,
          finalCtcLpa: item.final_ctc_lpa === undefined || item.final_ctc_lpa === null ? null : Number(item.final_ctc_lpa),
          joiningStatus: item.joining_status ? String(item.joining_status) : null,
          offerLetterReference: item.offer_letter_reference ? String(item.offer_letter_reference) : null,
          offerLetterUrl: item.offer_letter_url ? String(item.offer_letter_url) : null,
          joiningLetterUrl: item.joining_letter_url ? String(item.joining_letter_url) : null,
          selectionSource: item.selection_source ? String(item.selection_source) : null,
          verificationStatus: item.verification_status ? String(item.verification_status) : null,
          nonPlacementReason: item.non_placement_reason ? String(item.non_placement_reason) : null,
          actionPlan: item.action_plan ? String(item.action_plan) : null,
          resultReleasedAt: item.result_released_at ? String(item.result_released_at) : null,
          resultReleasedBy: item.result_released_by ? String(item.result_released_by) : null,
          resultNotificationStatus: item.result_notification_status ? String(item.result_notification_status) : null,
          resultNotificationCommunicationId: item.result_notification_communication_id ? String(item.result_notification_communication_id) : null,
          offerLetterSharedAt: item.offer_letter_shared_at ? String(item.offer_letter_shared_at) : null,
          offerLetterSharedBy: item.offer_letter_shared_by ? String(item.offer_letter_shared_by) : null,
          studentResultViewedAt: item.student_result_viewed_at ? String(item.student_result_viewed_at) : null,
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
    const db = await getMongoDb();
    const payload: Record<string, unknown> = {};
    const profileDataUpdates: Record<string, unknown> = {};
    if (updates.cgpa !== undefined) payload.cgpa = updates.cgpa;
    if (updates.backlogs !== undefined) payload.backlogs = updates.backlogs;
    if (updates.totalHistoricalBacklogs !== undefined) {
      payload.backlogs_total = updates.totalHistoricalBacklogs;
      profileDataUpdates.totalHistoricalBacklogs = updates.totalHistoricalBacklogs;
    }
    if (updates.attendancePct !== undefined) payload.attendance_pct = updates.attendancePct;
    if (updates.rollNumber !== undefined) payload.roll_number = updates.rollNumber;
    if (updates.branch !== undefined) payload.branch = updates.branch;
    if (updates.batch !== undefined) payload.batch = updates.batch;
    if (updates.prn !== undefined) profileDataUpdates.prn = updates.prn;
    if (updates.degree !== undefined) profileDataUpdates.degree = updates.degree;
    if (updates.currentSemester !== undefined) profileDataUpdates.currentSemester = updates.currentSemester;

    const existingStudent = await db.collection("students").findOne(
      { tenant_id: tenantId, id: studentId },
      { projection: { _id: 0, profile_data: 1 } },
    );
    if (!existingStudent) {
      throw new AppError("STUDENT_UPDATE_FAILED", "Student not found", 500);
    }

    if (Object.keys(profileDataUpdates).length > 0) {
      payload.profile_data = {
        ...((existingStudent.profile_data ?? {}) as Record<string, unknown>),
        ...profileDataUpdates,
      };
    }

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
    },
    options?: {
      progressInterval?: number;
      onProgress?: (progress: {
        totalRows: number;
        processedRows: number;
        created: number;
        updated: number;
        skipped: number;
        errorCount: number;
      }) => void | Promise<void>;
    },
  ) {
    const db = await getMongoDb();

    const escapeCsvCell = (value: string) => {
      const raw = String(value ?? "");
      if (/[",\n\r]/.test(raw)) {
        return `"${raw.replace(/"/g, "\"\"")}"`;
      }
      return raw;
    };

    const errorDetails: Array<{ row: number; message: string; email: string; rollNumber: string }> = [];
    const report = {
      created: 0,
      updated: 0,
      skipped: 0,
      createdStudentIds: [] as string[],
      updatedStudentIds: [] as string[],
      errors: [] as Array<{ row: number; message: string }>,
      errorCsv: null as string | null,
    };

    const totalRows = rows.length;
    const progressInterval = options?.progressInterval ?? 25;
    const maybeEmitProgress = async (processedRows: number) => {
      if (!options?.onProgress) return;
      if (processedRows !== totalRows && processedRows % progressInterval !== 0) return;
      await options.onProgress({
        totalRows,
        processedRows,
        created: report.created,
        updated: report.updated,
        skipped: report.skipped,
        errorCount: report.errors.length,
      });
    };

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const email = row[mapping.email]?.trim().toLowerCase();
      const fullName = row[mapping.fullName]?.trim();
      const rollNumber = row[mapping.rollNumber]?.trim();
      const branch = row[mapping.branch]?.trim();
      const batch = row[mapping.batch]?.trim();
      const prn = mapping.prn ? row[mapping.prn]?.trim() : "";
      const degree = mapping.degree ? row[mapping.degree]?.trim() : "";
      const currentSemester = mapping.currentSemester ? row[mapping.currentSemester]?.trim() : "";
      const rowNumber = index + 2;

      if (!email || !rollNumber || !branch || !batch) {
        report.skipped += 1;
        report.errors.push({ row: rowNumber, message: "Missing required fields" });
        errorDetails.push({ row: rowNumber, message: "Missing required fields", email: email ?? "", rollNumber: rollNumber ?? "" });
        await maybeEmitProgress(index + 1);
        continue;
      }

      const cgpa = mapping.cgpa ? Number(row[mapping.cgpa] || 0) : 0;
      const backlogs = mapping.backlogs ? Number(row[mapping.backlogs] || 0) : 0;
      const totalHistoricalBacklogs = mapping.totalHistoricalBacklogs ? Number(row[mapping.totalHistoricalBacklogs] || 0) : 0;
      const attendancePct = mapping.attendancePct ? Number(row[mapping.attendancePct] || 0) : 0;

      if (!Number.isFinite(cgpa) || cgpa < 0 || cgpa > 10) {
        report.skipped += 1;
        report.errors.push({ row: rowNumber, message: "Invalid cgpa value" });
        errorDetails.push({ row: rowNumber, message: "Invalid cgpa value", email, rollNumber });
        await maybeEmitProgress(index + 1);
        continue;
      }
      if (!Number.isFinite(backlogs) || backlogs < 0) {
        report.skipped += 1;
        report.errors.push({ row: rowNumber, message: "Invalid backlogs value" });
        errorDetails.push({ row: rowNumber, message: "Invalid backlogs value", email, rollNumber });
        await maybeEmitProgress(index + 1);
        continue;
      }
      if (!Number.isFinite(totalHistoricalBacklogs) || totalHistoricalBacklogs < 0) {
        report.skipped += 1;
        report.errors.push({ row: rowNumber, message: "Invalid totalHistoricalBacklogs value" });
        errorDetails.push({ row: rowNumber, message: "Invalid totalHistoricalBacklogs value", email, rollNumber });
        await maybeEmitProgress(index + 1);
        continue;
      }
      if (!Number.isFinite(attendancePct) || attendancePct < 0 || attendancePct > 100) {
        report.skipped += 1;
        report.errors.push({ row: rowNumber, message: "Invalid attendancePct value" });
        errorDetails.push({ row: rowNumber, message: "Invalid attendancePct value", email, rollNumber });
        await maybeEmitProgress(index + 1);
        continue;
      }

      const existingStudent = await db.collection("students").findOne(
        { tenant_id: tenantId, roll_number: rollNumber },
        { projection: { id: 1, user_id: 1, profile_data: 1 } },
      );

      if (existingStudent) {
        await db.collection("users").updateOne(
          { tenant_id: tenantId, id: String(existingStudent.user_id) },
          { $set: { full_name: fullName, email } },
        );

        await db.collection("students").updateOne(
          { tenant_id: tenantId, id: String(existingStudent.id) },
          {
            $set: {
              branch,
              batch,
              cgpa,
              backlogs,
              backlogs_total: totalHistoricalBacklogs,
              attendance_pct: attendancePct,
              profile_data: {
                ...((existingStudent as { profile_data?: Record<string, unknown> }).profile_data ?? {}),
                ...(prn ? { prn } : {}),
                ...(degree ? { degree } : {}),
                ...(currentSemester ? { currentSemester } : {}),
                totalHistoricalBacklogs,
              },
            },
          },
        );

        report.updated += 1;
        report.updatedStudentIds.push(String(existingStudent.id));
        await maybeEmitProgress(index + 1);
        continue;
      }

      // Create new user + student with a blocked temporary password until credential release.
      const userId = randomUUID();
      const studentId = randomUUID();
      const timestamp = new Date().toISOString();
      const tempPassword = `PIQ-${randomUUID()}`;
      const passwordHash = await bcryptHash(tempPassword, 12);

      try {
        await db.collection("users").insertOne({
          id: userId,
          tenant_id: tenantId,
          email,
          role: "student",
          full_name: fullName || email,
          is_active: true,
          must_change_password: true,
          password_hash: passwordHash,
          password_issued_at: timestamp,
          created_at: timestamp,
          updated_at: timestamp,
        });

        await db.collection("students").insertOne({
          id: studentId,
          tenant_id: tenantId,
          user_id: userId,
          roll_number: rollNumber,
          branch,
          batch,
          cgpa,
          backlogs,
          backlogs_total: totalHistoricalBacklogs,
          attendance_pct: attendancePct,
          skills: [],
          points: 0,
          streak_current: 0,
          streak_longest: 0,
          readiness_score: 0,
          profile_data: {
            ...(prn ? { prn } : {}),
            ...(degree ? { degree } : {}),
            ...(currentSemester ? { currentSemester } : {}),
            totalHistoricalBacklogs,
          },
          created_at: timestamp,
          updated_at: timestamp,
        });

        report.created += 1;
        report.createdStudentIds.push(studentId);
        await maybeEmitProgress(index + 1);
      } catch (err) {
        // Rollback user if student insert fails
        await db.collection("users").deleteOne({ tenant_id: tenantId, id: userId });
        report.skipped += 1;
        const message = err instanceof Error ? err.message : "Insert failed";
        report.errors.push({ row: rowNumber, message });
        errorDetails.push({ row: rowNumber, message, email, rollNumber });
        await maybeEmitProgress(index + 1);
      }
    }

    if (errorDetails.length > 0) {
      report.errorCsv =
        "row,message,email,roll_number\n"
        + errorDetails
          .map((entry) =>
            [
              String(entry.row),
              escapeCsvCell(entry.message),
              escapeCsvCell(entry.email),
              escapeCsvCell(entry.rollNumber),
            ].join(","),
          )
          .join("\n")
        + "\n";
    }

    return report;
  },
};
