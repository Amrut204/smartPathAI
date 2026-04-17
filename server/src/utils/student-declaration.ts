import { createHash } from "node:crypto";

import { normalizeStudentProfileData } from "./student-profile.js";

type StudentLike = {
  [key: string]: unknown;
  roll_number?: unknown;
  branch?: unknown;
  batch?: unknown;
  cgpa?: unknown;
  backlogs?: unknown;
  backlogs_total?: unknown;
  profile_data?: unknown;
};

type UserLike = {
  [key: string]: unknown;
  full_name?: unknown;
  email?: unknown;
};

type DeclarationStateRecord = {
  onboardingAcceptedAt?: unknown;
  onboardingVersion?: unknown;
  onboardingTypedValue?: unknown;
  profileCertifiedAt?: unknown;
  profileCertificationVersion?: unknown;
  profileCertificationTypedValue?: unknown;
  profileCertificationSnapshotHash?: unknown;
  profileCertificationInvalidatedAt?: unknown;
  profileCertificationInvalidationReason?: unknown;
  lastCertifiedProfileAt?: unknown;
  profileEditLockedAt?: unknown;
  profileEditUnlockedAt?: unknown;
  profileEditUnlockedBy?: unknown;
};

export const STUDENT_DECLARATION_POLICY_VERSION = "2026-03-25";
export const PROFILE_CERTIFICATION_TYPED_VALUE = "I AGREE";

const MATERIAL_PROFILE_FIELDS = [
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
  "dataConsentAccepted",
  "accuracyDeclarationAccepted",
] as const;

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNullableString(value: unknown): string | null {
  const trimmed = asTrimmedString(value);
  return trimmed || null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asTrimmedString(item))
    .filter(Boolean);
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function asDeclarationStateRecord(profileData: unknown): DeclarationStateRecord {
  const raw = profileData && typeof profileData === "object"
    ? (profileData as Record<string, unknown>)
    : {};
  const declaration = raw.declaration && typeof raw.declaration === "object"
    ? raw.declaration as Record<string, unknown>
    : {};

  return {
    onboardingAcceptedAt: declaration.onboardingAcceptedAt,
    onboardingVersion: declaration.onboardingVersion,
    onboardingTypedValue: declaration.onboardingTypedValue,
    profileCertifiedAt: declaration.profileCertifiedAt,
    profileCertificationVersion: declaration.profileCertificationVersion,
    profileCertificationTypedValue: declaration.profileCertificationTypedValue,
    profileCertificationSnapshotHash: declaration.profileCertificationSnapshotHash,
    profileCertificationInvalidatedAt: declaration.profileCertificationInvalidatedAt,
    profileCertificationInvalidationReason: declaration.profileCertificationInvalidationReason,
    lastCertifiedProfileAt: declaration.lastCertifiedProfileAt,
    profileEditLockedAt: declaration.profileEditLockedAt,
    profileEditUnlockedAt: declaration.profileEditUnlockedAt,
    profileEditUnlockedBy: declaration.profileEditUnlockedBy,
  };
}

export type StudentDeclarationStatus = {
  policyVersion: string;
  onboarding: {
    required: boolean;
    acceptedAt: string | null;
    version: string | null;
    typedValue: string | null;
    expectedTypedValue: string;
  };
  profileCertification: {
    isCertified: boolean;
    isLocked: boolean;
    acceptedAt: string | null;
    version: string | null;
    snapshotHash: string | null;
    invalidatedAt: string | null;
    invalidationReason: string | null;
    requiresRecertification: boolean;
    typedValueHint: string;
  };
};

export type ProfileCertificationPreview = {
  studentName: string;
  collegeEmail: string;
  prn: string;
  rollNumber: string;
  branch: string;
  batch: string;
  degree: string;
  currentSemester: string;
  cgpa: number | null;
  activeBacklogs: number | null;
  totalHistoricalBacklogs: number | null;
  attendancePct: number | null;
  personalEmail: string;
  phone: string;
  resumeUrl: string;
  targetRoles: string[];
  preferredLocations: string[];
  willingToRelocate: boolean | null;
  typedValueHint: string;
  snapshotHash: string;
};

