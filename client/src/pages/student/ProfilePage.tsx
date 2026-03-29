import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { Button, Card, Modal, Skeleton, Tabs } from "../../components/ui";
import { isClientFeatureEnabled } from "../../config/features";
import { useTenantSettings } from "../../hooks/use-tenant";
import {
  certifyStudentProfile,
  getProfileCertificationPreview,
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
  targetRoles: string;
  preferredLocations: string;
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

function joinCsv(values: string[]) {
  return values.join(", ");
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

type ProfileSection = "checklist" | "verified" | "details" | "recommended";

const baseProfileSectionTabs: Array<{ id: ProfileSection; label: string }> = [
  { id: "checklist", label: "Checklist" },
  { id: "verified", label: "Academic Details" },
  { id: "details", label: "Placement Details" },
  { id: "recommended", label: "Recommended" },
];
const semesterOptions = ["1", "2", "3", "4", "5", "6", "7", "8"];

export default function ProfilePage() {
  const { data, error, isLoading, mutate } = useStudentProfile();
  const { data: tenantSettings } = useTenantSettings();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<ProfileSection>("verified");
  const [isCertificationOpen, setIsCertificationOpen] = useState(false);
  const [certificationTypedValue, setCertificationTypedValue] = useState("");
  const [certificationStatus, setCertificationStatus] = useState<string | null>(null);
  const [certificationBusy, setCertificationBusy] = useState(false);
  const [isTpoVisibilityOpen, setIsTpoVisibilityOpen] = useState(false);
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
    targetRoles: "",
    preferredLocations: "",
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
      targetRoles: joinCsv(data.studentEditableProfile.targetRoles ?? []),
      preferredLocations: joinCsv(data.studentEditableProfile.preferredLocations ?? []),
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
      setActiveSection("checklist");
    }
  }, [searchParams]);

  const blockedModule = searchParams.get("blocked");
  const missingRequiredLabels = useMemo(
    () => (data?.missingRequiredFields ?? []).map((field) => field.label),
    [data],
  );
  const requiredFieldKeys = useMemo(
    () => new Set((data?.requiredFields ?? []).map((field) => field.key)),
    [data],
  );
  const isComplete = (data?.profileCompleteness.pct ?? 0) >= 100;
  const isLocked = Boolean(data?.declarationStatus.profileCertification.isLocked);
  const tenantBranches = useMemo(() => {
    const rawBranches = Array.isArray(tenantSettings?.config?.branches) ? tenantSettings.config.branches : [];
    const currentBranch = data?.studentEditableProfile.branch ?? "";
    const values = [...rawBranches, currentBranch]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    return [...new Set(values)];
  }, [data?.studentEditableProfile.branch, tenantSettings?.config?.branches]);
  const currentSemesterNumber = Number(data?.studentEditableProfile.currentSemester || 0);
  const showRecommendedTab = isClientFeatureEnabled("studentProfileRecommended");
  const profileSectionTabs = useMemo(
    () => baseProfileSectionTabs.filter((tab) => tab.id !== "recommended" || showRecommendedTab),
    [showRecommendedTab],
  );
  const visibleTabs = isComplete ? profileSectionTabs.filter((tab) => tab.id !== "checklist") : profileSectionTabs;

  useEffect(() => {
    if (isComplete && activeSection === "checklist") {
      setActiveSection("verified");
    }
  }, [activeSection, isComplete]);

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
      setStatus("Your certified profile is locked. Contact placement support or admin to unlock it before editing.");
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
        targetRoles: splitCsv(form.targetRoles),
        preferredLocations: splitCsv(form.preferredLocations),
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

  return (
    <section className="student-workspace-shell profile-page">
      {!isComplete ? (
        <header className="student-workspace-header student-profile-header">
          <div>
            <p className="resources-kicker">Student Profile</p>
            <h1>Complete your placement profile before you start practicing.</h1>
            <p>
              Add your academic, contact, and placement details here yourself. Resources and mock tests unlock as soon as
              every required field is complete.
            </p>
          </div>
        </header>
      ) : null}

      {blockedModule ? (
        <section className="student-workspace-panel student-profile-alert">
          <h2>{blockedModule === "mock-tests" ? "Mock tests are locked" : "Resources are locked"}</h2>
          <p>
            Finish every required profile field to unlock this section. Missing now: {missingRequiredLabels.join(", ") || "None"}.
          </p>
        </section>
      ) : null}

      <section className="student-workspace-panel student-profile-switcher-panel">
        <Tabs
          tabs={visibleTabs}
          activeId={activeSection}
          onChange={(id) => setActiveSection(id as ProfileSection)}
        />
      </section>

      {isLocked ? (
        <section className="student-workspace-panel student-profile-alert">
          <h2>Profile locked after certification</h2>
          <p>Your certified profile is read-only now. Contact placement support or your admin if any detail needs correction.</p>
        </section>
      ) : null}

      {!isComplete && activeSection === "checklist" ? (
        <section className="student-workspace-panel">
          <div className="student-workspace-panel-head">
            <div>
              <h2>Unlock Checklist</h2>
              <p>These fields decide whether resources and mock tests are available.</p>
            </div>
          </div>
          <div className="student-profile-checklist-grid">
            <div>
              <h3>Still required</h3>
              {(data.missingRequiredFields ?? []).length > 0 ? (
                <ul className="dashboard-bullet-list">
                  {data.missingRequiredFields.map((field) => (
                    <li key={field.key}>{field.label}</li>
                  ))}
                </ul>
              ) : <p className="muted-text">All required fields are complete.</p>}
            </div>
          </div>
        </section>
      ) : null}

      {activeSection === "verified" ? (
        <form className="student-workspace-panel student-profile-form" onSubmit={onSubmit}>
          <div className="student-workspace-panel-head">
            <div>
              <h2>Your Academic Details</h2>
              <p>Keep these accurate yourself. They are used for eligibility checks, unlocks, and profile certification.</p>
            </div>
          </div>
          <div className="student-profile-readonly-grid">
            <div><span>Name</span><strong>{data.seededProfile.fullName || "Pending"}</strong></div>
            <div><span>College Email</span><strong>{data.seededProfile.collegeEmail || "Pending"}</strong></div>
          </div>
          <div className="form-grid">
            <label>
              PRN{requiredFieldKeys.has("prn") ? <span className="required-asterisk"> *</span> : null}
              <input disabled={isLocked} value={form.prn} onChange={(event) => setForm((current) => ({ ...current, prn: event.target.value }))} />
            </label>
            <label>
              Roll Number{requiredFieldKeys.has("rollNumber") ? <span className="required-asterisk"> *</span> : null}
              <input disabled={isLocked} value={form.rollNumber} onChange={(event) => setForm((current) => ({ ...current, rollNumber: event.target.value }))} />
            </label>
            <label>
              Branch{requiredFieldKeys.has("branch") ? <span className="required-asterisk"> *</span> : null}
              <select disabled={isLocked} value={form.branch} onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))}>
                <option value="">Select branch</option>
                {tenantBranches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
              </select>
            </label>
            <label>
              Batch{requiredFieldKeys.has("batch") ? <span className="required-asterisk"> *</span> : null}
              <input disabled={isLocked} value={form.batch} onChange={(event) => setForm((current) => ({ ...current, batch: event.target.value }))} placeholder="2026" />
            </label>
            <label>
              Degree{requiredFieldKeys.has("degree") ? <span className="required-asterisk"> *</span> : null}
              <input disabled={isLocked} value={form.degree} onChange={(event) => setForm((current) => ({ ...current, degree: event.target.value }))} />
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
            </label>
            <label>
              Active Backlogs{requiredFieldKeys.has("activeBacklogs") ? <span className="required-asterisk"> *</span> : null}
              <input disabled={isLocked} type="number" min="0" step="1" value={form.activeBacklogs} onChange={(event) => setForm((current) => ({ ...current, activeBacklogs: event.target.value }))} />
            </label>
            <label>
              Total Historical Backlogs{requiredFieldKeys.has("totalHistoricalBacklogs") ? <span className="required-asterisk"> *</span> : null}
              <input disabled={isLocked} type="number" min="0" step="1" value={form.totalHistoricalBacklogs} onChange={(event) => setForm((current) => ({ ...current, totalHistoricalBacklogs: event.target.value }))} />
            </label>
            <label>
              Attendance %{requiredFieldKeys.has("attendancePct") ? <span className="required-asterisk"> *</span> : null}
              <input disabled={isLocked} type="number" min="0" max="100" step="0.1" value={form.attendancePct} onChange={(event) => setForm((current) => ({ ...current, attendancePct: event.target.value }))} />
            </label>
          </div>
          <div className="hero-actions">
            <Button type="submit" disabled={saving || isLocked}>{saving ? "Saving..." : "Save Academic Details"}</Button>
            {status ? <p className={status.includes("successfully") ? "success-text" : "error-text"}>{status}</p> : null}
          </div>
        </form>
      ) : null}

      {activeSection === "details" ? (
        <form className="student-workspace-panel student-profile-form" onSubmit={onSubmit}>
          <div className="student-workspace-panel-head">
            <div>
              <h2>Your Placement Details</h2>
              <p>Fill these yourself. Required contact and placement fields unlock practice modules after save. Certification is a separate final review step.</p>
            </div>
          </div>

          <div className="student-profile-certification-panel">
            <div>
              <span className="resources-kicker">Declaration Status</span>
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
                    ? "Your profile is certified and locked. Contact admin support if any detail needs correction."
                    : "Your profile has been reviewed and certified for drive-use decisions."
                  : data.declarationStatus.profileCertification.requiresRecertification
                    ? "You changed important placement fields after certification. Review and certify again before applying to drives."
                    : data.profileCompleteness.isComplete
                      ? "Review your final placement details and certify them before drive applications."
                      : "Drive certification becomes available once every required field is complete."}
              </p>
              {data.declarationStatus.profileCertification.invalidatedAt ? (
                <p className="muted-text">{data.declarationStatus.profileCertification.invalidationReason ?? "Certification needs review."}</p>
              ) : null}
            </div>
            {!data.declarationStatus.profileCertification.isCertified ? (
              <div className="hero-actions">
                <Button type="button" disabled={!data.profileCompleteness.isComplete || certificationBusy || isLocked} onClick={openCertification}>
                  {certificationBusy ? "Loading..." : "Review and certify"}
                </Button>
              </div>
            ) : (
              <p className="success-text">
                Certified on {new Date(data.declarationStatus.profileCertification.acceptedAt ?? "").toLocaleString()}
                {data.declarationStatus.profileCertification.isLocked ? " • Locked for edits" : ""}
              </p>
            )}
          </div>

          <div className="form-grid">
            <label>
              Phone Number{requiredFieldKeys.has("phone") ? <span className="required-asterisk"> *</span> : null}
              <input disabled={isLocked} value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
            </label>
            <label>
              Personal Email{requiredFieldKeys.has("personalEmail") ? <span className="required-asterisk"> *</span> : null}
              <input disabled={isLocked} type="email" value={form.personalEmail} onChange={(event) => setForm((current) => ({ ...current, personalEmail: event.target.value }))} />
            </label>
            <div style={{ gridColumn: "1 / -1", display: "grid", gap: 12 }}>
              <label>
                Resume PDF{requiredFieldKeys.has("resumeUrl") ? <span className="required-asterisk"> *</span> : null}
                <input
                  disabled={isLocked}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(event) => setResumeFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <div className="hero-actions">
                <Button type="button" disabled={isLocked || resumeBusy || !resumeFile} onClick={handleResumeUpload}>
                  {resumeBusy ? "Uploading..." : "Upload Resume PDF"}
                </Button>
              </div>
              {data.studentEditableProfile.resumeDriveWebLink ? (
                <p className="muted-text">
                  Current resume:{" "}
                  <a href={data.studentEditableProfile.resumeDriveWebLink} target="_blank" rel="noreferrer">
                    {data.studentEditableProfile.resumeFilename || "View current resume"}
                  </a>
                  {data.studentEditableProfile.resumeUploadedAt
                    ? ` · uploaded ${new Date(data.studentEditableProfile.resumeUploadedAt).toLocaleString()}`
                    : ""}
                </p>
              ) : data.studentEditableProfile.resumeUrl ? (
                <p className="muted-text">
                  Legacy resume link on profile:{" "}
                  <a href={data.studentEditableProfile.resumeUrl} target="_blank" rel="noreferrer">
                    {data.studentEditableProfile.resumeUrl}
                  </a>
                </p>
              ) : (
                <p className="muted-text">No resume uploaded yet.</p>
              )}
              <label>
                Legacy Resume Link (optional during rollout)
                <input disabled={isLocked} value={form.resumeUrl} onChange={(event) => setForm((current) => ({ ...current, resumeUrl: event.target.value }))} placeholder="Optional backup link while managed uploads roll out" />
              </label>
            </div>
            <label>
              Target Roles{requiredFieldKeys.has("targetRoles") ? <span className="required-asterisk"> *</span> : null}
              <input disabled={isLocked} value={form.targetRoles} onChange={(event) => setForm((current) => ({ ...current, targetRoles: event.target.value }))} placeholder="Software engineer, analyst, GET" />
            </label>
            <label>
              Preferred Locations{requiredFieldKeys.has("preferredLocations") ? <span className="required-asterisk"> *</span> : null}
              <input disabled={isLocked} value={form.preferredLocations} onChange={(event) => setForm((current) => ({ ...current, preferredLocations: event.target.value }))} placeholder="Pune, Mumbai, Bengaluru" />
            </label>
            <label>
              Willing to Relocate{requiredFieldKeys.has("willingToRelocate") ? <span className="required-asterisk"> *</span> : null}
              <select disabled={isLocked} value={form.willingToRelocate} onChange={(event) => setForm((current) => ({ ...current, willingToRelocate: event.target.value as "yes" | "no" | "" }))}>
                <option value="">Select one</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label>
              Skills
              <input disabled={isLocked} value={form.skills} onChange={(event) => setForm((current) => ({ ...current, skills: event.target.value }))} placeholder="Communication, Aptitude, SQL" />
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
              Languages
              <input disabled={isLocked} value={form.languages} onChange={(event) => setForm((current) => ({ ...current, languages: event.target.value }))} placeholder="English, Hindi, Marathi" />
            </label>
          </div>

          <div className="form-grid">
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

          <div className="hero-actions">
            <Button type="submit" disabled={saving || isLocked}>{saving ? "Saving..." : "Save Profile"}</Button>
            {status ? <p className={status.includes("successfully") ? "success-text" : "error-text"}>{status}</p> : null}
          </div>
        </form>
      ) : null}

      {showRecommendedTab && activeSection === "recommended" ? (
        <section className="student-workspace-panel">
          <div className="student-workspace-panel-head">
            <div>
              <h2>Recommended for a stronger profile</h2>
              <p>These fields are optional for unlocks but help TPOs understand a student faster.</p>
            </div>
          </div>
          <div className="student-profile-recommended-grid">
            {data.recommendedFields.map((field) => (
              <div key={field.key}>
                <span>{field.label}</span>
                <strong>{field.complete ? "Added" : "Not added yet"}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="student-workspace-panel student-profile-visibility-panel">
        <button
          type="button"
          className="student-profile-visibility-toggle"
          onClick={() => setIsTpoVisibilityOpen((current) => !current)}
          aria-expanded={isTpoVisibilityOpen}
        >
          <div>
            <span className="resources-kicker">{data.tpoVisibilitySummary.title}</span>
            <h2>Understand which progress signals your placement office can review.</h2>
            <p>{data.tpoVisibilitySummary.description}</p>
          </div>
          <span className="student-profile-visibility-toggle-icon" aria-hidden="true">
            {isTpoVisibilityOpen ? "−" : "+"}
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
                <div><span>Target roles</span><strong>{certificationPreview.certificationPreview.targetRoles.join(", ")}</strong></div>
                <div><span>Preferred locations</span><strong>{certificationPreview.certificationPreview.preferredLocations.join(", ")}</strong></div>
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
    </section>
  );
}
