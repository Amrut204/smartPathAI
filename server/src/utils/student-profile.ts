import {
  normalizeProfileDegree,
  normalizeProfileLocations,
  normalizeProfileTargetRoles,
} from "../config/profile-options.config.js";

type StudentLike = {
  [key: string]: unknown;
  roll_number?: unknown;
  branch?: unknown;
  batch?: unknown;
  cgpa?: unknown;
  backlogs?: unknown;
  backlogs_total?: unknown;
  attendance_pct?: unknown;
  skills?: unknown;
  profile_data?: unknown;
};

type UserLike = {
  [key: string]: unknown;
  full_name?: unknown;
  email?: unknown;
};

export type ProfileFieldOwner = "seeded" | "student";
export type ProfileSectionStatus = "complete" | "needs_review" | "missing_required";

export type ProfileFieldKey =
  | "fullName"
  | "collegeEmail"
  | "prn"
  | "rollNumber"
  | "branch"
  | "batch"
  | "degree"
  | "currentSemester"
  | "cgpa"
  | "activeBacklogs"
  | "totalHistoricalBacklogs"
  | "attendancePct"
  | "phone"
  | "personalEmail"
  | "resumeUrl"
  | "targetRoles"
  | "preferredLocations"
  | "willingToRelocate"
  | "dataConsentAccepted"
  | "accuracyDeclarationAccepted";

export type ProfileCompletionField = {
  key: ProfileFieldKey;
  label: string;
  owner: ProfileFieldOwner;
  complete: boolean;
};

export type NormalizedStudentProfileData = {
  prn: string;
  degree: string;
  currentSemester: string;
  totalHistoricalBacklogs: number | null;
  phone: string;
  personalEmail: string;
  resumeUrl: string;
  resumeStorageProvider: string;
  resumeDriveFileId: string;
  resumeDriveWebLink: string;
  resumeFilename: string;
  resumeMimeType: string;
  resumeSizeBytes: number | null;
  resumeUploadedAt: string;
  targetRoles: string[];
  preferredLocations: string[];
  willingToRelocate: boolean | null;
  linkedIn: string;
  githubUrl: string;
  portfolioUrl: string;
  internships: string;
  projects: string;
  certifications: string;
  achievements: string;
  languages: string[];
  dataConsentAccepted: boolean;
  accuracyDeclarationAccepted: boolean;
};

export type StudentProfileSummary = {
  seededProfile: {
    fullName: string;
    collegeEmail: string;
    prn: string;
    rollNumber: string;
    branch: string;
    batch: string;
    cgpa: number | null;
    activeBacklogs: number | null;
    totalHistoricalBacklogs: number | null;
    degree: string;
    currentSemester: string;
    attendancePct: number | null;
  };
  studentEditableProfile: {
    prn: string;
    rollNumber: string;
    branch: string;
    batch: string;
    cgpa: number | null;
    activeBacklogs: number | null;
    totalHistoricalBacklogs: number | null;
    degree: string;
    currentSemester: string;
    attendancePct: number | null;
    phone: string;
    personalEmail: string;
    resumeUrl: string;
    resumeStorageProvider: string;
    resumeDriveFileId: string;
    resumeDriveWebLink: string;
    resumeFilename: string;
    resumeMimeType: string;
    resumeSizeBytes: number | null;
    resumeUploadedAt: string;
    targetRoles: string[];
    preferredLocations: string[];
    willingToRelocate: boolean | null;
    skills: string[];
    linkedIn: string;
    githubUrl: string;
    portfolioUrl: string;
    internships: string;
    projects: string;
    certifications: string;
    achievements: string;
    languages: string[];
    dataConsentAccepted: boolean;
    accuracyDeclarationAccepted: boolean;
  };
  profileCompleteness: {
    pct: number;
    isComplete: boolean;
    completedRequiredFields: number;
    totalRequiredFields: number;
  };
  sectionStates: Array<{
    key: "academic" | "placement" | "resume" | "preferences" | "verification";
    label: string;
    status: ProfileSectionStatus;
    summary: string;
  }>;
  requiredFields: ProfileCompletionField[];
  missingRequiredFields: ProfileCompletionField[];
  missingSeededFields: ProfileCompletionField[];
  missingStudentFields: ProfileCompletionField[];
  pendingCollegeFields: ProfileCompletionField[];
  recommendedFields: Array<{ key: string; label: string; complete: boolean }>;
  canAccessResources: boolean;
  canAccessMockTests: boolean;
};

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => asTrimmedString(item))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
  }
  return null;
}