export function buildOnboardingWarningContent(input: {
  studentName: string;
  collegeName?: string | null;
}) {
  const collegeLabel = asTrimmedString(input.collegeName) || "your college";
  return {
    title: "Placement profile declaration",
    intro: `Every detail you submit in Smart Path can affect your eligibility for drives at ${collegeLabel}.`,
    warnings: [
      "If any discrepancy is found before a drive, you may be removed from that drive until the TPO verifies your data.",
      "If falsification is confirmed, the college may block you from further drives for the academic year and create a written record in your placement file.",
      "If false data reaches a company after an offer, your placement may be cancelled and the matter may be escalated to the TPO, HOD, or disciplinary committee.",
      "Resources available on this platform are provided for educational purposes.",
      "Some materials are sourced from public repositories.",
      "You agree not to redistribute, republish, or use materials for commercial purposes.",
    ],
    support: "If any academic or placement detail is wrong, update it in your profile before continuing.",
    acknowledgement: `By continuing, ${asTrimmedString(input.studentName) || "the student"} confirms they understand these consequences and the resource usage rules.`,
  };
}

export function getOnboardingTypedValueHint(input: {
  rollNumber?: unknown;
  prn?: unknown;
}): string {
  return asTrimmedString(input.prn) || asTrimmedString(input.rollNumber) || "I UNDERSTAND";
}

export function getMaterialProfileFieldLabels() {
  return [
    "PRN",
    "roll number",
    "branch",
    "batch",
    "degree",
    "current semester",
    "CGPA",
    "active backlogs",
    "total historical backlogs",
    "attendance",
    "phone number",
    "personal email",
    "resume link",
    "target roles",
    "preferred locations",
    "relocation preference",
    "privacy consent",
    "accuracy declaration",
  ];
}

export function buildStudentDeclarationStatus(input: {
  student: StudentLike;
  user: UserLike;
}): StudentDeclarationStatus {
  const normalized = normalizeStudentProfileData(input.student.profile_data);
  const rawDeclaration = asDeclarationStateRecord(input.student.profile_data);
  const acceptedAt = asNullableString(rawDeclaration.profileCertifiedAt);
  const invalidatedAt = asNullableString(rawDeclaration.profileCertificationInvalidatedAt);
  const lockedAt = asNullableString(rawDeclaration.profileEditLockedAt);
  const unlockedAt = asNullableString(rawDeclaration.profileEditUnlockedAt);
  const isCertified = Boolean(acceptedAt) && (!invalidatedAt || (acceptedAt !== null && invalidatedAt < acceptedAt));
  const isLocked = Boolean(lockedAt) && (!unlockedAt || (lockedAt !== null && lockedAt > unlockedAt));
  const prn = normalized.prn;

  return {
    policyVersion: STUDENT_DECLARATION_POLICY_VERSION,
    onboarding: {
      required: !Boolean(asNullableString(rawDeclaration.onboardingAcceptedAt))
        || asNullableString(rawDeclaration.onboardingVersion) !== STUDENT_DECLARATION_POLICY_VERSION,
      acceptedAt: asNullableString(rawDeclaration.onboardingAcceptedAt),
      version: asNullableString(rawDeclaration.onboardingVersion),
      typedValue: asNullableString(rawDeclaration.onboardingTypedValue),
      expectedTypedValue: getOnboardingTypedValueHint({
        rollNumber: input.student.roll_number,
        prn,
      }),
    },
    profileCertification: {
      isCertified,
      isLocked,
      acceptedAt,
      version: asNullableString(rawDeclaration.profileCertificationVersion),
      snapshotHash: asNullableString(rawDeclaration.profileCertificationSnapshotHash),
      invalidatedAt,
      invalidationReason: asNullableString(rawDeclaration.profileCertificationInvalidationReason),
      requiresRecertification: Boolean(acceptedAt) && Boolean(invalidatedAt) && acceptedAt !== null && invalidatedAt !== null && invalidatedAt >= acceptedAt,
      typedValueHint: PROFILE_CERTIFICATION_TYPED_VALUE,
    },
  };
}

