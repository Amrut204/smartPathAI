import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { StudentRepository } from "../repositories/student.repository.js";
import { PointsService } from "./points.service.js";

interface LogStudyHoursInput {
  tenantId: string;
  userId: string;
  topicId: string;
  studyDate?: string;
  hours: number;
}

type TopicProgressStatus = "incomplete" | "in_progress" | "complete";

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

const YOUTUBE_CACHE_TTL_MS = 15 * 60 * 1000;
const youtubeSuggestionCache = new Map<string, { expiresAt: number; items: YouTubeSuggestion[] }>();
const PDF_TEXT_CACHE_TTL_MS = 30 * 60 * 1000;
const pdfTextCache = new Map<string, { expiresAt: number; text: string }>();

function resolveMaterialRoot(): string {
  const serviceDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(serviceDir, "../../../material"),
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
      .filter((term) => term.length >= 3),
  )];
}

function listTxtInDirectory(dirPath: string): string[] {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return [];
  return fs
    .readdirSync(dirPath)
    .filter((name) => name.toLowerCase().endsWith(".txt"))
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

function resolveTextCandidates(materialRoot: string, sourcePdf: string): string[] {
  if (!sourcePdf) return [];

  const absPdf = path.join(materialRoot, sourcePdf);
  const pdfDir = path.dirname(absPdf);
  const baseNoExt = path.basename(absPdf, path.extname(absPdf));
  const directTxt = path.join(pdfDir, `${baseNoExt}.txt`);

  const candidates = [] as string[];
  if (fs.existsSync(directTxt)) {
    candidates.push(directTxt);
  }

  if (candidates.length === 0) {
    const stem = baseNoExt.toLowerCase().replace(/[^a-z0-9]/g, "");
    const fuzzy = listTxtInDirectory(pdfDir).filter((txtPath) => {
      const txtStem = path.basename(txtPath, ".txt").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!stem || !txtStem) return false;
      return txtStem.includes(stem.slice(0, 8)) || stem.includes(txtStem.slice(0, 8));
    });
    candidates.push(...fuzzy);
  }

  if (candidates.length === 0) {
    const testsDir = path.join(pdfDir, "TESTS");
    candidates.push(...listTxtInDirectory(testsDir));
  }

  return [...new Set(candidates)].slice(0, 2);
}

function loadSearchTextForPdf(sourcePdf: string): string {
  if (!sourcePdf) return "";

  const key = sourcePdf.toLowerCase();
  const cached = pdfTextCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.text;
  }

  try {
    const candidates = resolveTextCandidates(materialRoot, sourcePdf);
    if (candidates.length === 0) {
      pdfTextCache.set(key, { text: "", expiresAt: Date.now() + PDF_TEXT_CACHE_TTL_MS });
      return "";
    }

    const combined = candidates
      .map((txtPath) => fs.readFileSync(txtPath, "utf8"))
      .join("\n");
    const text = normalizeSearchText(combined).slice(0, 300_000);
    pdfTextCache.set(key, { text, expiresAt: Date.now() + PDF_TEXT_CACHE_TTL_MS });
    return text;
  } catch {
    pdfTextCache.set(key, { text: "", expiresAt: Date.now() + PDF_TEXT_CACHE_TTL_MS });
    return "";
  }
}

function scoreContentMatch(text: string, query: string, terms: string[]): number {
  if (!text) return 0;
  let score = 0;
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery && text.includes(normalizedQuery)) {
    score += 24;
  }
  for (const term of terms) {
    if (text.includes(term)) {
      score += 6;
    }
  }
  return score;
}

function buildSnippet(text: string, query: string): string {
  if (!text) return "";
  const normalizedQuery = normalizeSearchText(query);
  const idx = normalizedQuery ? text.indexOf(normalizedQuery) : -1;
  if (idx < 0) {
    return "";
  }

  const start = Math.max(0, idx - 70);
  const end = Math.min(text.length, idx + normalizedQuery.length + 90);
  return text.slice(start, end).trim();
}