function getFirstString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = asTrimmedString(source[key]);
    if (value) return value;
  }
  return "";
}

function getFirstArray(source: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const values = asStringArray(source[key]);
    if (values.length > 0) return values;
  }
  return [];
}

function getFirstBoolean(source: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = asBoolean(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function getFirstNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = asNumber(source[key]);
    if (value !== null) return value;
  }
  return null;
}

export function normalizeStudentProfileData(profileData: unknown): NormalizedStudentProfileData {
  const raw = profileData && typeof profileData === "object"
    ? profileData as Record<string, unknown>
    : {};

  return {
    prn: getFirstString(raw, ["prn", "prnNumber", "prn_number", "registrationNumber", "registration_number"]),
    degree: normalizeProfileDegree(getFirstString(raw, ["degree", "program", "course"])),
    currentSemester: getFirstString(raw, ["currentSemester", "current_semester", "semester", "currentYear", "current_year"]),
    totalHistoricalBacklogs: getFirstNumber(raw, ["totalHistoricalBacklogs", "total_historical_backlogs", "totalBacklogs", "backlogs_total"]),
    phone: getFirstString(raw, ["phone", "phoneNumber", "phone_number", "mobile", "mobileNumber"]),
    personalEmail: getFirstString(raw, ["personalEmail", "personal_email", "alternateEmail", "alternate_email"]),
    resumeUrl: getFirstString(raw, ["resumeDriveWebLink", "resume_drive_web_link", "resumeUrl", "resume_url", "resumeLink", "resume_link"]),
    resumeStorageProvider: getFirstString(raw, ["resumeStorageProvider", "resume_storage_provider"]),
    resumeDriveFileId: getFirstString(raw, ["resumeDriveFileId", "resume_drive_file_id"]),
    resumeDriveWebLink: getFirstString(raw, ["resumeDriveWebLink", "resume_drive_web_link", "resumeUrl", "resume_url"]),
    resumeFilename: getFirstString(raw, ["resumeFilename", "resume_filename"]),
    resumeMimeType: getFirstString(raw, ["resumeMimeType", "resume_mime_type"]),
    resumeSizeBytes: getFirstNumber(raw, ["resumeSizeBytes", "resume_size_bytes"]),
    resumeUploadedAt: getFirstString(raw, ["resumeUploadedAt", "resume_uploaded_at"]),
    targetRoles: normalizeProfileTargetRoles(getFirstArray(raw, ["targetRoles", "target_roles", "preferredRoles", "preferred_roles"])),
    preferredLocations: normalizeProfileLocations(getFirstArray(raw, ["preferredLocations", "preferred_locations", "locationPreferences", "location_preferences"])),
    willingToRelocate: getFirstBoolean(raw, ["willingToRelocate", "willing_to_relocate", "relocationPreference", "relocation_preference"]),
    linkedIn: getFirstString(raw, ["linkedIn", "linkedin", "linked_in"]),
    githubUrl: getFirstString(raw, ["githubUrl", "github_url", "github", "codingProfileUrl", "coding_profile_url"]),
    portfolioUrl: getFirstString(raw, ["portfolioUrl", "portfolio_url", "portfolio"]),
    internships: getFirstString(raw, ["internships", "internshipsSummary", "internships_summary"]),
    projects: getFirstString(raw, ["projects", "projectsSummary", "projects_summary"]),
    certifications: getFirstString(raw, ["certifications", "certificationsSummary", "certifications_summary"]),
    achievements: getFirstString(raw, ["achievements", "achievementsSummary", "achievements_summary"]),
    languages: getFirstArray(raw, ["languages", "spokenLanguages", "spoken_languages"]),
    dataConsentAccepted: getFirstBoolean(raw, ["dataConsentAccepted", "data_consent_accepted", "privacyConsentAccepted", "privacy_consent_accepted"]) === true,
    accuracyDeclarationAccepted: getFirstBoolean(raw, ["accuracyDeclarationAccepted", "accuracy_declaration_accepted", "profileAccuracyConfirmed", "profile_accuracy_confirmed"]) === true,
  };
}

function isPresentString(value: string): boolean {
  return value.trim().length > 0;
}