export function buildProfileCertificationPreview(input: {
  student: StudentLike;
  user: UserLike;
}): ProfileCertificationPreview {
  const normalized = normalizeStudentProfileData(input.student.profile_data);

  const preview = {
    studentName: asTrimmedString(input.user.full_name),
    collegeEmail: asTrimmedString(input.user.email),
    prn: normalized.prn,
    rollNumber: asTrimmedString(input.student.roll_number),
    branch: asTrimmedString(input.student.branch),
    batch: asTrimmedString(input.student.batch),
    degree: normalized.degree,
    currentSemester: normalized.currentSemester,
    cgpa: input.student.cgpa === null || input.student.cgpa === undefined || input.student.cgpa === ""
      ? null
      : Number(input.student.cgpa),
    activeBacklogs: input.student.backlogs === null || input.student.backlogs === undefined || input.student.backlogs === ""
      ? null
      : Number(input.student.backlogs),
    totalHistoricalBacklogs: normalized.totalHistoricalBacklogs ?? (
      input.student.backlogs_total === null || input.student.backlogs_total === undefined || input.student.backlogs_total === ""
        ? null
        : Number(input.student.backlogs_total)
    ),
    attendancePct: input.student.attendance_pct === null || input.student.attendance_pct === undefined || input.student.attendance_pct === ""
      ? null
      : Number(input.student.attendance_pct),
    personalEmail: normalized.personalEmail,
    phone: normalized.phone,
    resumeUrl: normalized.resumeUrl,
    targetRoles: normalized.targetRoles,
    preferredLocations: normalized.preferredLocations,
    willingToRelocate: normalized.willingToRelocate,
    typedValueHint: PROFILE_CERTIFICATION_TYPED_VALUE,
  } satisfies Omit<ProfileCertificationPreview, "snapshotHash">;

  return {
    ...preview,
    snapshotHash: hashProfileCertificationSnapshot(preview),
  };
}

export function hashProfileCertificationSnapshot(snapshot: Omit<ProfileCertificationPreview, "typedValueHint" | "snapshotHash"> & Partial<Pick<ProfileCertificationPreview, "typedValueHint">>) {
  return createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
}

export function buildDeclarationProfileDataPatch(input: {
  profileData: unknown;
  declaration: Partial<{
    onboardingAcceptedAt: string | null;
    onboardingVersion: string | null;
    onboardingTypedValue: string | null;
    profileCertifiedAt: string | null;
    profileCertificationVersion: string | null;
    profileCertificationTypedValue: string | null;
    profileCertificationSnapshotHash: string | null;
    profileCertificationInvalidatedAt: string | null;
    profileCertificationInvalidationReason: string | null;
    lastCertifiedProfileAt: string | null;
    profileEditLockedAt: string | null;
    profileEditUnlockedAt: string | null;
    profileEditUnlockedBy: string | null;
  }>;
}) {
  const raw = input.profileData && typeof input.profileData === "object"
    ? { ...(input.profileData as Record<string, unknown>) }
    : {};
  const declaration = raw.declaration && typeof raw.declaration === "object"
    ? { ...(raw.declaration as Record<string, unknown>) }
    : {};

  Object.entries(input.declaration).forEach(([key, value]) => {
    if (value === undefined) return;
    declaration[key] = value;
  });

  return {
    ...raw,
    declaration,
  };
}