function rankResourcesByPdfContent(
  resources: Array<Record<string, unknown>>,
  query: string,
): Array<Record<string, unknown>> {
  const normalizedQuery = normalizeSearchText(query);
  const terms = tokenizeQuery(query);
  if (!normalizedQuery || resources.length === 0) return resources;

  const scored = resources.map((resource, index) => {
    const title = normalizeSearchText(String(resource.title ?? ""));
    const description = normalizeSearchText(String(resource.description ?? ""));
    const sourcePdf = deriveSourcePdf(resource);
    const text = loadSearchTextForPdf(sourcePdf);
    const contentScore = scoreContentMatch(text, query, terms);

    let score = 0;
    if (title.includes(normalizedQuery)) score += 12;
    if (description.includes(normalizedQuery)) score += 8;
    terms.forEach((term) => {
      if (title.includes(term)) score += 4;
      if (description.includes(term)) score += 2;
    });
    score += contentScore;

    return {
      resource,
      index,
      score,
      contentMatched: contentScore > 0,
      snippet: contentScore > 0 ? buildSnippet(text, query) : "",
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  return scored.map((item) => ({
    ...item.resource,
    matchSource: item.contentMatched ? "pdf_content" : "metadata",
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

export const StudentService = {
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
    return StudentRepository.getStudentProfile(tenantId, userId);
  },

  async updateMyProfile(params: {
    tenantId: string;
    userId: string;
    fullName?: string;
    skills?: string[];
    profileData?: Record<string, unknown>;
  }) {
    return StudentRepository.updateStudentProfile(params);
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
    return StudentRepository.upsertTopicProgress({
      tenantId: input.tenantId,
      studentId: String(student.id),
      topicId: input.topicId,
      status: input.status,
    });
  },

  async updateTopicProgressBulk(input: {
    tenantId: string;
    userId: string;
    topicIds: string[];
    status: TopicProgressStatus;
  }) {
    const student = await StudentRepository.getStudentByUserId(input.tenantId, input.userId);
    return StudentRepository.upsertTopicProgressBulk({
      tenantId: input.tenantId,
      studentId: String(student.id),
      topicIds: input.topicIds,
      status: input.status,
    });
  },

  async getVaultCompanies(tenantId: string) {
    return StudentRepository.getVaultCompanies(tenantId);
  },

  async getVaultByCompany(tenantId: string, companyId: string, type?: string) {
    return StudentRepository.getVaultByCompany(tenantId, companyId, type);
  },

  async getResources(tenantId: string, topicId?: string) {
    return StudentRepository.getResources(tenantId, topicId);
  },

  async listTopics(tenantId: string, query?: string, limit = 20) {
    return StudentRepository.listTopics(tenantId, query, limit);
  },

  async searchStudyContent(tenantId: string, topicQuery: string) {
    const result = await StudentRepository.searchResourcesByTopicName(tenantId, topicQuery);
    const youtubeVideos = await fetchYouTubeSuggestions(topicQuery);
    const rankedResources = rankResourcesByPdfContent(
      result.resources as Array<Record<string, unknown>>,
      topicQuery,
    );

    return {
      query: result.query,
      matchedTopics: result.matchedTopics,
      resources: rankedResources,
      youtubeVideos,
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
    return StudentRepository.listStudentsForTpo(tenantId, params);
  },

  async getStudentByIdForTpo(tenantId: string, studentId: string) {
    return StudentRepository.getStudentByIdForTpo(tenantId, studentId);
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
      rollNumber: pick(["roll_number", "rollnumber", "roll_no", "rollno"]),
      branch: pick(["branch", "department"]),
      batch: pick(["batch", "graduation_year", "grad_year"]),
      cgpa: pick(["cgpa", "gpa"]),
      backlogs: pick(["backlogs", "backlog"]),
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
        rollNumber: string;
        branch: string;
        batch: string;
        cgpa?: string;
        backlogs?: string;
        attendancePct?: string;
      };
      rows: Array<Record<string, string>>;
    },
  ) {
    return StudentRepository.upsertStudentsFromCsv(tenantId, payload.rows, payload.mapping);
  },
};