function isPresentNumber(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function isPresentArray(value: string[]): boolean {
  return value.length > 0;
}

export function buildStudentProfileSummary(input: {
  student: StudentLike;
  user: UserLike;
}): StudentProfileSummary {
  const normalized = normalizeStudentProfileData(input.student.profile_data);
  const fullName = asTrimmedString(input.user.full_name);
  const collegeEmail = asTrimmedString(input.user.email);
  const rollNumber = asTrimmedString(input.student.roll_number);
  const branch = asTrimmedString(input.student.branch);
  const batch = asTrimmedString(input.student.batch);
  const cgpa = asNumber(input.student.cgpa);
  const activeBacklogs = asNumber(input.student.backlogs);
  const totalHistoricalBacklogs = normalized.totalHistoricalBacklogs ?? asNumber(input.student.backlogs_total);
  const attendancePct = asNumber(input.student.attendance_pct);
  const skills = asStringArray(input.student.skills);

  const requiredFields: ProfileCompletionField[] = [
    { key: "fullName", label: "Student name", owner: "seeded", complete: isPresentString(fullName) },
    { key: "collegeEmail", label: "College email", owner: "seeded", complete: isPresentString(collegeEmail) },
    { key: "prn", label: "PRN", owner: "student", complete: isPresentString(normalized.prn) },
    { key: "rollNumber", label: "Roll number", owner: "seeded", complete: isPresentString(rollNumber) },
    { key: "branch", label: "Branch", owner: "seeded", complete: isPresentString(branch) },
    { key: "batch", label: "Batch", owner: "seeded", complete: isPresentString(batch) },
    { key: "degree", label: "Degree", owner: "student", complete: isPresentString(normalized.degree) },
    { key: "currentSemester", label: "Current semester", owner: "student", complete: isPresentString(normalized.currentSemester) },
    { key: "cgpa", label: "CGPA", owner: "seeded", complete: isPresentNumber(cgpa) },
    { key: "activeBacklogs", label: "Active backlogs", owner: "seeded", complete: isPresentNumber(activeBacklogs) },
    {
      key: "totalHistoricalBacklogs",
      label: "Total historical backlogs",
      owner: "seeded",
      complete: isPresentNumber(totalHistoricalBacklogs),
    },
    { key: "attendancePct", label: "Attendance", owner: "seeded", complete: isPresentNumber(attendancePct) },
    { key: "phone", label: "Phone number", owner: "student", complete: isPresentString(normalized.phone) },
    { key: "personalEmail", label: "Personal email", owner: "student", complete: isPresentString(normalized.personalEmail) },
    { key: "resumeUrl", label: "Resume", owner: "student", complete: isPresentString(normalized.resumeUrl) || isPresentString(normalized.resumeDriveWebLink) },
    { key: "targetRoles", label: "Target roles", owner: "student", complete: isPresentArray(normalized.targetRoles) },
    {
      key: "preferredLocations",
      label: "Preferred locations",
      owner: "student",
      complete: isPresentArray(normalized.preferredLocations),
    },
    {
      key: "willingToRelocate",
      label: "Relocation preference",
      owner: "student",
      complete: normalized.willingToRelocate !== null,
    },
  ];

  const missingRequiredFields = requiredFields.filter((field) => !field.complete);
  const missingSeededFields = missingRequiredFields.filter((field) => field.owner === "seeded");
  const missingStudentFields = missingRequiredFields.filter((field) => field.owner === "student");
  const completedRequiredFields = requiredFields.length - missingRequiredFields.length;
  const pct = requiredFields.length > 0
    ? Math.round((completedRequiredFields / requiredFields.length) * 100)
    : 0;
  const isComplete = missingRequiredFields.length === 0;

  const academicFields = requiredFields.filter((field) =>
    ["prn", "rollNumber", "branch", "batch", "degree", "currentSemester", "cgpa", "activeBacklogs", "totalHistoricalBacklogs", "attendancePct"].includes(field.key),
  );
  const placementFields = requiredFields.filter((field) => ["phone", "personalEmail"].includes(field.key));
  const resumeFields = requiredFields.filter((field) => ["resumeUrl"].includes(field.key));
  const preferenceFields = requiredFields.filter((field) => ["targetRoles", "preferredLocations", "willingToRelocate"].includes(field.key));
  const verificationFields = requiredFields.filter((field) => ["dataConsentAccepted", "accuracyDeclarationAccepted"].includes(field.key));

  const buildSectionStatus = (
    key: "academic" | "placement" | "resume" | "preferences" | "verification",
    label: string,
    fields: ProfileCompletionField[],
    recommendedComplete = true,
  ) => {
    const hasMissing = fields.some((field) => !field.complete);
    const status: ProfileSectionStatus = hasMissing ? "missing_required" : recommendedComplete ? "complete" : "needs_review";
    return {
      key,
      label,
      status,
      summary: hasMissing
        ? `${fields.filter((field) => !field.complete).length} required item${fields.filter((field) => !field.complete).length === 1 ? "" : "s"} missing`
        : recommendedComplete
          ? "Complete"
          : "Needs review",
    };
  };

  return {
    seededProfile: {
      fullName,
      collegeEmail,
      prn: normalized.prn,
      rollNumber,
      branch,
      batch,
      cgpa,
      activeBacklogs,
      totalHistoricalBacklogs,
      degree: normalized.degree,
      currentSemester: normalized.currentSemester,
      attendancePct,
    },
    studentEditableProfile: {
      prn: normalized.prn,
      rollNumber,
      branch,
      batch,
      cgpa,
      activeBacklogs,
      totalHistoricalBacklogs,
      degree: normalized.degree,
      currentSemester: normalized.currentSemester,
      attendancePct,
      phone: normalized.phone,
      personalEmail: normalized.personalEmail,
      resumeUrl: normalized.resumeUrl,
      resumeStorageProvider: normalized.resumeStorageProvider,
      resumeDriveFileId: normalized.resumeDriveFileId,
      resumeDriveWebLink: normalized.resumeDriveWebLink,
      resumeFilename: normalized.resumeFilename,
      resumeMimeType: normalized.resumeMimeType,
      resumeSizeBytes: normalized.resumeSizeBytes,
      resumeUploadedAt: normalized.resumeUploadedAt,
      targetRoles: normalized.targetRoles,
      preferredLocations: normalized.preferredLocations,
      willingToRelocate: normalized.willingToRelocate,
      skills,
      linkedIn: normalized.linkedIn,
      githubUrl: normalized.githubUrl,
      portfolioUrl: normalized.portfolioUrl,
      internships: normalized.internships,
      projects: normalized.projects,
      certifications: normalized.certifications,
      achievements: normalized.achievements,
      languages: normalized.languages,
      dataConsentAccepted: normalized.dataConsentAccepted,
      accuracyDeclarationAccepted: normalized.accuracyDeclarationAccepted,
    },
    profileCompleteness: {
      pct,
      isComplete,
      completedRequiredFields,
      totalRequiredFields: requiredFields.length,
    },
    sectionStates: [
      buildSectionStatus("academic", "Academic Details", academicFields),
      buildSectionStatus("placement", "Placement Details", placementFields),
      buildSectionStatus("resume", "Resume & Links", resumeFields, isPresentString(normalized.linkedIn) || isPresentString(normalized.githubUrl) || isPresentString(normalized.portfolioUrl)),
      buildSectionStatus("preferences", "Preferences", preferenceFields),
      buildSectionStatus("verification", "Verification", verificationFields, normalized.dataConsentAccepted && normalized.accuracyDeclarationAccepted),
    ],
    requiredFields,
    missingRequiredFields,
    missingSeededFields,
    missingStudentFields,
    pendingCollegeFields: [],
    recommendedFields: [
      { key: "skills", label: "Skills", complete: skills.length > 0 },
      { key: "linkedIn", label: "LinkedIn profile", complete: isPresentString(normalized.linkedIn) },
      { key: "githubUrl", label: "GitHub or coding profile", complete: isPresentString(normalized.githubUrl) },
      { key: "portfolioUrl", label: "Portfolio link", complete: isPresentString(normalized.portfolioUrl) },
      { key: "internships", label: "Internships summary", complete: isPresentString(normalized.internships) },
      { key: "projects", label: "Projects summary", complete: isPresentString(normalized.projects) },
      { key: "certifications", label: "Certifications", complete: isPresentString(normalized.certifications) },
      { key: "achievements", label: "Achievements", complete: isPresentString(normalized.achievements) },
      { key: "languages", label: "Languages", complete: normalized.languages.length > 0 },
    ],
    canAccessResources: isComplete,
    canAccessMockTests: isComplete,
  };
}
