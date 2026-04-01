export type ProfileOption = {
  value: string;
  label: string;
  aliases?: string[];
};

export const PROFILE_DEGREE_OPTIONS: ProfileOption[] = [
  { value: "B.E.", label: "B.E.", aliases: ["BE", "B.E", "BACHELOR OF ENGINEERING"] },
  { value: "B.Tech", label: "B.Tech", aliases: ["BTECH", "B.TECH", "BACHELOR OF TECHNOLOGY"] },
  { value: "Diploma", label: "Diploma" },
  { value: "M.Tech", label: "M.Tech", aliases: ["MTECH", "MASTER OF TECHNOLOGY"] },
  { value: "M.C.A.", label: "M.C.A.", aliases: ["MCA", "MASTER OF COMPUTER APPLICATIONS"] },
  { value: "M.B.A.", label: "M.B.A.", aliases: ["MBA", "MASTER OF BUSINESS ADMINISTRATION"] },
];

export const PROFILE_TARGET_ROLE_OPTIONS: ProfileOption[] = [
  { value: "Software Engineer", label: "Software Engineer", aliases: ["SDE", "SOFTWARE DEVELOPER", "DEVELOPER"] },
  { value: "Data Analyst", label: "Data Analyst", aliases: ["ANALYST", "BUSINESS ANALYST"] },
  { value: "QA Engineer", label: "QA Engineer", aliases: ["QA", "TEST ENGINEER", "QUALITY ANALYST"] },
  { value: "Graduate Engineer Trainee", label: "Graduate Engineer Trainee", aliases: ["GET", "MANAGEMENT TRAINEE", "TRAINEE ENGINEER"] },
  { value: "Core Engineering Role", label: "Core Engineering Role", aliases: ["CORE", "CORE ENGINEERING", "SITE ENGINEER", "PRODUCTION ENGINEER"] },
  { value: "Support / Operations", label: "Support / Operations", aliases: ["SUPPORT ENGINEER", "OPERATIONS", "TECHNICAL SUPPORT"] },
];

export const PROFILE_LOCATION_OPTIONS: ProfileOption[] = [
  { value: "Pune", label: "Pune" },
  { value: "Mumbai", label: "Mumbai" },
  { value: "Bengaluru", label: "Bengaluru", aliases: ["BANGALORE"] },
  { value: "Hyderabad", label: "Hyderabad" },
  { value: "Chennai", label: "Chennai" },
  { value: "Delhi NCR", label: "Delhi NCR", aliases: ["DELHI", "NOIDA", "GURUGRAM", "GURGAON"] },
  { value: "Kolkata", label: "Kolkata" },
  { value: "Remote", label: "Remote", aliases: ["WORK FROM HOME"] },
  { value: "Anywhere in India", label: "Anywhere in India", aliases: ["ANYWHERE", "PAN INDIA"] },
];

function normalizeToken(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

function matchOption(raw: string, options: ProfileOption[]) {
  const token = normalizeToken(raw);
  if (!token) return "";
  for (const option of options) {
    if (normalizeToken(option.value) === token || normalizeToken(option.label) === token) {
      return option.value;
    }
    if ((option.aliases ?? []).some((alias) => normalizeToken(alias) === token)) {
      return option.value;
    }
  }
  return "";
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function normalizeProfileDegree(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return matchOption(raw, PROFILE_DEGREE_OPTIONS) || raw;
}

export function normalizeProfileTargetRoles(value: unknown) {
  return unique(
    toStringArray(value).map((item) => matchOption(item, PROFILE_TARGET_ROLE_OPTIONS) || item),
  ).slice(0, 10);
}

export function normalizeProfileLocations(value: unknown) {
  return unique(
    toStringArray(value).map((item) => matchOption(item, PROFILE_LOCATION_OPTIONS) || item),
  ).slice(0, 10);
}

export function buildProfileOptions(input?: { branchOptions?: string[]; degreeOptions?: string[] }) {
  const branchOptions = unique((input?.branchOptions ?? []).map((item) => String(item ?? "").trim()));
  const degreeOptions = unique([
    ...PROFILE_DEGREE_OPTIONS.map((option) => option.value),
    ...((input?.degreeOptions ?? []).map((item) => normalizeProfileDegree(item)).filter(Boolean)),
  ]);

  return {
    branchOptions,
    degreeOptions,
    targetRoleOptions: PROFILE_TARGET_ROLE_OPTIONS.map((option) => option.value),
    preferredLocationOptions: PROFILE_LOCATION_OPTIONS.map((option) => option.value),
    willingnessOptions: ["Yes", "No"],
  };
}
