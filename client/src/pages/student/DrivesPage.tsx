import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";

import { Badge, Button, Modal, Tabs } from "../../components/ui";
import { usePilotStudentDrives } from "../../hooks/use-pilot-dashboard";
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
  const [status, setStatus] = useState<string | null>(null);
  const [previewDriveId, setPreviewDriveId] = useState<string | null>(null);
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

  const openPreview = async (driveId: string) => {
    setBusyDriveId(driveId);
    setStatus(null);
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
      setStatus(e instanceof Error ? e.message : "Unable to load drive declaration");
    } finally {
      setBusyDriveId(null);
    }
  };

  const applyToDrive = async () => {
    if (!previewDriveId) return;
    setBusyDriveId(previewDriveId);
    setStatus(null);
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
      setStatus(`Applied to ${preview?.company ?? "the drive"}.`);
      setPreview(null);
      setPreviewDriveId(null);
      await mutate("/api/v1/students/me/drives");
      await mutate("/api/v1/students/me/pilot-dashboard");
      await mutate("/api/v1/students/me");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Unable to apply");
    } finally {
      setBusyDriveId(null);
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

      {status ? <p className="muted-text">{status}</p> : null}

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
                <div className="student-workspace-row">
                  <div>
                    <strong>{drive.company}{drive.role ? ` - ${drive.role}` : ""}</strong>
                    <p>{new Date(drive.driveDate).toLocaleDateString()} - {drive.status}</p>
                  </div>
                  <Badge variant={drive.isEligible ? "success" : "warning"}>
                    {drive.isEligible ? "Eligible" : "Not eligible"}
                  </Badge>
                </div>

                <p className="student-workspace-meta">
                  Criteria: CGPA {drive.criteria.minCgpa || 0}+ - Active backlogs up to {(drive.criteria.maxActiveBacklogs ?? drive.criteria.maxBacklogs) || 0} - Attendance {drive.criteria.minAttendance || 0}%+
                </p>
                <p className="student-workspace-meta">
                  Allowed branches: {drive.criteria.branches.length > 0 ? drive.criteria.branches.join(", ") : "All branches"} - Your result: {drive.myOutcome}
                </p>

                {drive.reasons.length > 0 ? (
                  <ul className="student-workspace-reason-list">
                    {drive.reasons.map((reason) => (
                      <li key={`${drive.id}-${reason.code}`}>{reason.label}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-text">You meet the current criteria.</p>
                )}

                {drive.isEligible && drive.myStatus !== "applied" ? (
                  <div className="hero-actions">
                    <Button
                      disabled={busyDriveId === drive.id}
                      onClick={() => void openPreview(drive.id)}
                    >
                      {busyDriveId === drive.id ? "Loading..." : "Mark as Applied"}
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <Modal open={Boolean(preview)} onClose={() => { setPreview(null); setPreviewDriveId(null); }} title="Confirm drive declaration">
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
            <div className="hero-actions">
              <Button
                type="button"
                disabled={busyDriveId === preview.driveId || !preview.declarationStatus.profileCertification.isCertified}
                onClick={() => void applyToDrive()}
              >
                {busyDriveId === preview.driveId ? "Applying..." : "Confirm and apply"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setPreview(null); setPreviewDriveId(null); }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
