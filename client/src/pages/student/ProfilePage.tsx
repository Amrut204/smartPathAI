import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { Button, Card, Modal, Skeleton, Tabs } from "../../components/ui";
import {
  certifyStudentProfile,
  getProfileCertificationPreview,
  requestProfileUnlock,
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

const baseProfileSectionTabs: Array<{ id: ProfileSection; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "verified", label: "Academic Details" },
  { id: "details", label: "Placement & Resume" },
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

export default function ProfilePage() {
  const { data, error, isLoading, mutate } = useStudentProfile();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<string | null>(null);
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
    } catch (updateError) {
      setStatus(updateError instanceof Error ? updateError.message : "Update failed");
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
    try {
      await certifyStudentProfile({ typedValue: certificationTypedValue });
      await mutate();
      setIsCertificationOpen(false);
      setCertificationTypedValue("");
      setStatus("Profile certified successfully.");
    } catch (certificationError) {
      setCertificationStatus(certificationError instanceof Error ? certificationError.message : "Unable to certify profile");
    } finally {
      setCertificationBusy(false);
    }
  };

  const handleResumeUpload = async () => {
    if (!resumeFile) {
      setStatus("Choose a PDF resume before uploading.");
      return;
    }

    setResumeBusy(true);
    setStatus(null);
    try {
      await uploadStudentResume(resumeFile);
      await mutate();
      setResumeFile(null);
      setStatus("Resume uploaded successfully.");
    } catch (resumeError) {
      setStatus(resumeError instanceof Error ? resumeError.message : "Unable to upload resume");
    } finally {
      setResumeBusy(false);
    }
  };

  const handleUnlockRequest = async () => {
    setUnlockBusy(true);
    setStatus(null);
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
    } catch (unlockError) {
      setStatus(unlockError instanceof Error ? unlockError.message : "Unable to submit unlock request");
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
          <div className="student-profile-inline-alert">
            <strong>{blockedModule === "mock-tests" ? "Mock tests are locked" : "Resources are locked"}</strong>
            <span>Finish the missing required fields below to unlock this section.</span>
          </div>
        ) : null}

        {status ? (
          <div className={`student-profile-inline-alert ${status.toLowerCase().includes("success") ? "is-success" : "is-warning"}`}>
            <span>{status}</span>
          </div>
        ) : null}

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

        <div className="student-profile-section-state-grid">
          {data.sectionStates.map((section) => {
            const tabTarget: ProfileSection =
              section.key === "verification"
                ? "overview"
                : section.key === "resume"
                  ? "details"
                  : section.key === "preferences"
                    ? "recommended"
                    : section.key === "academic"
                      ? "verified"
                      : "details";
            return (
              <button
                key={section.key}
                type="button"
                className={`student-profile-section-state ${section.status === "complete" ? "is-complete" : section.status === "needs_review" ? "is-review" : "is-missing"}`}
                onClick={() => setActiveSection(tabTarget)}
              >
                <span>{section.label}</span>
                <strong>{section.status === "complete" ? "Complete" : section.status === "needs_review" ? "Needs review" : "Missing required"}</strong>
                <small>{section.summary}</small>
              </button>
            );
          })}
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
                <h2>Placement & resume</h2>
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
                  {data.declarationStatus.profileCertification.isLocked ? " • Locked for edits" : ""}
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
