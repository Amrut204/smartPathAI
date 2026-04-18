import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Badge, Button, Card, Modal, Skeleton, Tabs } from "../../components/ui";
import { useOnlineStatus } from "../../hooks/use-online-status";
import {
  certifyStudentProfile,
  getProfileCertificationPreview,
  requestProfileUnlock,
  type StudentProfile,
  uploadStudentResume,
  updateStudentProfile,
  useStudentProfile,
} from "../../hooks/use-student-profile";

type ProfileFormState = {
  prn: string;
  rollNumber: string;
  branch: string;
  batch: string;
  degree: string;
  currentSemester: string;
  cgpa: string;
  activeBacklogs: string;
  totalHistoricalBacklogs: string;
  attendancePct: string;
  phone: string;
  personalEmail: string;
  resumeUrl: string;
  targetRoles: string[];
  preferredLocations: string[];
  willingToRelocate: "yes" | "no" | "";
  skills: string;
  linkedIn: string;
  githubUrl: string;
  portfolioUrl: string;
  internships: string;
  projects: string;
  certifications: string;
  achievements: string;
  languages: string;
  dataConsentAccepted: boolean;
  accuracyDeclarationAccepted: boolean;
};

type ProfileSection = "overview" | "verified" | "details" | "recommended";
type UnlockReasonCategory = "academic_record" | "resume_update" | "certification_correction" | "contact_update" | "other";
type ProfileSuccessAction = "save_profile" | "certify_profile" | "upload_resume" | "request_unlock" | null;

const baseProfileSectionTabs: Array<{ id: ProfileSection; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "verified", label: "Academic Details" },
  { id: "details", label: "Professional & Resume" },
  { id: "recommended", label: "Preferences" },
];

const semesterOptions = ["1", "2", "3", "4", "5", "6", "7", "8"];

const unlockFieldOptions = [
  { key: "cgpa", label: "CGPA" },
  { key: "activeBacklogs", label: "Active backlogs" },
  { key: "attendancePct", label: "Attendance" },
  { key: "resumeUrl", label: "Resume" },
  { key: "phone", label: "Phone number" },
  { key: "personalEmail", label: "Personal email" },
  { key: "targetRoles", label: "Target roles" },
  { key: "preferredLocations", label: "Preferred locations" },
] as const;

const unlockReasonOptions: Array<{ value: UnlockReasonCategory; label: string }> = [
  { value: "academic_record", label: "Academic record correction" },
  { value: "resume_update", label: "Resume update" },
  { value: "certification_correction", label: "Certification correction" },
  { value: "contact_update", label: "Contact update" },
  { value: "other", label: "Other" },
];

function joinCsv(values: string[]) {
  return values.join(", ");
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Pending";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function toggleSelection(current: string[], value: string) {
  return current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
}

function mapFieldKeyToProfileSection(fieldKey: string): ProfileSection {
  if ([
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
  ].includes(fieldKey)) {
    return "verified";
  }

  if (["targetRoles", "preferredLocations", "willingToRelocate"].includes(fieldKey)) {
    return "recommended";
  }

  if ([
    "resumeUrl",
    "phone",
    "personalEmail",
    "linkedIn",
    "githubUrl",
    "portfolioUrl",
    "skills",
    "languages",
    "internships",
    "projects",
    "certifications",
    "achievements",
  ].includes(fieldKey)) {
    return "details";
  }

  return "overview";
}

function getProfileSectionLabel(section: ProfileSection): string {
  if (section === "verified") return "Academic Details";
  if (section === "details") return "Professional & Resume";
  if (section === "recommended") return "Preferences";
  return "Overview";
}

function buildProfileContinuityState(params: {
  lastSuccessAction: ProfileSuccessAction;
  data: StudentProfile;
}) {
  if (!params.lastSuccessAction) return null;

  const primaryAction = params.data.nextBestActions[0] ?? null;
  const readyDrives = params.data.liveEligibility.readyForApplicationDrives;
  const eligibleDrives = params.data.liveEligibility.criteriaEligibleDrives;
  const blockers = params.data.activeBlockers.slice(0, 2);

  if (params.lastSuccessAction === "request_unlock") {
    return {
      eyebrow: "Request submitted",
      title: "Your placement office now has the correction request.",
      message:
        "While that request is under review, you can keep momentum going on preparation so you do not lose time.",
      metrics: [
        { label: "Upcoming drives", value: String(params.data.liveEligibility.totalUpcomingDrives) },
        { label: "Action-ready drives", value: String(readyDrives) },
      ],
      actions: params.data.nextBestActions
        .filter((action) => action.targetPath !== "/profile")
        .slice(0, 2)
        .map((action) => ({
          label: action.ctaLabel,
          targetPath: action.targetPath,
          description: action.title,
        })),
    };
  }

  const title =
    params.lastSuccessAction === "certify_profile"
      ? readyDrives > 0
        ? `Your profile is now application-ready for ${readyDrives} drive${readyDrives === 1 ? "" : "s"}.`
        : "Certification is done. One more profile step may still be blocking applications."
      : params.lastSuccessAction === "upload_resume"
        ? readyDrives > 0
          ? `Your resume is now helping unlock ${readyDrives} drive${readyDrives === 1 ? "" : "s"}.`
          : "Your resume is in place. Certification or academic criteria may still be the blocker."
        : readyDrives > 0
          ? `Your latest changes now leave you ready for ${readyDrives} drive${readyDrives === 1 ? "" : "s"}.`
          : "Your profile is updated. The next step is to convert that into drive readiness.";

  const message =
    readyDrives > 0
      ? `You currently match the full application requirements for ${readyDrives} upcoming drive${readyDrives === 1 ? "" : "s"} and the platform has already refreshed your recommendations.`
      : params.data.liveEligibility.nextAction
        ? `${params.data.liveEligibility.nextAction.label} would unlock ${params.data.liveEligibility.nextAction.unlockCount} more drive${params.data.liveEligibility.nextAction.unlockCount === 1 ? "" : "s"}.`
        : eligibleDrives > 0
          ? `You already meet the core criteria for ${eligibleDrives} drive${eligibleDrives === 1 ? "" : "s"}, but one or more readiness steps still need attention.`
          : "You are closer, but the current published drives still need more profile or academic alignment.";

  return {
    eyebrow: "Readiness update",
    title,
    message,
    metrics: [
      { label: "Action-ready drives", value: String(readyDrives) },
      { label: "Criteria matched", value: String(eligibleDrives) },
      { label: "Open blockers", value: String(params.data.activeBlockers.length) },
    ],
    actions: [
      primaryAction
        ? {
            label: primaryAction.ctaLabel,
            targetPath: primaryAction.targetPath,
            description: primaryAction.title,
          }
        : null,
      {
        label: "Open drives",
        targetPath: "/drives",
        description: "Check what changed in your drive readiness now.",
      },
    ].filter(Boolean) as Array<{ label: string; targetPath: string; description: string }>,
    blockers,
  };
}

