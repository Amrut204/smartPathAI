import { BRANCH_PREP_TRACKS, getBranchPrepTrack, matchesBranchPrepTrackTag } from "./branch-prep.config.js";

export type MockTestBranchCode = "CSE" | "IT" | "ECE" | "EEE" | "ME" | "Civil";

const MOCK_TEST_BRANCH_KEYWORDS: Record<MockTestBranchCode, string[]> = {
  CSE: [
    "data structures",
    "algorithms",
    "operating systems",
    "computer networks",
    "dbms",
    "sql",
    "programming",
    "oops",
    "python",
    "java",
    "c++",
    "software engineering",
    "artificial intelligence",
    "machine learning",
    "data science",
    "analytics",
  ],
  IT: [
    "information technology",
    "sql",
    "databases",
    "dbms",
    "web development",
    "javascript",
    "python",
    "java",
    "api",
    "cloud",
    "systems",
    "artificial intelligence",
    "machine learning",
    "data science",
    "analytics",
  ],
  ECE: [
    "electronics",
    "communication systems",
    "signals",
    "analog electronics",
    "digital electronics",
    "vlsi",
    "embedded",
    "microprocessors",
    "microcontrollers",
  ],
  EEE: [
    "electrical",
    "circuit theory",
    "circuits",
    "electrical machines",
    "machines",
    "power systems",
    "power electronics",
    "control systems",
    "electromagnetics",
  ],
  ME: [
    "mechanical",
    "thermodynamics",
    "fluid mechanics",
    "manufacturing",
    "heat transfer",
    "strength of materials",
    "cad/cam",
    "machine design",
  ],
  Civil: [
    "civil",
    "construction",
    "structural",
    "structural analysis",
    "geotechnical",
    "surveying",
    "transportation engineering",
    "construction management",
  ],
};

const CROSS_BRANCH_KEYWORDS = [
  "aptitude",
  "verbal",
  "reasoning",
  "logical",
  "quantitative",
  "quant",
  "communication skills",
  "english",
  "grammar",
  "reading comprehension",
  "general placement",
  "campus aptitude",
  "interview preparation",
  "hr interview",
  "resume building",
  "core engineering",
];

const COMPANY_PATTERN_KEYWORDS = [
  "pattern variant",
  "company pattern",
  "placement paper",
  "company specific",
  "campus paper",
  "online assessment",
  "mock assessment",
];

function normalizeText(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9+]+/g, " ").replace(/\s+/g, " ").trim();
}

function getAllBranchCodes(): MockTestBranchCode[] {
  return Object.values(BRANCH_PREP_TRACKS).map((track) => track.branch) as MockTestBranchCode[];
}

export function normalizeMockTestBranches(value: unknown): MockTestBranchCode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const supported = new Set(getAllBranchCodes());
  const normalized = value
    .map((item) => getBranchPrepTrack(String(item ?? "")).branch as MockTestBranchCode)
    .filter((item) => supported.has(item));

  return [...new Set(normalized)];
}

export function inferMockTestBranches(input: {
  title?: string | null;
  topicName?: string | null;
  companyName?: string | null;
}): MockTestBranchCode[] {
  const title = String(input.title ?? "");
  const topicName = String(input.topicName ?? "");
  const companyName = String(input.companyName ?? "");
  const haystack = normalizeText(`${title} ${topicName} ${companyName}`);
  const matches = new Set<MockTestBranchCode>();

  if (/\b(technical deep dive|technical interview|coding assessment|programming assessment)\b/i.test(haystack)) {
    matches.add("CSE");
    matches.add("IT");
  }

  for (const branch of getAllBranchCodes()) {
    if (
      matchesBranchPrepTrackTag(title, branch)
      || matchesBranchPrepTrackTag(topicName, branch)
      || matchesBranchPrepTrackTag(companyName, branch)
    ) {
      matches.add(branch);
      continue;
    }

    if (MOCK_TEST_BRANCH_KEYWORDS[branch].some((keyword) => haystack.includes(normalizeText(keyword)))) {
      matches.add(branch);
    }
  }

  return [...matches];
}

export function inferMockTestIsCrossBranch(
  input: {
    title?: string | null;
    topicName?: string | null;
    companyName?: string | null;
  },
  trackCategory?: string | null,
) {
  const haystack = normalizeText(`${input.title ?? ""} ${input.topicName ?? ""} ${input.companyName ?? ""}`);
  if (trackCategory === "aptitude" || trackCategory === "verbal" || trackCategory === "general" || trackCategory === "company_prep") {
    return true;
  }

  return (
    CROSS_BRANCH_KEYWORDS.some((keyword) => haystack.includes(normalizeText(keyword)))
    || COMPANY_PATTERN_KEYWORDS.some((keyword) => haystack.includes(normalizeText(keyword)))
  );
}

export function matchesMockTestBranch(
  input: {
    primaryBranches?: string[] | null;
    title?: string | null;
    topicName?: string | null;
    companyName?: string | null;
  },
  studentBranch: string | null | undefined,
) {
  const normalizedStudentBranch = getBranchPrepTrack(studentBranch).branch as MockTestBranchCode;
  const normalizedBranches = normalizeMockTestBranches(input.primaryBranches ?? []);

  if (normalizedBranches.includes(normalizedStudentBranch)) {
    return true;
  }

  if (normalizedBranches.length > 0) {
    return false;
  }

  return (
    matchesBranchPrepTrackTag(input.title, normalizedStudentBranch)
    || matchesBranchPrepTrackTag(input.topicName, normalizedStudentBranch)
    || matchesBranchPrepTrackTag(input.companyName, normalizedStudentBranch)
  );
}