export function getMaterialProfileFieldChanges(input: {
  beforeStudent: {
    rollNumber?: unknown;
    branch?: unknown;
    batch?: unknown;
    cgpa?: unknown;
    backlogs?: unknown;
    backlogs_total?: unknown;
    attendance_pct?: unknown;
    profile_data?: unknown;
  };
  afterStudent: {
    rollNumber?: unknown;
    branch?: unknown;
    batch?: unknown;
    cgpa?: unknown;
    backlogs?: unknown;
    backlogs_total?: unknown;
    attendance_pct?: unknown;
    profile_data?: unknown;
  };
}) {
  const beforeProfile = normalizeStudentProfileData(input.beforeStudent.profile_data);
  const afterProfile = normalizeStudentProfileData(input.afterStudent.profile_data);
  const before = {
    prn: beforeProfile.prn,
    rollNumber: asTrimmedString(input.beforeStudent.rollNumber),
    branch: asTrimmedString(input.beforeStudent.branch),
    batch: asTrimmedString(input.beforeStudent.batch),
    degree: beforeProfile.degree,
    currentSemester: beforeProfile.currentSemester,
    cgpa: input.beforeStudent.cgpa === null || input.beforeStudent.cgpa === undefined || input.beforeStudent.cgpa === "" ? null : Number(input.beforeStudent.cgpa),
    activeBacklogs: input.beforeStudent.backlogs === null || input.beforeStudent.backlogs === undefined || input.beforeStudent.backlogs === "" ? null : Number(input.beforeStudent.backlogs),
    totalHistoricalBacklogs: beforeProfile.totalHistoricalBacklogs ?? (
      input.beforeStudent.backlogs_total === null || input.beforeStudent.backlogs_total === undefined || input.beforeStudent.backlogs_total === ""
        ? null
        : Number(input.beforeStudent.backlogs_total)
    ),
    attendancePct: input.beforeStudent.attendance_pct === null || input.beforeStudent.attendance_pct === undefined || input.beforeStudent.attendance_pct === "" ? null : Number(input.beforeStudent.attendance_pct),
    phone: beforeProfile.phone,
    personalEmail: beforeProfile.personalEmail,
    resumeUrl: beforeProfile.resumeUrl,
    targetRoles: beforeProfile.targetRoles,
    preferredLocations: beforeProfile.preferredLocations,
    willingToRelocate: beforeProfile.willingToRelocate,
    dataConsentAccepted: beforeProfile.dataConsentAccepted,
    accuracyDeclarationAccepted: beforeProfile.accuracyDeclarationAccepted,
  };
  const after = {
    prn: afterProfile.prn,
    rollNumber: asTrimmedString(input.afterStudent.rollNumber),
    branch: asTrimmedString(input.afterStudent.branch),
    batch: asTrimmedString(input.afterStudent.batch),
    degree: afterProfile.degree,
    currentSemester: afterProfile.currentSemester,
    cgpa: input.afterStudent.cgpa === null || input.afterStudent.cgpa === undefined || input.afterStudent.cgpa === "" ? null : Number(input.afterStudent.cgpa),
    activeBacklogs: input.afterStudent.backlogs === null || input.afterStudent.backlogs === undefined || input.afterStudent.backlogs === "" ? null : Number(input.afterStudent.backlogs),
    totalHistoricalBacklogs: afterProfile.totalHistoricalBacklogs ?? (
      input.afterStudent.backlogs_total === null || input.afterStudent.backlogs_total === undefined || input.afterStudent.backlogs_total === ""
        ? null
        : Number(input.afterStudent.backlogs_total)
    ),
    attendancePct: input.afterStudent.attendance_pct === null || input.afterStudent.attendance_pct === undefined || input.afterStudent.attendance_pct === "" ? null : Number(input.afterStudent.attendance_pct),
    phone: afterProfile.phone,
    personalEmail: afterProfile.personalEmail,
    resumeUrl: afterProfile.resumeUrl,
    targetRoles: afterProfile.targetRoles,
    preferredLocations: afterProfile.preferredLocations,
    willingToRelocate: afterProfile.willingToRelocate,
    dataConsentAccepted: afterProfile.dataConsentAccepted,
    accuracyDeclarationAccepted: afterProfile.accuracyDeclarationAccepted,
  };
  const changes: string[] = [];

  MATERIAL_PROFILE_FIELDS.forEach((field) => {
    const beforeValue = before[field];
    const afterValue = after[field];

    if (Array.isArray(beforeValue) || Array.isArray(afterValue)) {
      const beforeArray = asStringArray(beforeValue);
      const afterArray = asStringArray(afterValue);
      if (JSON.stringify(beforeArray) !== JSON.stringify(afterArray)) {
        changes.push(field);
      }
      return;
    }

    if (typeof beforeValue === "boolean" || typeof afterValue === "boolean") {
      if (asBoolean(beforeValue) !== asBoolean(afterValue)) {
        changes.push(field);
      }
      return;
    }

    if (String(beforeValue ?? "") !== String(afterValue ?? "")) {
      changes.push(field);
    }
  });

  return changes;
}