export default function ProfilePage() {
  const { data, error, isLoading, mutate } = useStudentProfile();
  const isOnline = useOnlineStatus();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<string | null>(null);
  const [lastSuccessAction, setLastSuccessAction] = useState<ProfileSuccessAction>(null);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<ProfileSection>("overview");
  const [isCertificationOpen, setIsCertificationOpen] = useState(false);
  const [certificationTypedValue, setCertificationTypedValue] = useState("");
  const [certificationStatus, setCertificationStatus] = useState<string | null>(null);
  const [certificationBusy, setCertificationBusy] = useState(false);
  const [isTpoVisibilityOpen, setIsTpoVisibilityOpen] = useState(false);
  const [isUnlockOpen, setIsUnlockOpen] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockCategory, setUnlockCategory] = useState<UnlockReasonCategory>("academic_record");
  const [unlockExplanation, setUnlockExplanation] = useState("");
  const [unlockFields, setUnlockFields] = useState<string[]>([]);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [certificationPreview, setCertificationPreview] = useState<null | {
    certificationPreview: {
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
    materialFieldLabels: string[];
  }>(null);
  const [form, setForm] = useState<ProfileFormState>({
    prn: "",
    rollNumber: "",
    branch: "",
    batch: "",
    degree: "",
    currentSemester: "",
    cgpa: "",
    activeBacklogs: "",
    totalHistoricalBacklogs: "",
    attendancePct: "",
    phone: "",
    personalEmail: "",
    resumeUrl: "",
    targetRoles: [],
    preferredLocations: [],
    willingToRelocate: "",
    skills: "",
    linkedIn: "",
    githubUrl: "",
    portfolioUrl: "",
    internships: "",
    projects: "",
    certifications: "",
    achievements: "",
    languages: "",
    dataConsentAccepted: false,
    accuracyDeclarationAccepted: false,
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      prn: data.studentEditableProfile.prn ?? "",
      rollNumber: data.studentEditableProfile.rollNumber ?? "",
      branch: data.studentEditableProfile.branch ?? "",
      batch: data.studentEditableProfile.batch ?? "",
      degree: data.studentEditableProfile.degree ?? "",
      currentSemester: data.studentEditableProfile.currentSemester ?? "",
      cgpa: data.studentEditableProfile.cgpa == null ? "" : String(data.studentEditableProfile.cgpa),
      activeBacklogs: data.studentEditableProfile.activeBacklogs == null ? "" : String(data.studentEditableProfile.activeBacklogs),
      totalHistoricalBacklogs: data.studentEditableProfile.totalHistoricalBacklogs == null ? "" : String(data.studentEditableProfile.totalHistoricalBacklogs),
      attendancePct: data.studentEditableProfile.attendancePct == null ? "" : String(data.studentEditableProfile.attendancePct),
      phone: data.studentEditableProfile.phone ?? "",
      personalEmail: data.studentEditableProfile.personalEmail ?? "",
      resumeUrl: data.studentEditableProfile.resumeUrl ?? "",
      targetRoles: data.studentEditableProfile.targetRoles ?? [],
      preferredLocations: data.studentEditableProfile.preferredLocations ?? [],
      willingToRelocate:
        data.studentEditableProfile.willingToRelocate === true
          ? "yes"
          : data.studentEditableProfile.willingToRelocate === false
            ? "no"
            : "",
      skills: joinCsv(data.studentEditableProfile.skills ?? []),
      linkedIn: data.studentEditableProfile.linkedIn ?? "",
      githubUrl: data.studentEditableProfile.githubUrl ?? "",
      portfolioUrl: data.studentEditableProfile.portfolioUrl ?? "",
      internships: data.studentEditableProfile.internships ?? "",
      projects: data.studentEditableProfile.projects ?? "",
      certifications: data.studentEditableProfile.certifications ?? "",
      achievements: data.studentEditableProfile.achievements ?? "",
      languages: joinCsv(data.studentEditableProfile.languages ?? []),
      dataConsentAccepted: Boolean(data.studentEditableProfile.dataConsentAccepted),
      accuracyDeclarationAccepted: Boolean(data.studentEditableProfile.accuracyDeclarationAccepted),
    });
  }, [data]);

  useEffect(() => {
    if (searchParams.get("blocked")) {
      setActiveSection("overview");
    }
  }, [searchParams]);

  const blockedModule = searchParams.get("blocked");
  const blockedFrom = searchParams.get("from");
  const requiredFieldKeys = useMemo(
    () => new Set((data?.requiredFields ?? []).map((field) => field.key)),
    [data],
  );
  const isLocked = Boolean(data?.declarationStatus.profileCertification.isLocked);
  const branchOptions = useMemo(() => {
    if (!data) return [];
    return [...new Set([...data.profileOptions.branchOptions, data.studentEditableProfile.branch].filter(Boolean))];
  }, [data]);
  const degreeOptions = useMemo(() => {
    if (!data) return [];
    return [...new Set([...data.profileOptions.degreeOptions, data.studentEditableProfile.degree].filter(Boolean))];
  }, [data]);
  const currentSemesterNumber = Number(data?.studentEditableProfile.currentSemester || 0);
  const activeUnlockRequest = data?.unlockRequest ?? null;
  const canReviewAndCertify = Boolean(data?.profileCompleteness.isComplete) && !isLocked;
  const continuityState = data ? buildProfileContinuityState({ lastSuccessAction, data }) : null;
  const missingRequiredFields = data?.missingRequiredFields ?? [];
  const firstMissingRequiredField = missingRequiredFields[0] ?? null;
  const primaryMissingSection = firstMissingRequiredField
    ? mapFieldKeyToProfileSection(firstMissingRequiredField.key)
    : "overview";
  const primaryMissingSectionLabel = getProfileSectionLabel(primaryMissingSection);
  const profileCertificationStatus = data?.declarationStatus.profileCertification;
  const lockedModules = [
    data?.canAccessResources ? null : "Resources",
    data?.canAccessMockTests ? null : "Mock tests",
  ].filter((module): module is string => Boolean(module));
  const unlockImpactMessage = lockedModules.length > 0
    ? `${lockedModules.join(" and ")} unlock automatically after required profile fields are complete and saved.`
    : "Resources and mock tests are already unlocked. Keep this profile current so drive readiness stays accurate.";
  const priorityChecklistItems = [
    {
      id: "required-fields",
      title: "Complete required profile fields",
      detail: missingRequiredFields.length > 0
        ? `${missingRequiredFields.length} required field(s) still missing. Start with ${firstMissingRequiredField?.label ?? "the next required field"}.`
        : `All ${data?.profileCompleteness.totalRequiredFields ?? 0} required fields are complete.`,
      done: missingRequiredFields.length === 0,
      actionLabel: missingRequiredFields.length === 0 ? "Review overview" : `Open ${primaryMissingSectionLabel}`,
      actionType: "section" as const,
      sectionTarget: missingRequiredFields.length === 0 ? "overview" as ProfileSection : primaryMissingSection,
      actionDisabled: false,
    },
    {
      id: "profile-certification",
      title: "Review and certify profile",
      detail: profileCertificationStatus?.isCertified
        ? `Certified on ${formatDateTime(profileCertificationStatus.acceptedAt)}.`
        : data?.profileCompleteness.isComplete
          ? "Required fields are complete. Review final details and certify for drive use."
          : "Certification unlocks only after required fields are complete.",
      done: Boolean(profileCertificationStatus?.isCertified),
      actionLabel: profileCertificationStatus?.isCertified
        ? "Certified"
        : data?.profileCompleteness.isComplete
          ? "Review and certify"
          : `Open ${primaryMissingSectionLabel}`,
      actionType: profileCertificationStatus?.isCertified
        ? "section" as const
        : data?.profileCompleteness.isComplete
          ? "certify" as const
          : "section" as const,
      sectionTarget: data?.profileCompleteness.isComplete ? "overview" as ProfileSection : primaryMissingSection,
      actionDisabled: Boolean(profileCertificationStatus?.isCertified),
    },
    {
      id: "managed-resume",
      title: "Upload or verify managed resume",
      detail: data?.resumeInsights.hasManagedResume
        ? "Managed resume is available and will be used in drive applications."
        : "Upload a PDF resume so applications and exports use your latest version.",
      done: Boolean(data?.resumeInsights.hasManagedResume),
      actionLabel: data?.resumeInsights.hasManagedResume ? "Review resume section" : "Open resume section",
      actionType: "section" as const,
      sectionTarget: "details" as ProfileSection,
      actionDisabled: false,
    },
  ];

  if (isLoading) {
    return (
      <section className="student-workspace-shell profile-page">
        <header className="student-workspace-header student-profile-header">
          <div style={{ display: "grid", gap: 12, width: "100%" }}>
            <Skeleton size="sm" />
            <Skeleton size="lg" />
            <Skeleton size="md" />
          </div>
        </header>
        <section className="student-workspace-panel student-profile-switcher-panel">
          <div style={{ display: "flex", gap: 12 }}>
            <Skeleton size="md" />
            <Skeleton size="md" />
            <Skeleton size="md" />
          </div>
        </section>
        <section className="student-workspace-panel">
          <div style={{ display: "grid", gap: 12 }}>
            <Skeleton size="md" />
            <Skeleton size="sm" />
            <Skeleton size="sm" />
            <Skeleton size="sm" />
          </div>
        </section>
      </section>
    );
  }

  if (error || !data) {
    return <Card className="app-state-card app-state-card-error"><h2>Unable to load profile.</h2></Card>;
  }
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLocked) {
      setStatus("Your certified profile is locked. Submit an unlock request to edit it.");
      return;
    }

    setSaving(true);
    setStatus(null);
    setLastSuccessAction(null);

    try {
      await updateStudentProfile({
        prn: form.prn.trim(),
        rollNumber: form.rollNumber.trim(),
        branch: form.branch.trim(),
        batch: form.batch.trim(),
        degree: form.degree.trim(),
        currentSemester: form.currentSemester.trim(),
        cgpa: form.cgpa.trim() === "" ? null : Number(form.cgpa),
        activeBacklogs: form.activeBacklogs.trim() === "" ? null : Number(form.activeBacklogs),
        totalHistoricalBacklogs: form.totalHistoricalBacklogs.trim() === "" ? null : Number(form.totalHistoricalBacklogs),
        attendancePct: form.attendancePct.trim() === "" ? null : Number(form.attendancePct),
        phone: form.phone.trim(),
        personalEmail: form.personalEmail.trim(),
        resumeUrl: form.resumeUrl.trim(),
        targetRoles: form.targetRoles,
        preferredLocations: form.preferredLocations,
        willingToRelocate: form.willingToRelocate === "" ? undefined : form.willingToRelocate === "yes",
        skills: splitCsv(form.skills),
        linkedIn: form.linkedIn.trim() || undefined,
        githubUrl: form.githubUrl.trim() || undefined,
        portfolioUrl: form.portfolioUrl.trim() || undefined,
        internships: form.internships.trim() || undefined,
        projects: form.projects.trim() || undefined,
        certifications: form.certifications.trim() || undefined,
        achievements: form.achievements.trim() || undefined,
        languages: splitCsv(form.languages),
      });
      await mutate();
      setStatus("Profile updated successfully.");
      setLastSuccessAction("save_profile");
    } catch (updateError) {
      setStatus(updateError instanceof Error ? updateError.message : "Update failed");
      setLastSuccessAction(null);
    } finally {
      setSaving(false);
    }
  };

  const openCertification = async () => {
    setCertificationStatus(null);
    setCertificationTypedValue("");
    setCertificationBusy(true);
    try {
      const preview = await getProfileCertificationPreview();
      setCertificationPreview(preview);
      setIsCertificationOpen(true);
    } catch (previewError) {
      setCertificationStatus(previewError instanceof Error ? previewError.message : "Unable to load certification preview");
    } finally {
      setCertificationBusy(false);
    }
  };

  const submitCertification = async () => {
    setCertificationBusy(true);
    setCertificationStatus(null);
    setLastSuccessAction(null);
    try {
      await certifyStudentProfile({ typedValue: certificationTypedValue });
      await mutate();
      setIsCertificationOpen(false);
      setCertificationTypedValue("");
      setStatus("Profile certified successfully.");
      setLastSuccessAction("certify_profile");
    } catch (certificationError) {
      setCertificationStatus(certificationError instanceof Error ? certificationError.message : "Unable to certify profile");
      setLastSuccessAction(null);
    } finally {
      setCertificationBusy(false);
    }
  };

  const handleResumeUpload = async () => {
    if (!resumeFile) {
      setStatus("Choose a PDF resume before uploading.");
      return;
    }
    if (!isOnline) {
      setStatus("You are offline. Reconnect before uploading or replacing your resume.");
      return;
    }

    setResumeBusy(true);
    setStatus(null);
    setLastSuccessAction(null);
    try {
      await uploadStudentResume(resumeFile);
      await mutate();
      setResumeFile(null);
      setStatus("Resume uploaded successfully.");
      setLastSuccessAction("upload_resume");
    } catch (resumeError) {
      setStatus(
        !isOnline
          ? "Connection lost while uploading. Reconnect and retry the resume upload."
          : resumeError instanceof Error
            ? resumeError.message
            : "Unable to upload resume",
      );
      setLastSuccessAction(null);
    } finally {
      setResumeBusy(false);
    }
  };

  const handleUnlockRequest = async () => {
    setUnlockBusy(true);
    setStatus(null);
    setLastSuccessAction(null);
    try {
      await requestProfileUnlock({
        reasonCategory: unlockCategory,
        requestedFields: unlockFields,
        explanation: unlockExplanation,
      });
      await mutate();
      setIsUnlockOpen(false);
      setUnlockExplanation("");
      setUnlockFields([]);
      setStatus("Unlock request submitted successfully.");
      setLastSuccessAction("request_unlock");
    } catch (unlockError) {
      setStatus(unlockError instanceof Error ? unlockError.message : "Unable to submit unlock request");
      setLastSuccessAction(null);
    } finally {
      setUnlockBusy(false);
    }
  };

  return (
    <section className="student-workspace-shell profile-page">
      <header className="student-workspace-header student-profile-header">
        <div>
          <p className="resources-kicker">Student Profile</p>
          <h1>Your placement identity, readiness, and documents in one place.</h1>
          <p>
            Keep your profile accurate, understand what is blocking drives, and manage the information Smart Path uses across resumes, recommendations, and applications.
          </p>
        </div>
      </header>

      <section className="student-workspace-panel student-profile-readiness-shell">
        {!isOnline ? (
          <div className="student-profile-inline-alert is-warning">
            <strong>You are offline.</strong>
            <span>Profile edits stay on the page, but saving changes and resume uploads need a live connection.</span>
          </div>
        ) : null}

        <div className={`student-profile-readiness is-${data.readinessBanner.tone}`}>
          <div>
            <span className="resources-kicker">Placement readiness</span>
            <h2>{data.readinessBanner.title}</h2>
            <p>{data.readinessBanner.message}</p>
          </div>
          <div className="hero-actions">
            {isLocked ? (
              <Button type="button" onClick={() => setIsUnlockOpen(true)}>
                {activeUnlockRequest?.status === "pending" ? "Unlock pending" : "Request unlock"}
              </Button>
            ) : !data.declarationStatus.profileCertification.isCertified ? (
              <Button type="button" onClick={openCertification} disabled={!canReviewAndCertify || certificationBusy}>
                {certificationBusy ? "Loading..." : "Review and certify"}
              </Button>
            ) : !data.resumeInsights.hasManagedResume ? (
              <Button type="button" onClick={() => setActiveSection("details")}>Upload resume</Button>
            ) : null}
          </div>
        </div>

        {blockedModule ? (
          <div className="student-profile-inline-alert is-warning">
            <strong>{blockedModule === "mock-tests" ? "Mock tests are currently locked" : "Resources are currently locked"}</strong>
            <span>
              {blockedFrom
                ? `You were redirected from ${blockedFrom}. Complete your required profile fields below to unlock this section.`
                : "Complete your required profile fields below to unlock this section."}
            </span>
            {data.missingStudentFields.length > 0 ? (
              <span>
                Start with: {data.missingStudentFields.slice(0, 3).map((field) => field.label).join(", ")}
              </span>
            ) : null}
          </div>
        ) : null}

        {status ? (
          <div className={`student-profile-inline-alert ${status.toLowerCase().includes("success") ? "is-success" : "is-warning"}`}>
            <span>{status}</span>
          </div>
        ) : null}

        {continuityState ? (
          <div className="student-continuity-banner">
            <div className="student-continuity-copy">
              <span className="resources-kicker">{continuityState.eyebrow}</span>
              <h3>{continuityState.title}</h3>
              <p>{continuityState.message}</p>
            </div>
            <div className="student-continuity-metrics">
              {continuityState.metrics.map((metric) => (
                <div key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </div>
              ))}
            </div>
            {continuityState.blockers && continuityState.blockers.length > 0 ? (
              <div className="student-continuity-tags">
                {continuityState.blockers.map((blocker) => (
                  <span key={blocker.code} className="resource-topic-chip resource-topic-chip-reason">
                    {blocker.label} · {blocker.count}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="hero-actions">
              {continuityState.actions.map((action) => (
                <Button
                  key={`${action.targetPath}_${action.label}`}
                  type="button"
                  variant={action.targetPath === "/drives" ? "secondary" : "primary"}
                  onClick={() => {
                    if (action.targetPath === "/profile") {
                      setActiveSection("overview");
                      return;
                    }
                    navigate(action.targetPath);
                  }}
                  title={action.description}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        <section className="student-profile-priority-panel">
          <div className="student-workspace-panel-head">
            <div>
              <h2>Priority checklist</h2>
              <p>Finish these in order so unlocks and drive readiness stay in sync.</p>
            </div>
          </div>
          <ol className="student-profile-priority-list">
            {priorityChecklistItems.map((item, index) => (
              <li
                key={item.id}
                className={`student-profile-priority-item ${item.done ? "is-complete" : index === 0 ? "is-active" : "is-pending"}`}
              >
                <div className="student-profile-priority-copy">
                  <span className="resources-kicker">{item.done ? "Done" : `Step ${index + 1}`}</span>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
                <div className="student-profile-priority-actions">
                  <Badge variant={item.done ? "success" : "warning"}>{item.done ? "Completed" : "Pending"}</Badge>
                  <Button
                    type="button"
                    variant={index === 0 && !item.done ? "primary" : "secondary"}
                    disabled={item.actionDisabled}
                    onClick={() => {
                      if (item.actionType === "certify") {
                        void openCertification();
                        return;
                      }

                      setActiveSection(item.sectionTarget);
                    }}
                  >
                    {item.actionLabel}
                  </Button>
                </div>
              </li>
            ))}
          </ol>
          <p className="student-profile-unlock-impact">{unlockImpactMessage}</p>
        </section>

        <div className="student-profile-action-bar">
          <Button
            type="submit"
            form="student-profile-form"
            disabled={saving || isLocked}
            title={isLocked ? "Your profile is locked until the placement office approves an unlock request." : undefined}
          >
            {saving ? "Saving..." : "Save changes"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={openCertification}
            disabled={!canReviewAndCertify || certificationBusy || data.declarationStatus.profileCertification.isCertified}
            title={!data.profileCompleteness.isComplete ? "Complete all required fields before certification." : undefined}
          >
            {data.declarationStatus.profileCertification.isCertified ? "Certified" : "Review and certify"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setActiveSection("details")}>
            {data.resumeInsights.hasManagedResume ? "Replace resume" : "Upload resume"}
          </Button>
        </div>
      </section>

      <section className="student-workspace-panel student-profile-switcher-panel">
        <Tabs
          tabs={baseProfileSectionTabs}
          activeId={activeSection}
          onChange={(id) => setActiveSection(id as ProfileSection)}
        />
      </section>

      <form id="student-profile-form" className="student-profile-form-shell" onSubmit={onSubmit}>
        {activeSection === "overview" ? (
          <section className="student-workspace-panel">
            <div className="student-workspace-panel-head">
              <div>
                <h2>Overview</h2>
                <p>See your current readiness, what is missing, and how your profile affects real upcoming drives.</p>
              </div>
            </div>

            <div className="student-profile-metrics-grid">
              <div><span>Ready now</span><strong>{data.liveEligibility.readyForApplicationDrives}</strong></div>
              <div><span>Criteria match</span><strong>{data.liveEligibility.criteriaEligibleDrives}</strong></div>
              <div><span>Upcoming drives</span><strong>{data.liveEligibility.totalUpcomingDrives}</strong></div>
              <div><span>Resume usage</span><strong>{data.resumeInsights.usageCount}</strong></div>
            </div>

            {data.liveEligibility.nextAction ? (
              <div className="student-profile-inline-alert is-success">
                <strong>{data.liveEligibility.nextAction.label}</strong>
                <span>would unlock {data.liveEligibility.nextAction.unlockCount} more drive{data.liveEligibility.nextAction.unlockCount === 1 ? "" : "s"}.</span>
              </div>
            ) : null}

            {activeUnlockRequest ? (
              <div className="student-profile-unlock-state">
                <div>
                  <span className="resources-kicker">Unlock request</span>
                  <h3>{activeUnlockRequest.status === "pending" ? "Waiting for placement office review" : `Request ${activeUnlockRequest.status}`}</h3>
                  <p>{activeUnlockRequest.explanation || "Your latest unlock request is being tracked here."}</p>
                </div>
                <div className="student-profile-mini-stack">
                  <strong>Submitted</strong>
                  <span>{formatDateTime(activeUnlockRequest.createdAt)}</span>
                  {activeUnlockRequest.responseNote ? <small>{activeUnlockRequest.responseNote}</small> : null}
                </div>
              </div>
            ) : null}

            <div className="student-profile-two-column">
              <div className="student-profile-card-block">
                <h3>Still required</h3>
                {(data.missingRequiredFields ?? []).length > 0 ? (
                  <ul className="dashboard-bullet-list">
                    {data.missingRequiredFields.map((field) => (
                      <li key={field.key}>{field.label}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-text">No required fields are currently missing.</p>
                )}
              </div>

              <div className="student-profile-card-block">
                <h3>What is blocking drives</h3>
                {data.liveEligibility.blockers.length > 0 ? (
                  <ul className="dashboard-bullet-list">
                    {data.liveEligibility.blockers.map((blocker) => (
                      <li key={blocker.code}>{blocker.label} ({blocker.count})</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-text">No blocker summary right now. Your current profile is in a healthy state.</p>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {activeSection === "verified" ? (
          <section className="student-workspace-panel">
            <div className="student-workspace-panel-head">
              <div>
                <h2>Academic details</h2>
                <p>These fields drive eligibility decisions. Review them carefully and request an unlock if something college-seeded is incorrect.</p>
              </div>
            </div>

            <div className="student-profile-readonly-grid">
              <div>
                <span>Full name</span>
                <strong>{data.seededProfile.fullName || "Pending"}</strong>
                <em className={`student-profile-trust ${data.fieldTrust.fullName?.locked ? "is-locked" : "is-verified"}`}>{data.fieldTrust.fullName?.label}</em>
              </div>
              <div>
                <span>College email</span>
                <strong>{data.seededProfile.collegeEmail || "Pending"}</strong>
                <em className={`student-profile-trust ${data.fieldTrust.collegeEmail?.locked ? "is-locked" : "is-verified"}`}>{data.fieldTrust.collegeEmail?.label}</em>
              </div>
            </div>

            <div className="form-grid student-profile-field-grid">
              <label>
                PRN{requiredFieldKeys.has("prn") ? <span className="required-asterisk"> *</span> : null}
                <input disabled={isLocked} value={form.prn} onChange={(event) => setForm((current) => ({ ...current, prn: event.target.value }))} />
              </label>
              <label>
                Roll Number{requiredFieldKeys.has("rollNumber") ? <span className="required-asterisk"> *</span> : null}
                <input disabled={isLocked} value={form.rollNumber} onChange={(event) => setForm((current) => ({ ...current, rollNumber: event.target.value }))} />
                <small className="muted-text">{data.fieldTrust.rollNumber?.label}</small>
              </label>
              <label>
                Branch{requiredFieldKeys.has("branch") ? <span className="required-asterisk"> *</span> : null}
                <select disabled={isLocked} value={form.branch} onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))}>
                  <option value="">Select branch</option>
                  {branchOptions.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                </select>
                {data.fieldHelp.branch ? <small className="muted-text">{data.fieldHelp.branch}</small> : null}
              </label>
              <label>
                Batch{requiredFieldKeys.has("batch") ? <span className="required-asterisk"> *</span> : null}
                <input disabled={isLocked} value={form.batch} onChange={(event) => setForm((current) => ({ ...current, batch: event.target.value }))} />
                <small className="muted-text">{data.fieldTrust.batch?.label}</small>
              </label>
              <label>
                Degree{requiredFieldKeys.has("degree") ? <span className="required-asterisk"> *</span> : null}
                <select disabled={isLocked} value={form.degree} onChange={(event) => setForm((current) => ({ ...current, degree: event.target.value }))}>
                  <option value="">Select degree</option>
                  {degreeOptions.map((degree) => <option key={degree} value={degree}>{degree}</option>)}
                </select>
              </label>
              <label>
                Current Semester{requiredFieldKeys.has("currentSemester") ? <span className="required-asterisk"> *</span> : null}
                <select disabled={isLocked} value={form.currentSemester} onChange={(event) => setForm((current) => ({ ...current, currentSemester: event.target.value }))}>
                  <option value="">Select semester</option>
                  {semesterOptions.map((semester) => {
                    const numericSemester = Number(semester);
                    const isDecrease = currentSemesterNumber > 0 && numericSemester < currentSemesterNumber;
                    return <option key={semester} value={semester} disabled={isDecrease}>{semester}</option>;
                  })}
                </select>
              </label>
              <label>
                CGPA{requiredFieldKeys.has("cgpa") ? <span className="required-asterisk"> *</span> : null}
                <input disabled={isLocked} type="number" min="0" max="10" step="0.01" value={form.cgpa} onChange={(event) => setForm((current) => ({ ...current, cgpa: event.target.value }))} />
                {data.fieldHelp.cgpa ? <small className="muted-text">{data.fieldHelp.cgpa}</small> : null}
              </label>
              <label>
                Active Backlogs{requiredFieldKeys.has("activeBacklogs") ? <span className="required-asterisk"> *</span> : null}
                <input disabled={isLocked} type="number" min="0" step="1" value={form.activeBacklogs} onChange={(event) => setForm((current) => ({ ...current, activeBacklogs: event.target.value }))} />
                {data.fieldHelp.activeBacklogs ? <small className="muted-text">{data.fieldHelp.activeBacklogs}</small> : null}
              </label>
              <label>
                Total Historical Backlogs{requiredFieldKeys.has("totalHistoricalBacklogs") ? <span className="required-asterisk"> *</span> : null}
                <input disabled={isLocked} type="number" min="0" step="1" value={form.totalHistoricalBacklogs} onChange={(event) => setForm((current) => ({ ...current, totalHistoricalBacklogs: event.target.value }))} />
                {data.fieldHelp.totalHistoricalBacklogs ? <small className="muted-text">{data.fieldHelp.totalHistoricalBacklogs}</small> : null}
              </label>
              <label>
                Attendance %{requiredFieldKeys.has("attendancePct") ? <span className="required-asterisk"> *</span> : null}
                <input disabled={isLocked} type="number" min="0" max="100" step="0.1" value={form.attendancePct} onChange={(event) => setForm((current) => ({ ...current, attendancePct: event.target.value }))} />
                {data.fieldHelp.attendancePct ? <small className="muted-text">{data.fieldHelp.attendancePct}</small> : null}
              </label>
            </div>
          </section>
        ) : null}
        {activeSection === "details" ? (
          <section className="student-workspace-panel">
            <div className="student-workspace-panel-head">
              <div>
                <h2>Professional & resume</h2>
                <p>Manage the resume and professional links that feed drive applications and TPO exports.</p>
              </div>
            </div>

            <div className="student-profile-resume-card">
              <div>
                <span className="resources-kicker">Resume module</span>
                <h3>
                  {data.resumeInsights.hasManagedResume
                    ? data.studentEditableProfile.resumeFilename || "Managed resume uploaded"
                    : data.resumeInsights.hasLegacyResumeLink
                      ? "Legacy resume link only"
                      : "No resume uploaded yet"}
                </h3>
                <p>
                  {data.resumeInsights.hasManagedResume
                    ? "This is the resume Smart Path snapshots into drive applications."
                    : data.resumeInsights.hasLegacyResumeLink
                      ? "You still have a legacy link on profile. Replace it with a managed upload when possible."
                      : "Upload a PDF so your profile is ready for drive applications and TPO resume export."}
                </p>
              </div>
              <div className="student-profile-resume-meta">
                <div><span>Upload time</span><strong>{formatDateTime(data.studentEditableProfile.resumeUploadedAt)}</strong></div>
                <div><span>File size</span><strong>{data.resumeInsights.fileSizeLabel || "Pending"}</strong></div>
                <div><span>Used in drives</span><strong>{data.resumeInsights.usageCount}</strong></div>
              </div>
              <div className="hero-actions">
                {data.studentEditableProfile.resumeDriveWebLink ? (
                  <a href={data.studentEditableProfile.resumeDriveWebLink} target="_blank" rel="noreferrer">
                    <Button type="button" variant="secondary">Preview current resume</Button>
                  </a>
                ) : null}
              </div>
            </div>

            <div className="form-grid student-profile-field-grid">
              <div style={{ gridColumn: "1 / -1" }}>
                <label>
                  Resume PDF{requiredFieldKeys.has("resumeUrl") ? <span className="required-asterisk"> *</span> : null}
                  <input
                    disabled={isLocked}
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(event) => setResumeFile(event.target.files?.[0] ?? null)}
                  />
                  {data.fieldHelp.resumeUrl ? <small className="muted-text">{data.fieldHelp.resumeUrl}</small> : null}
                </label>
                <div className="hero-actions">
                  <Button type="button" disabled={isLocked || resumeBusy || !resumeFile} onClick={handleResumeUpload}>
                    {resumeBusy ? "Uploading..." : data.resumeInsights.hasManagedResume ? "Replace resume" : "Upload resume PDF"}
                  </Button>
                </div>
                {data.resumeInsights.hasLegacyResumeLink ? (
                  <p className="muted-text">
                    Legacy resume link on profile:{" "}
                    <a href={data.studentEditableProfile.resumeUrl} target="_blank" rel="noreferrer">
                      {data.studentEditableProfile.resumeUrl}
                    </a>
                  </p>
                ) : null}
              </div>

              <label>
                Legacy Resume Link (optional fallback)
                <input disabled={isLocked} value={form.resumeUrl} onChange={(event) => setForm((current) => ({ ...current, resumeUrl: event.target.value }))} placeholder="Optional backup link while managed uploads roll out" />
              </label>
              <label>
                Phone Number{requiredFieldKeys.has("phone") ? <span className="required-asterisk"> *</span> : null}
                <input disabled={isLocked} value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
              </label>
              <label>
                Personal Email{requiredFieldKeys.has("personalEmail") ? <span className="required-asterisk"> *</span> : null}
                <input disabled={isLocked} type="email" value={form.personalEmail} onChange={(event) => setForm((current) => ({ ...current, personalEmail: event.target.value }))} />
              </label>
              <label>
                LinkedIn
                <input disabled={isLocked} value={form.linkedIn} onChange={(event) => setForm((current) => ({ ...current, linkedIn: event.target.value }))} />
              </label>
              <label>
                GitHub / Coding Profile
                <input disabled={isLocked} value={form.githubUrl} onChange={(event) => setForm((current) => ({ ...current, githubUrl: event.target.value }))} />
              </label>
              <label>
                Portfolio
                <input disabled={isLocked} value={form.portfolioUrl} onChange={(event) => setForm((current) => ({ ...current, portfolioUrl: event.target.value }))} />
              </label>
              <label>
                Skills
                <input disabled={isLocked} value={form.skills} onChange={(event) => setForm((current) => ({ ...current, skills: event.target.value }))} placeholder="Communication, Aptitude, SQL" />
              </label>
              <label>
                Languages
                <input disabled={isLocked} value={form.languages} onChange={(event) => setForm((current) => ({ ...current, languages: event.target.value }))} placeholder="English, Hindi, Marathi" />
              </label>
            </div>

            <div className="form-grid student-profile-field-grid">
              <label>
                Internships
                <textarea disabled={isLocked} rows={4} value={form.internships} onChange={(event) => setForm((current) => ({ ...current, internships: event.target.value }))} placeholder="Short summary of internship work and outcomes" />
              </label>
              <label>
                Projects
                <textarea disabled={isLocked} rows={4} value={form.projects} onChange={(event) => setForm((current) => ({ ...current, projects: event.target.value }))} placeholder="Key projects that support your placement profile" />
              </label>
              <label>
                Certifications
                <textarea disabled={isLocked} rows={4} value={form.certifications} onChange={(event) => setForm((current) => ({ ...current, certifications: event.target.value }))} placeholder="Certifications, workshops, or licenses" />
              </label>
              <label>
                Achievements
                <textarea disabled={isLocked} rows={4} value={form.achievements} onChange={(event) => setForm((current) => ({ ...current, achievements: event.target.value }))} placeholder="Awards, competitions, leadership, publications" />
              </label>
            </div>

            <div className="student-profile-certification-panel">
              <div>
                <span className="resources-kicker">Verification</span>
                <h3>
                  {data.declarationStatus.profileCertification.isCertified
                    ? "Profile certified"
                    : data.declarationStatus.profileCertification.requiresRecertification
                      ? "Recertification required"
                      : data.profileCompleteness.isComplete
                        ? "Ready to certify"
                        : "Finish required fields first"}
                </h3>
                <p>
                  {data.declarationStatus.profileCertification.isCertified
                    ? data.declarationStatus.profileCertification.isLocked
                      ? "Your profile is certified and locked until the placement office unlocks it."
                      : "Your profile has been reviewed and certified for drive-use decisions."
                    : data.declarationStatus.profileCertification.requiresRecertification
                      ? "You changed important placement fields after certification. Review and certify again before applying to drives."
                      : data.profileCompleteness.isComplete
                        ? "Review your final placement details and certify them before drive applications."
                        : "Drive certification becomes available once every required field is complete."}
                </p>
              </div>
              {!data.declarationStatus.profileCertification.isCertified ? (
                <div className="hero-actions">
                  <Button type="button" disabled={!canReviewAndCertify || certificationBusy} onClick={openCertification}>
                    {certificationBusy ? "Loading..." : "Review and certify"}
                  </Button>
                </div>
              ) : (
                <p className="success-text">
                  Certified on {formatDateTime(data.declarationStatus.profileCertification.acceptedAt)}
                  {data.declarationStatus.profileCertification.isLocked ? " - Locked for edits" : ""}
                </p>
              )}
            </div>
          </section>
        ) : null}

        {activeSection === "recommended" ? (
          <section className="student-workspace-panel">
            <div className="student-workspace-panel-head">
              <div>
                <h2>Preferences</h2>
                <p>These preferences shape recommendations and help the platform reflect your placement direction more accurately.</p>
              </div>
            </div>

            <div className="student-profile-two-column">
              <div className="student-profile-preference-block">
                <span className="resources-kicker">Target roles</span>
                <h3>Used for personalization</h3>
                <p>{data.preferenceVisibility.targetRoles.label}</p>
                <div className="student-profile-chip-grid">
                  {data.profileOptions.targetRoleOptions.map((role) => (
                    <button
                      key={role}
                      type="button"
                      className={`student-profile-chip ${form.targetRoles.includes(role) ? "is-active" : ""}`}
                      disabled={isLocked}
                      onClick={() => setForm((current) => ({ ...current, targetRoles: toggleSelection(current.targetRoles, role) }))}
                    >
                      {role}
                    </button>
                  ))}
                </div>
                {data.fieldHelp.targetRoles ? <small className="muted-text">{data.fieldHelp.targetRoles}</small> : null}
              </div>

              <div className="student-profile-preference-block">
                <span className="resources-kicker">Preferred locations</span>
                <h3>Keep this structured</h3>
                <p>{data.preferenceVisibility.preferredLocations.label}</p>
                <div className="student-profile-chip-grid">
                  {data.profileOptions.preferredLocationOptions.map((location) => (
                    <button
                      key={location}
                      type="button"
                      className={`student-profile-chip ${form.preferredLocations.includes(location) ? "is-active" : ""}`}
                      disabled={isLocked}
                      onClick={() => setForm((current) => ({ ...current, preferredLocations: toggleSelection(current.preferredLocations, location) }))}
                    >
                      {location}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="form-grid student-profile-field-grid">
              <label>
                Willing to Relocate{requiredFieldKeys.has("willingToRelocate") ? <span className="required-asterisk"> *</span> : null}
                <select disabled={isLocked} value={form.willingToRelocate} onChange={(event) => setForm((current) => ({ ...current, willingToRelocate: event.target.value as "yes" | "no" | "" }))}>
                  <option value="">Select one</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
                <small className="muted-text">{data.preferenceVisibility.willingToRelocate.label}</small>
              </label>
            </div>
          </section>
        ) : null}
      </form>

      <section className="student-workspace-panel student-profile-visibility-panel">
        <button
          type="button"
          className="student-profile-visibility-toggle"
          onClick={() => setIsTpoVisibilityOpen((current) => !current)}
          aria-expanded={isTpoVisibilityOpen}
        >
          <div>
            <span className="resources-kicker">{data.tpoVisibilitySummary.title}</span>
            <h2>Understand what your placement office can review.</h2>
            <p>{data.tpoVisibilitySummary.description}</p>
          </div>
          <span className="student-profile-visibility-toggle-icon" aria-hidden="true">
            {isTpoVisibilityOpen ? "-" : "+"}
          </span>
        </button>

        {isTpoVisibilityOpen ? (
          <div className="student-profile-visibility-content">
            <div className="student-profile-visibility-rows">
              {data.tpoVisibilitySummary.rows.map((row) => (
                <div key={row.key} className="student-profile-visibility-row">
                  <span className="student-profile-visibility-label">{row.label}</span>
                  <strong className="student-profile-visibility-value">{row.value}</strong>
                  <span className={`student-profile-visibility-status is-${row.status}`}>
                    <span className="student-profile-visibility-dot" aria-hidden="true" />
                    <span className="student-profile-visibility-status-text">
                      {row.status === "good" ? "On track" : row.status === "attention" ? "Needs attention" : "Needs action"}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <div className="student-profile-preference-visibility-grid">
              <div>
                <span>Target roles</span>
                <strong>{data.preferenceVisibility.targetRoles.label}</strong>
              </div>
              <div>
                <span>Preferred locations</span>
                <strong>{data.preferenceVisibility.preferredLocations.label}</strong>
              </div>
              <div>
                <span>Relocation preference</span>
                <strong>{data.preferenceVisibility.willingToRelocate.label}</strong>
              </div>
            </div>
            <p className="muted-text student-profile-visibility-note">{data.tpoVisibilitySummary.note}</p>
          </div>
        ) : null}
      </section>
      <Modal open={isCertificationOpen} onClose={() => setIsCertificationOpen(false)} title="Certify profile details">
        <div className="student-profile-certification-modal">
          <p>
            Review the details below carefully. If anything is incorrect, close this dialog and update it before continuing.
          </p>

          {certificationPreview ? (
            <>
              <div className="student-profile-certification-grid">
                <div><span>Name</span><strong>{certificationPreview.certificationPreview.studentName}</strong></div>
                <div><span>Roll number</span><strong>{certificationPreview.certificationPreview.rollNumber}</strong></div>
                <div><span>PRN</span><strong>{certificationPreview.certificationPreview.prn || "Pending"}</strong></div>
                <div><span>College email</span><strong>{certificationPreview.certificationPreview.collegeEmail}</strong></div>
                <div><span>Branch</span><strong>{certificationPreview.certificationPreview.branch}</strong></div>
                <div><span>Batch</span><strong>{certificationPreview.certificationPreview.batch}</strong></div>
                <div><span>Degree</span><strong>{certificationPreview.certificationPreview.degree || "Pending"}</strong></div>
                <div><span>Current semester</span><strong>{certificationPreview.certificationPreview.currentSemester || "Pending"}</strong></div>
                <div><span>Phone</span><strong>{certificationPreview.certificationPreview.phone}</strong></div>
                <div><span>Personal email</span><strong>{certificationPreview.certificationPreview.personalEmail}</strong></div>
                <div><span>Resume link</span><strong>{certificationPreview.certificationPreview.resumeUrl}</strong></div>
                <div><span>Target roles</span><strong>{certificationPreview.certificationPreview.targetRoles.join(", ") || "Pending"}</strong></div>
                <div><span>Preferred locations</span><strong>{certificationPreview.certificationPreview.preferredLocations.join(", ") || "Pending"}</strong></div>
                <div><span>Relocation</span><strong>{certificationPreview.certificationPreview.willingToRelocate === true ? "Yes" : certificationPreview.certificationPreview.willingToRelocate === false ? "No" : "Pending"}</strong></div>
                <div><span>CGPA</span><strong>{certificationPreview.certificationPreview.cgpa ?? "Pending"}</strong></div>
                <div><span>Active backlogs</span><strong>{certificationPreview.certificationPreview.activeBacklogs ?? "Pending"}</strong></div>
                <div><span>Total historical backlogs</span><strong>{certificationPreview.certificationPreview.totalHistoricalBacklogs ?? "Pending"}</strong></div>
                <div><span>Attendance</span><strong>{certificationPreview.certificationPreview.attendancePct ?? "Pending"}</strong></div>
              </div>
              <p className="muted-text">
                This certification covers: {certificationPreview.materialFieldLabels.join(", ")}.
              </p>
            </>
          ) : null}

          <label>
            Type <strong>{data.declarationStatus.profileCertification.typedValueHint}</strong> to certify this profile
            <input value={certificationTypedValue} onChange={(event) => setCertificationTypedValue(event.target.value)} />
          </label>

          <div className="hero-actions">
            <Button type="button" disabled={certificationBusy} onClick={submitCertification}>
              {certificationBusy ? "Certifying..." : "Certify profile"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setIsCertificationOpen(false)}>Cancel</Button>
          </div>
          {certificationStatus ? <p className="error-text">{certificationStatus}</p> : null}
        </div>
      </Modal>

      <Modal open={isUnlockOpen} onClose={() => setIsUnlockOpen(false)} title="Request profile unlock">
        <div className="student-profile-unlock-modal">
          <p>
            Use this when a locked profile needs a correction. Your placement office will review the request and either approve or deny it with a note.
          </p>
          <label>
            Reason category
            <select value={unlockCategory} onChange={(event) => setUnlockCategory(event.target.value as UnlockReasonCategory)}>
              {unlockReasonOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div>
            <span className="resources-kicker">Requested fields</span>
            <div className="student-profile-chip-grid student-profile-unlock-fields">
              {unlockFieldOptions.map((field) => (
                <button
                  key={field.key}
                  type="button"
                  className={`student-profile-chip ${unlockFields.includes(field.key) ? "is-active" : ""}`}
                  onClick={() => setUnlockFields((current) => toggleSelection(current, field.key))}
                >
                  {field.label}
                </button>
              ))}
            </div>
          </div>
          <label>
            Explain what needs to change
            <textarea rows={4} value={unlockExplanation} onChange={(event) => setUnlockExplanation(event.target.value)} placeholder="Example: semester result updated and CGPA needs correction before next drive." />
          </label>
          <div className="hero-actions">
            <Button type="button" disabled={unlockBusy || unlockExplanation.trim().length === 0} onClick={handleUnlockRequest}>
              {unlockBusy ? "Submitting..." : "Submit unlock request"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setIsUnlockOpen(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
