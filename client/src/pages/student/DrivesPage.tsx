import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";

import { Badge, Button, Modal, Tabs } from "../../components/ui";
import { usePilotStudentDrives } from "../../hooks/use-pilot-dashboard";
import { withdrawFromDrive } from "../../hooks/use-drives";
import { withCsrfHeader } from "../../utils/csrf";

type DriveView = "eligible" | "all" | "attention";

const driveTabs: Array<{ id: DriveView; label: string }> = [
  { id: "eligible", label: "Eligible" },
  { id: "all", label: "All Drives" },
  { id: "attention", label: "Needs Attention" },
];

export default function DrivesPage() {
  const { data, error, isLoading } = usePilotStudentDrives();
  const { mutate } = useSWRConfig();
  const [activeView, setActiveView] = useState<DriveView>("eligible");
  const [busyDriveId, setBusyDriveId] = useState<string | null>(null);
  const [withdrawingDriveId, setWithdrawingDriveId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"success" | "error">("success");
  const [previewDriveId, setPreviewDriveId] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<string | null>(null);
  const [preview, setPreview] = useState<null | {
    driveId: string;
    company: string;
    role: string | null;
    eligible: boolean;
    reasons: Array<{ code: string; label: string }>;
    criteria: {
      minCgpa: number | null;
      maxActiveBacklogs: number | null;
      maxTotalBacklogs: number | null;
      minAttendance: number | null;
      branches: string[];
      excludePlacedStudents: boolean;
    };
    studentValues: {
      cgpa: number;
      activeBacklogs: number;
      totalHistoricalBacklogs: number;
      attendancePct: number;
      branch: string;
    };
    declarationStatus: {
      profileCertification: {
        isCertified: boolean;
      };
    };
    warning: string;
  }>(null);

  const filteredDrives = useMemo(() => {
    const items = data ?? [];
    if (activeView === "eligible") return items.filter((drive) => drive.isEligible);
    if (activeView === "attention") return items.filter((drive) => !drive.isEligible || drive.reasons.length > 0);
    return items;
  }, [activeView, data]);

  if (isLoading) {
    return <section className="student-workspace-shell"><div className="student-workspace-panel">Loading drives...</div></section>;
  }

  if (error || !data) {
    return <section className="student-workspace-shell"><div className="student-workspace-panel">Unable to load drives.</div></section>;
  }

  const humanizeApplicationState = (value: string | undefined) => {
    if (!value) return "-";
    if (value === "not_applied") return "not applied";
    return value.replace(/_/g, " ");
  };

  const humanizeOutcome = (value: string | undefined) => {
    if (!value) return "-";
    if (value === "pending") return "pending review";
    return value.replace(/_/g, " ");
  };

  const getApplicationBadge = (value: string | undefined) => {
    if (value === "applied") return { label: "Applied", variant: "success" as const };
    if (value === "withdrawn") return { label: "Withdrawn", variant: "warning" as const };
    if (value === "absent") return { label: "Absent", variant: "danger" as const };
    return { label: "Not applied", variant: "default" as const };
  };

  const showStatus = (message: string, tone: "success" | "error" = "success") => {
    setStatus(message);
    setStatusTone(tone);
  };

  const openPreview = async (driveId: string) => {
    setBusyDriveId(driveId);
    showStatus("", "success");
    setPreviewStatus(null);
    try {
      const response = await fetch(`/api/v1/students/me/drives/${driveId}/declaration-preview`, {
        credentials: "include",
      });
      const payload = await response.json() as {
        success: boolean;
        data?: typeof preview;
        error?: { message: string };
      };
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error?.message ?? "Unable to load drive declaration");
      }
      setPreview(payload.data);
      setPreviewDriveId(driveId);
    } catch (e) {
      showStatus(e instanceof Error ? e.message : "Unable to load drive declaration", "error");
    } finally {
      setBusyDriveId(null);
    }
  };

  const applyToDrive = async () => {
    if (!previewDriveId) return;
    setBusyDriveId(previewDriveId);
    setPreviewStatus(null);
    try {
      const response = await fetch(`/api/v1/students/me/drives/${previewDriveId}/apply`, {
        method: "POST",
        credentials: "include",
        headers: withCsrfHeader({ "Content-Type": "application/json" }),
        body: JSON.stringify({ confirmDeclaration: true }),
      });
      const payload = await response.json() as { success: boolean; error?: { message: string } };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message ?? "Unable to apply");
      }
      showStatus(`Applied to ${preview?.company ?? "the drive"}.`);
      setPreview(null);
      setPreviewDriveId(null);
      setPreviewStatus(null);
      await mutate("/api/v1/students/me/drives");
      await mutate("/api/v1/students/me/pilot-dashboard");
      await mutate("/api/v1/students/me");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to apply";
      setPreviewStatus(message);
      showStatus(message, "error");
    } finally {
      setBusyDriveId(null);
    }
  };

  const onWithdraw = async (driveId: string, company: string) => {
    setWithdrawingDriveId(driveId);
    showStatus("", "success");
    try {
      await withdrawFromDrive(driveId);
      showStatus(`Withdrawn from ${company}. You can reapply until registration closes if you remain eligible.`);
      await mutate("/api/v1/students/me/drives");
      await mutate("/api/v1/students/me/pilot-dashboard");
    } catch (e) {
      showStatus(e instanceof Error ? e.message : "Unable to withdraw from drive", "error");
    } finally {
      setWithdrawingDriveId(null);
    }
  };

  return (
    <section className="student-workspace-shell">
      <header className="student-workspace-header">
        <div>
          <h1>Placement drives</h1>
          <p>Check the drives you already qualify for, and then fix what is blocking the others.</p>
        </div>
      </header>

      {status ? <p className={statusTone === "success" ? "success-text" : "error-text"}>{status}</p> : null}

      <div className="student-workspace-switcher">
        <Tabs tabs={driveTabs} activeId={activeView} onChange={(id) => setActiveView(id as DriveView)} />
      </div>

      <section className="student-workspace-panel">
        <div className="student-workspace-panel-head">
          <div>
            <h2>{activeView === "eligible" ? "Eligible drives" : activeView === "attention" ? "Drives that need fixes" : "All drives"}</h2>
            <p>{filteredDrives.length} drive(s) in this view.</p>
          </div>
        </div>

        {filteredDrives.length === 0 ? (
          <p className="muted-text">No drives in this view right now.</p>
        ) : (
          <div className="student-workspace-list">
            {filteredDrives.map((drive) => (
              <article key={drive.id} className="student-workspace-drive">
                <div className="student-workspace-row student-workspace-drive-head">
                  <div>
                    <strong>{drive.company}{drive.role ? ` - ${drive.role}` : ""}</strong>
                    <p>{new Date(drive.driveDate).toLocaleDateString()} - {drive.lifecycle ?? drive.status}</p>
                  </div>
                  <div className="student-workspace-drive-badges">
                    <Badge variant={drive.isEligible ? "success" : "warning"}>
                      {drive.isEligible ? "Eligible" : "Not eligible"}
                    </Badge>
                    <Badge variant={getApplicationBadge(drive.applicationState).variant}>
                      {getApplicationBadge(drive.applicationState).label}
                    </Badge>
                  </div>
                </div>

                <div className="student-workspace-drive-details">
                  <p className="student-workspace-meta">
                    Criteria: CGPA {drive.criteria.minCgpa || 0}+ - Active backlogs up to {(drive.criteria.maxActiveBacklogs ?? drive.criteria.maxBacklogs) || 0} - Attendance {drive.criteria.minAttendance || 0}%+
                  </p>
                  <p className="student-workspace-meta">
                    Allowed branches: {drive.criteria.branches.length > 0 ? drive.criteria.branches.join(", ") : "All branches"} - Your result: {humanizeOutcome(drive.myOutcome)}
                  </p>
                </div>

                {drive.reasons.length > 0 ? (
                  <ul className="student-workspace-reason-list">
                    {drive.reasons.map((reason) => (
                      <li key={`${drive.id}-${reason.code}`}>{reason.label}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-text">You meet the current criteria.</p>
                )}

                {drive.eligibility?.advisoryNotes && drive.eligibility.advisoryNotes.length > 0 ? (
                  <p className="muted-text">{drive.eligibility.advisoryNotes.join(" ")}</p>
                ) : null}

                {drive.timeline ? (
                  <p className="student-workspace-meta">
                    Registration: {drive.timeline.registrationStatus} - Application: {humanizeApplicationState(drive.timeline.applicationState)} - Profile certified: {drive.timeline.profileCertified ? "Yes" : "No"}
                  </p>
                ) : null}

                {drive.applicationState === "applied" ? (
                  <p className="success-text">Application submitted. Your resume snapshot is attached to this drive.</p>
                ) : null}

                {drive.isEligible && drive.applicationState !== "applied" ? (
                  <div className="hero-actions student-workspace-drive-actions">
                    <Button
                      disabled={busyDriveId === drive.id}
                      onClick={() => void openPreview(drive.id)}
                    >
                      {busyDriveId === drive.id ? "Loading..." : "Apply to drive"}
                    </Button>
                  </div>
                ) : null}

                {drive.canWithdraw ? (
                  <div className="hero-actions student-workspace-drive-actions">
                    <Button
                      variant="secondary"
                      disabled={withdrawingDriveId === drive.id}
                      onClick={() => void onWithdraw(drive.id, drive.company)}
                    >
                      {withdrawingDriveId === drive.id ? "Withdrawing..." : "Withdraw application"}
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <Modal open={Boolean(preview)} onClose={() => { setPreview(null); setPreviewDriveId(null); setPreviewStatus(null); }} title="Confirm drive declaration">
        {preview ? (
          <div className="student-drive-declaration-modal">
            <p>
              You are about to apply to <strong>{preview.company}{preview.role ? ` - ${preview.role}` : ""}</strong>.
            </p>
            <p>{preview.warning}</p>
            <div className="student-profile-certification-grid">
              <div><span>Your CGPA</span><strong>{preview.studentValues.cgpa}</strong></div>
              <div><span>Required CGPA</span><strong>{preview.criteria.minCgpa ?? "Not set"}</strong></div>
              <div><span>Your active backlogs</span><strong>{preview.studentValues.activeBacklogs}</strong></div>
              <div><span>Max active backlogs</span><strong>{preview.criteria.maxActiveBacklogs ?? "Not set"}</strong></div>
              <div><span>Your attendance</span><strong>{preview.studentValues.attendancePct}%</strong></div>
              <div><span>Minimum attendance</span><strong>{preview.criteria.minAttendance ?? "Not set"}%</strong></div>
              <div><span>Your branch</span><strong>{preview.studentValues.branch}</strong></div>
              <div><span>Allowed branches</span><strong>{preview.criteria.branches.length > 0 ? preview.criteria.branches.join(", ") : "All branches"}</strong></div>
            </div>
            {!preview.declarationStatus.profileCertification.isCertified ? (
              <p className="error-text">Certify your profile first. You can do that from the Profile page.</p>
            ) : null}
            {previewStatus ? <p className="error-text">{previewStatus}</p> : null}
            <div className="hero-actions">
              <Button
                type="button"
                disabled={busyDriveId === preview.driveId || !preview.declarationStatus.profileCertification.isCertified}
                onClick={() => void applyToDrive()}
              >
                {busyDriveId === preview.driveId ? "Applying..." : "Confirm and apply"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setPreview(null); setPreviewDriveId(null); setPreviewStatus(null); }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
