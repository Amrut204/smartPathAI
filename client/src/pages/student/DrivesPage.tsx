import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useSWRConfig } from "swr";

import { Badge, Button, Modal, Tabs } from "../../components/ui";
import { usePilotStudentDrives, type PilotStudentDrive } from "../../hooks/use-pilot-dashboard";
import { withdrawFromDrive } from "../../hooks/use-drives";
import { useOnlineStatus } from "../../hooks/use-online-status";
import { withCsrfHeader } from "../../utils/csrf";

type DriveView = "eligible" | "all" | "deadline";
type DriveContinuityState = {
  kind: "applied" | "withdrawn";
  driveId: string;
  company: string;
  role: string | null;
  prepBundle: PilotStudentDrive["prepBundle"];
};
type DrivePrepBundle = NonNullable<PilotStudentDrive["prepBundle"]>;

const driveTabs: Array<{ id: DriveView; label: string }> = [
  { id: "eligible", label: "Eligible" },
  { id: "all", label: "All" },
  { id: "deadline", label: "Deadline Soon" },
];

export default function DrivesPage() {
  const { data, error, isLoading } = usePilotStudentDrives();
  const { mutate } = useSWRConfig();
  const isOnline = useOnlineStatus();
  const [activeView, setActiveView] = useState<DriveView>("eligible");
  const [busyDriveId, setBusyDriveId] = useState<string | null>(null);
  const [withdrawingDriveId, setWithdrawingDriveId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"success" | "error">("success");
  const [continuityState, setContinuityState] = useState<DriveContinuityState | null>(null);
  const [previewDriveId, setPreviewDriveId] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<string | null>(null);
  const [animateDriveCards, setAnimateDriveCards] = useState(false);
  const [expandedDriveId, setExpandedDriveId] = useState<string | null>(null);
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
    if (activeView === "deadline") {
      const now = Date.now();
      return items.filter((drive) => {
        const driveTime = new Date(drive.driveDate).getTime();
        if (Number.isNaN(driveTime)) return false;
        const daysLeft = Math.ceil((driveTime - now) / (1000 * 60 * 60 * 24));
        return daysLeft >= 0 && daysLeft <= 7;
      });
    }
    return items;
  }, [activeView, data]);

  useEffect(() => {
    if (!isLoading && data && !animateDriveCards) {
      setAnimateDriveCards(true);
      const timeout = window.setTimeout(() => setAnimateDriveCards(false), 640);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [animateDriveCards, data, isLoading]);

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
    if (!isOnline) {
      showStatus("You are offline. Reconnect before opening the application preview.", "error");
      return;
    }
    setBusyDriveId(driveId);
    showStatus("", "success");
    setContinuityState(null);
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
      showStatus(
        !isOnline
          ? "Connection lost while loading the application preview. Reconnect and try again."
          : e instanceof Error
            ? e.message
            : "Unable to load drive declaration",
        "error",
      );
    } finally {
      setBusyDriveId(null);
    }
  };

  const applyToDrive = async () => {
    if (!previewDriveId) return;
    if (!isOnline) {
      setPreviewStatus("You are offline. Reconnect before applying. Your current drive details are still here.");
      showStatus("You are offline. Reconnect before applying to this drive.", "error");
      return;
    }
    setBusyDriveId(previewDriveId);
    setPreviewStatus(null);
    try {
      const driveContext = data.find((drive) => drive.id === previewDriveId) ?? null;
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
      setContinuityState({
        kind: "applied",
        driveId: previewDriveId,
        company: preview?.company ?? driveContext?.company ?? "the drive",
        role: driveContext?.role ?? null,
        prepBundle: driveContext?.prepBundle ?? null,
      });
      setPreview(null);
      setPreviewDriveId(null);
      setPreviewStatus(null);
      await mutate("/api/v1/students/me/drives");
      await mutate("/api/v1/students/me/pilot-dashboard");
      await mutate("/api/v1/students/me");
    } catch (e) {
      const message = !isOnline
        ? "Connection lost while applying. Reconnect and try again. No application was submitted yet."
        : e instanceof Error
          ? e.message
          : "Unable to apply";
      setPreviewStatus(message);
      showStatus(message, "error");
    } finally {
      setBusyDriveId(null);
    }
  };

  const onWithdraw = async (driveId: string, company: string) => {
    if (!isOnline) {
      showStatus("You are offline. Reconnect before withdrawing from this drive.", "error");
      return;
    }
    setWithdrawingDriveId(driveId);
    showStatus("", "success");
    try {
      const driveContext = data.find((drive) => drive.id === driveId) ?? null;
      await withdrawFromDrive(driveId);
      showStatus(`Withdrawn from ${company}. You can reapply until registration closes if you remain eligible.`);
      setContinuityState({
        kind: "withdrawn",
        driveId,
        company,
        role: driveContext?.role ?? null,
        prepBundle: driveContext?.prepBundle ?? null,
      });
      await mutate("/api/v1/students/me/drives");
      await mutate("/api/v1/students/me/pilot-dashboard");
    } catch (e) {
      showStatus(
        !isOnline
          ? "Connection lost while withdrawing. Reconnect and try again."
          : e instanceof Error
            ? e.message
            : "Unable to withdraw from drive",
        "error",
      );
    } finally {
      setWithdrawingDriveId(null);
    }
  };
  const driveStaggerStep = filteredDrives.length > 0 ? 300 / filteredDrives.length : 0;

  return (
    <section className="student-workspace-shell">
      <header className="student-workspace-header student-drives-header-v2">
        <div>
          <h1>Placement drives</h1>
          <p>Start with the drives you can act on now. If a drive is blocked, we show the reason and the shortest fix path.</p>
        </div>
        <div className="hero-actions">
          <Link to="/dashboard" className="ui-button ghost">Back to home</Link>
          <Link to="/profile" className="ui-button secondary">Review profile</Link>
        </div>
      </header>

      {!isOnline ? (
        <div className="student-profile-inline-alert is-warning">
          <strong>You are offline.</strong>
          <span>Drive applications and withdrawals need a live connection. Reconnect and then continue from this page.</span>
        </div>
      ) : null}

      {status ? <p className={statusTone === "success" ? "success-text" : "error-text"}>{status}</p> : null}

      {continuityState ? (
        <section className="student-continuity-banner">
          <div className="student-continuity-copy">
            <span className="resources-kicker">
              {continuityState.kind === "applied" ? "Application submitted" : "Application withdrawn"}
            </span>
            <h2>
              {continuityState.kind === "applied"
                ? `Keep preparing for ${continuityState.company}${continuityState.role ? ` - ${continuityState.role}` : ""}.`
                : `You stepped back from ${continuityState.company}${continuityState.role ? ` - ${continuityState.role}` : ""}.`}
            </h2>
            <p>
              {continuityState.kind === "applied"
                ? "Your application is in. The fastest way to use that momentum is to keep practicing the company pattern and revision material tied to this drive."
                : "You can still stay sharp while you decide whether to reapply. Use the linked prep bundle to keep your readiness moving."}
            </p>
          </div>
          {continuityState.prepBundle ? (
            <div className="student-continuity-grid">
                    <div>
                      <span>Mock tests</span>
                      {continuityState.prepBundle.mockTests.length > 0 ? (
                          <ul className="student-continuity-list">
                    {continuityState.prepBundle.mockTests.slice(0, 2).map((test: DrivePrepBundle["mockTests"][number]) => (
                      <li key={`${continuityState.driveId}_${test.id}`}>
                        <Link to={`/mock-tests/${test.id}`}>{test.title}</Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-text">No mock bundle yet.</p>
                )}
              </div>
                    <div>
                      <span>Resources</span>
                      {continuityState.prepBundle.resources.length > 0 ? (
                          <ul className="student-continuity-list">
                    {continuityState.prepBundle.resources.slice(0, 2).map((resource: DrivePrepBundle["resources"][number]) => (
                      <li key={`${continuityState.driveId}_${resource.id}`}>
                        <Link to={`/resources/view/${encodeURIComponent(resource.id)}`}>{resource.title}</Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-text">No resource bundle yet.</p>
                )}
              </div>
            </div>
          ) : null}
          <div className="hero-actions">
            <Link to="/dashboard" className="ui-button secondary">Open dashboard</Link>
            <Link to="/mock-tests" className="ui-button">
              {continuityState.kind === "applied" ? "Continue prep" : "Open mock tests"}
            </Link>
          </div>
        </section>
      ) : null}

      <div className="student-workspace-switcher">
        <Tabs tabs={driveTabs} activeId={activeView} onChange={(id) => setActiveView(id as DriveView)} />
      </div>

      <section className="student-workspace-panel student-drives-panel-v2">
        <div className="student-workspace-panel-head">
          <div>
            <h2>{activeView === "eligible" ? "Eligible drives" : activeView === "deadline" ? "Closing soon" : "All drives"}</h2>
            <p>
              {filteredDrives.length} drive(s) in this view. Keep the top of this list for action, and open details only when you need the full criteria.
            </p>
          </div>
        </div>

        {filteredDrives.length === 0 ? (
          <p className="muted-text">No drives in this view right now.</p>
        ) : (
          <div className="student-drive-card-list-v2">
            {filteredDrives.map((drive, index) => (
              <article
                key={drive.id}
                className={`student-workspace-drive student-drive-card-v2${animateDriveCards ? " motion-stagger-enter" : ""}`.trim()}
                style={animateDriveCards ? ({ "--motion-delay": `${Math.min(300, Math.round(index * driveStaggerStep))}ms` } as CSSProperties) : undefined}
              >
                <div className="student-workspace-row student-workspace-drive-head">
                  <div>
                    <strong>{drive.company}</strong>
                    <p>{drive.role ? `${drive.role} • ` : ""}{new Date(drive.driveDate).toLocaleDateString()}</p>
                  </div>
                  <div className="student-workspace-drive-badges">
                    <Badge variant={drive.isEligible ? "success" : "warning"}>
                      {drive.isEligible ? "Eligible" : "Blocked"}
                    </Badge>
                    <Badge variant={getApplicationBadge(drive.applicationState).variant}>
                      {getApplicationBadge(drive.applicationState).label}
                    </Badge>
                  </div>
                </div>

                <div className="student-drive-card-summary">
                  <div className="student-drive-card-summary-item">
                    <span>Deadline</span>
                    <strong>{new Date(drive.driveDate).toLocaleDateString()}</strong>
                  </div>
                  <div className="student-drive-card-summary-item">
                    <span>Profile status</span>
                    <strong>{drive.readinessSupport?.profileCertified ? "Certified" : "Needs certification"}</strong>
                  </div>
                  <div className="student-drive-card-summary-item">
                    <span>Resume</span>
                    <strong>{drive.readinessSupport?.hasResume ? "Ready" : "Missing"}</strong>
                  </div>
                  <div className="student-drive-card-summary-item">
                    <span>Result</span>
                    <strong>{humanizeOutcome(drive.myOutcome)}</strong>
                  </div>
                </div>

                {!drive.canApplyNow && drive.actionHint ? (
                  <div className="student-drive-guidance-card">
                    <div>
                      <strong>{drive.actionHint.label}</strong>
                      <p>{drive.actionHint.explanation}</p>
                    </div>
                    <Link to={drive.actionHint.targetPath} className="ui-button ghost">
                      {drive.actionHint.ctaLabel}
                    </Link>
                  </div>
                ) : null}

                {drive.applicationState === "applied" ? (
                  <p className="success-text">Application submitted. Your current resume snapshot is already attached to this drive.</p>
                ) : null}

                <div className="hero-actions student-workspace-drive-actions student-drive-primary-actions">
                  {drive.canApplyNow && drive.applicationState !== "applied" ? (
                    <Button
                      disabled={busyDriveId === drive.id}
                      onClick={() => void openPreview(drive.id)}
                    >
                      {busyDriveId === drive.id ? "Loading..." : "Apply now"}
                    </Button>
                  ) : null}
                  {drive.canWithdraw ? (
                    <Button
                      variant="secondary"
                      disabled={withdrawingDriveId === drive.id}
                      onClick={() => void onWithdraw(drive.id, drive.company)}
                    >
                      {withdrawingDriveId === drive.id ? "Withdrawing..." : "Withdraw"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setExpandedDriveId((current) => current === drive.id ? null : drive.id)}
                  >
                    {expandedDriveId === drive.id ? "Hide details" : drive.isEligible ? "View details" : "Why blocked?"}
                  </Button>
                </div>

                {expandedDriveId === drive.id ? (
                  <div className="student-drive-expanded-panel">
                    <div className="student-workspace-drive-details">
                      <p className="student-workspace-meta">
                        Criteria: CGPA {drive.criteria.minCgpa || 0}+ • Active backlogs up to {(drive.criteria.maxActiveBacklogs ?? drive.criteria.maxBacklogs) || 0} • Attendance {drive.criteria.minAttendance || 0}%+
                      </p>
                      <p className="student-workspace-meta">
                        Allowed branches: {drive.criteria.branches.length > 0 ? drive.criteria.branches.join(", ") : "All branches"} • Application state: {humanizeApplicationState(drive.timeline?.applicationState ?? drive.applicationState)}
                      </p>
                    </div>

                    {drive.reasons.length > 0 ? (
                      <ul className="student-workspace-reason-list">
                        {drive.reasons.map((reason) => (
                          <li key={`${drive.id}-${reason.code}`}>{reason.label}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted-text">You meet the current criteria for this drive.</p>
                    )}

                    {drive.eligibility?.advisoryNotes && drive.eligibility.advisoryNotes.length > 0 ? (
                      <p className="muted-text">{drive.eligibility.advisoryNotes.join(" ")}</p>
                    ) : null}

                    {drive.prepBundle ? (
                      <div className="student-drive-prep-panel">
                        <div className="student-drive-prep-head">
                          <strong>Prepare for this drive</strong>
                          <p>{drive.prepBundle.summary}</p>
                        </div>
                        <div className="student-drive-prep-grid">
                          <div>
                            <span>Mock tests</span>
                            {drive.prepBundle.mockTests.length > 0 ? (
                              <ul>
                                {drive.prepBundle.mockTests.slice(0, 2).map((test) => (
                                  <li key={`${drive.id}-mock-${test.id}`}>
                                    <Link to={`/mock-tests/${test.id}`}>{test.title}</Link>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="muted-text">No mock bundle yet.</p>
                            )}
                          </div>
                          <div>
                            <span>Resources</span>
                            {drive.prepBundle.resources.length > 0 ? (
                              <ul>
                                {drive.prepBundle.resources.slice(0, 2).map((resource) => (
                                  <li key={`${drive.id}-resource-${resource.id}`}>
                                    <Link to={`/resources/view/${encodeURIComponent(resource.id)}`}>{resource.title}</Link>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="muted-text">No resource bundle yet.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}
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
