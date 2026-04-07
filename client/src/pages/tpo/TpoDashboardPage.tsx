import { useEffect, useMemo, useState } from "react";
import { mutate } from "swr";
import { Link } from "react-router-dom";

import { Badge, Button, Card, ConfirmActionModal, Skeleton, Table } from "../../components/ui";
import { AnimatedNumber } from "../../components/motion/AnimatedNumber";
import { useTpoControlCenter } from "../../hooks/use-analytics";
import { computeDriveEligibility } from "../../hooks/use-drives";
import { approveSupportRequest, denySupportRequest, resolveStudentSupportRequest } from "../../hooks/use-support";
import { reviewStudentUnlockRequest } from "../../hooks/use-tpo-students";
import { tpoWhatsNewEntries } from "../../config/tpo-whats-new";
import { useAuth } from "../../components/providers/AuthProvider";

function formatDate(value: string | null | undefined) {
  if (!value) return "Not scheduled";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function badgeVariantFromPriority(priority: string) {
  if (priority === "high") return "danger" as const;
  if (priority === "medium") return "warning" as const;
  return "default" as const;
}

function badgeVariantFromRisk(score: number) {
  if (score >= 60) return "danger" as const;
  if (score >= 35) return "warning" as const;
  return "success" as const;
}

function TpoDashboardSkeleton() {
  return (
    <section className="tpo-dashboard control-center-page">
      <Card className="career-hero-card control-center-hero-card">
        <div style={{ display: "grid", gap: 12 }}>
          <Skeleton size="lg" />
          <Skeleton size="md" />
        </div>
        <div className="control-center-pill-grid" style={{ marginTop: 20 }}>
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={`tpo-dashboard-skeleton-pill-${index}`} className="control-center-pill">
              <Skeleton size="sm" />
              <Skeleton size="md" />
            </div>
          ))}
        </div>
      </Card>
      <div className="tpo-ops-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={`tpo-dashboard-section-${index}`} className="tpo-list-card">
            <div style={{ display: "grid", gap: 12 }}>
              <Skeleton size="md" />
              <Skeleton size="sm" />
              <Skeleton size="sm" />
              <Skeleton size="sm" />
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

export default function TpoDashboardPage() {
  const { data, isLoading, error } = useTpoControlCenter();
  const { profile } = useAuth();
  const [pendingExport, setPendingExport] = useState<null | {
    title: string;
    href: string;
    details: string[];
  }>(null);
  const onboardingStorageKey = useMemo(
    () => profile ? `tpo-dashboard-onboarding-dismissed:${profile.tenant_id}:${profile.id}` : null,
    [profile],
  );
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  useEffect(() => {
    if (!onboardingStorageKey) return;
    setOnboardingDismissed(localStorage.getItem(onboardingStorageKey) === "true");
  }, [onboardingStorageKey]);

  const confirmExport = () => {
    if (!pendingExport) return;
    window.location.assign(pendingExport.href);
    setPendingExport(null);
  };

  if (isLoading) return <TpoDashboardSkeleton />;
  if (error || !data) return <Card>Unable to load the TPO operations dashboard.</Card>;

  const isFullyEmptyTenant = data.summary.totalStudents === 0 && data.summary.totalDrives === 0;
  const checklistSteps = [
    { id: "students", label: "Import students", href: "/tpo/students/upload", complete: data.summary.totalStudents > 0 },
    { id: "drives", label: "Create your first drive", href: "/tpo/drives/create", complete: data.summary.totalDrives > 0 },
    { id: "announcements", label: "Send an announcement", href: "/tpo/communication", complete: data.summary.outreachStartedCount > 0 },
    { id: "ready", label: "You are ready", href: null, complete: data.summary.totalStudents > 0 && data.summary.totalDrives > 0 && data.summary.outreachStartedCount > 0 },
  ];
  const checklistComplete = checklistSteps.every((step) => step.complete);

  const queueSummary = [
    {
      label: "Unlock Requests",
      value: data.dashboardQueues.profileUnlockRequests.count,
      helper: "Students waiting for profile correction approval.",
    },
    {
      label: "Student Support",
      value: data.dashboardQueues.studentSupportRequests.count,
      helper: "Open help requests from students.",
    },
    {
      label: "Support Access",
      value: data.dashboardQueues.supportAccessRequests.count,
      helper: "Pending admin support access approvals.",
    },
    {
      label: "Communication Tasks",
      value: data.dashboardQueues.communicationTasks.count,
      helper: "Drive follow-up items that need outreach or release action.",
    },
  ];

  const needsAttentionItems = [
    ...data.dashboardQueues.profileUnlockRequests.items.slice(0, 3),
    ...data.dashboardQueues.studentSupportRequests.items.slice(0, 3),
    ...data.dashboardQueues.communicationTasks.items.slice(0, 3),
  ]
    .sort((a, b) => {
      const priorityWeight = (value: string) => (value === "high" ? 2 : value === "medium" ? 1 : 0);
      return priorityWeight(b.priority) - priorityWeight(a.priority);
    })
    .slice(0, 8);

  const followUpStudents = [
    ...data.actionCenter.studentsToContactToday,
    ...data.actionCenter.readyButInactive,
    ...data.actionCenter.lowReadinessNearDriveImpact,
  ]
    .filter((student, index, list) => list.findIndex((candidate) => candidate.studentId === student.studentId) === index)
    .slice(0, 12);
  const pilotProofItems = [
    {
      label: "Activated in 7d",
      value: `${data.pilotProof.metrics.activatedStudents7d.pct}%`,
      countLabel: `${data.pilotProof.metrics.activatedStudents7d.count} students`,
      helper: data.pilotProof.metrics.activatedStudents7d.helper,
    },
    {
      label: "Profiles complete",
      value: `${data.pilotProof.metrics.profileComplete.pct}%`,
      countLabel: `${data.pilotProof.metrics.profileComplete.count} students`,
      helper: data.pilotProof.metrics.profileComplete.helper,
    },
    {
      label: "Resume ready",
      value: `${data.pilotProof.metrics.resumeReady.pct}%`,
      countLabel: `${data.pilotProof.metrics.resumeReady.count} students`,
      helper: data.pilotProof.metrics.resumeReady.helper,
    },
    {
      label: "Eligible for drives",
      value: `${data.pilotProof.metrics.eligibleForUpcoming.pct}%`,
      countLabel: `${data.pilotProof.metrics.eligibleForUpcoming.count} students`,
      helper: data.pilotProof.metrics.eligibleForUpcoming.helper,
    },
    {
      label: "Eligible not applied",
      value: `${data.pilotProof.metrics.eligibleButNotApplied.pct}%`,
      countLabel: `${data.pilotProof.metrics.eligibleButNotApplied.count} students`,
      helper: data.pilotProof.metrics.eligibleButNotApplied.helper,
    },
    {
      label: "Mock adoption",
      value: `${data.pilotProof.metrics.mockAdoption.pct}%`,
      countLabel: `${data.pilotProof.metrics.mockAdoption.count} students`,
      helper: data.pilotProof.metrics.mockAdoption.helper,
    },
    {
      label: "Announcement read rate",
      value: `${data.pilotProof.metrics.announcementReadRate.pct}%`,
      countLabel: `${data.pilotProof.metrics.announcementReadRate.readCount}/${data.pilotProof.metrics.announcementReadRate.recipientCount || 0} reads`,
      helper: data.pilotProof.metrics.announcementReadRate.helper,
    },
  ];
  const milestoneChecklist = [
    { label: "Imported students", complete: data.pilotProof.milestoneChecklist.importedStudents },
    { label: "Created first drive", complete: data.pilotProof.milestoneChecklist.createdFirstDrive },
    { label: "Sent first announcement", complete: data.pilotProof.milestoneChecklist.sentFirstAnnouncement },
    { label: "Released first result", complete: data.pilotProof.milestoneChecklist.releasedFirstResult },
  ];

  if (isFullyEmptyTenant && !onboardingDismissed) {
    return (
      <section className="tpo-dashboard control-center-page">
        <Card className="career-hero-card control-center-hero-card">
          <div className="workspace-panel-header">
            <div>
              <p className="workspace-eyebrow">First Run Setup</p>
              <h1>Let&apos;s get this placement workspace ready.</h1>
              <p className="muted-text">
                A brand new TPO account should not feel broken or empty. We guide the first operational steps here, then hand over to
                the full dashboard once your college data starts flowing.
              </p>
            </div>
            <Link to="/tpo/whats-new">
              <Button variant="secondary">What&apos;s New</Button>
            </Link>
          </div>
          <div className="tpo-action-list">
            {checklistSteps.map((step, index) => (
              <div key={step.id} className="tpo-action-row">
                <div>
                  <div className="tpo-action-row-head">
                    <strong>{index + 1}. {step.label}</strong>
                    <Badge variant={step.complete ? "success" : "warning"}>
                      {step.complete ? "Done" : "Pending"}
                    </Badge>
                  </div>
                  <p className="muted-text">
                    {step.id === "students" ? "Upload your student roster so readiness, eligibility, and profile tracking can start." : null}
                    {step.id === "drives" ? "Create your first drive to unlock eligibility computation, applications, and result workflows." : null}
                    {step.id === "announcements" ? "Send one announcement so students know the portal is live and ready to use." : null}
                    {step.id === "ready" ? "Once the first three steps are complete, the full dashboard becomes your daily operations console." : null}
                  </p>
                </div>
                {step.href ? (
                  <Link to={step.href}>
                    <Button variant={step.complete ? "secondary" : "primary"}>
                      {step.complete ? "Review" : "Open"}
                    </Button>
                  </Link>
                ) : (
                  <Button variant="secondary" disabled>
                    Ready state
                  </Button>
                )}
              </div>
            ))}
          </div>
          {checklistComplete ? (
            <div className="hero-actions">
              <Button
                onClick={() => {
                  if (onboardingStorageKey) {
                    localStorage.setItem(onboardingStorageKey, "true");
                  }
                  setOnboardingDismissed(true);
                }}
              >
                Dismiss checklist
              </Button>
            </div>
          ) : null}
        </Card>
      </section>
    );
  }

  return (
    <section className="tpo-dashboard control-center-page">
      <Card className="career-hero-card control-center-hero-card">
        <div className="tpo-ops-hero">
          <div className="tpo-ops-hero-copy">
            <p className="workspace-eyebrow">TPO Operations Console</p>
            <h1>Run placement operations from one dashboard.</h1>
            <p className="muted-text">
              We are surfacing the queues, drive risk, and student readiness states that need intervention today so you can act without
              hopping across half the product first.
            </p>
          </div>
          <div className="hero-actions">
            <Link to="/tpo/drives/create">
              <Button>Create Drive</Button>
            </Link>
            <Link to="/tpo/communication">
              <Button variant="secondary">Open Communication</Button>
            </Link>
            <Link to="/tpo/reports">
              <Button variant="secondary">Open Reports</Button>
            </Link>
            <Link to="/tpo/whats-new">
              <Button variant="secondary">What&apos;s New</Button>
            </Link>
          </div>
        </div>
        <div className="tpo-ops-signal-strip">
          <Link className="tpo-ops-signal" to="/tpo/interventions/eligible-not-applied">
            <span>Eligible not applied</span>
            <strong><AnimatedNumber value={data.actionCenter.eligibleButNotApplied.length} /></strong>
          </Link>
          <Link className="tpo-ops-signal" to="/tpo/interventions/needs-mock-push">
            <span>Needs mock push</span>
            <strong><AnimatedNumber value={data.actionCenter.lowReadinessNearDriveImpact.length} /></strong>
          </Link>
          <Link className="tpo-ops-signal" to="/tpo/students">
            <span>Unlock requests</span>
            <strong><AnimatedNumber value={data.dashboardQueues.profileUnlockRequests.count} /></strong>
          </Link>
          <Link className="tpo-ops-signal" to="/tpo/drives">
            <span>Low-apply drives</span>
            <strong><AnimatedNumber value={data.drivePreparedness.items.filter((drive) => drive.lowApplyRisk).length} /></strong>
          </Link>
          <Link className="tpo-ops-signal" to="/tpo/communication">
            <span>Communication tasks</span>
            <strong><AnimatedNumber value={data.dashboardQueues.communicationTasks.count} /></strong>
          </Link>
        </div>
        <div className="control-center-pill-grid">
          <div className="control-center-pill">
            <span>Total Students</span>
            <strong><AnimatedNumber value={data.summary.totalStudents} /></strong>
            {data.summary.totalStudents === 0 ? <p className="muted-text">Import your student list to start using the operations dashboard.</p> : null}
          </div>
          <div className="control-center-pill">
            <span>Active 7d</span>
            <strong><AnimatedNumber value={data.summary.activeStudents7d} /></strong>
          </div>
          <div className="control-center-pill">
            <span>Upcoming Drives</span>
            <strong><AnimatedNumber value={data.summary.upcomingDrives} /></strong>
            {data.summary.totalDrives === 0 ? <p className="muted-text">Create your first drive to activate eligibility and applications.</p> : null}
          </div>
          <div className="control-center-pill">
            <span>Avg Readiness</span>
            <strong>{data.summary.avgReadiness}</strong>
          </div>
          <div className="control-center-pill">
            <span>At Risk</span>
            <strong><AnimatedNumber value={data.summary.atRiskStudents} /></strong>
          </div>
          <div className="control-center-pill">
            <span>Eligible For Upcoming</span>
            <strong><AnimatedNumber value={data.readinessFunnel.eligibleForUpcomingDrives} /></strong>
          </div>
        </div>
      </Card>

      <Card className="tpo-list-card">
        <div className="workspace-panel-header">
          <div>
            <p className="workspace-eyebrow">Next Best Actions</p>
            <h2>What to do next</h2>
          </div>
          <p className="muted-text">One action model for queues, drive risk, and student follow-up so the dashboard stays coherent.</p>
        </div>
        <div className="tpo-action-list">
          {data.nextBestActions.length === 0 ? (
            <p className="muted-text">No urgent actions are waiting right now.</p>
          ) : (
            data.nextBestActions.slice(0, 5).map((action) => (
              <div key={action.id} className="tpo-action-row">
                <div>
                  <div className="tpo-action-row-head">
                    <strong>{action.title}</strong>
                    <Badge variant={badgeVariantFromPriority(action.priority)}>{action.urgency.replace("_", " ")}</Badge>
                  </div>
                  <p className="muted-text">{action.explanation}</p>
                  <p className="muted-text">Workflow: {action.affectedWorkflow}</p>
                </div>
                <Link to={action.targetPath}>
                  <Button variant="secondary">{action.ctaLabel}</Button>
                </Link>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="tpo-list-card">
        <div className="workspace-panel-header">
          <div>
            <p className="workspace-eyebrow">Adoption Snapshot</p>
            <h2>Metrics you can show in a placement review</h2>
          </div>
          <p className="muted-text">
            These numbers turn product usage into an adoption story: activation, readiness coverage, application follow-through, and communication reach.
          </p>
        </div>
        <div className="tpo-queue-summary-grid">
          {pilotProofItems.map((item) => (
            <div key={item.label} className="tpo-queue-summary-card">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <p className="muted-text">{item.countLabel}</p>
              <p className="muted-text">{item.helper}</p>
            </div>
          ))}
        </div>
        <div className="student-workspace-inline-note">
          {milestoneChecklist.map((item) => (
            <span key={item.label}>{item.complete ? "Done" : "Pending"}: {item.label}</span>
          ))}
        </div>
        <p className="muted-text">
          Readiness is calculated from stronger placement evidence. Smart Path activity helps with engagement and intervention follow-up, but low platform usage alone does not mean a student is incapable.
        </p>
      </Card>

      <Card className="tpo-list-card">
        <div className="workspace-panel-header">
          <div>
            <p className="workspace-eyebrow">Needs Attention Today</p>
            <h2>Top queues and follow-up items</h2>
          </div>
          <div className="hero-actions">
            <Link to="/tpo/students">
              <Button variant="secondary">Open Students</Button>
            </Link>
            <Link to="/tpo/drives">
              <Button variant="secondary">Open Drives</Button>
            </Link>
          </div>
        </div>
        <div className="tpo-queue-summary-grid">
          {queueSummary.map((item) => (
            <div key={item.label} className="tpo-queue-summary-card">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <p className="muted-text">
                {item.value === 0 && item.label === "Student Support"
                  ? "Open student support requests will appear here once students begin using the portal."
                  : item.value === 0 && item.label === "Communication Tasks"
                    ? "Drive reminders and result-release follow-up will appear here after outreach starts."
                    : item.helper}
              </p>
            </div>
          ))}
        </div>
        <div className="tpo-action-list">
          {needsAttentionItems.length === 0 ? (
            <p className="muted-text">No urgent queues right now.</p>
          ) : (
            needsAttentionItems.map((item) => (
              <div key={item.id} className="tpo-action-row">
                <div>
                  <div className="tpo-action-row-head">
                    <strong>{item.title}</strong>
                    <Badge variant={badgeVariantFromPriority(item.priority)}>{item.priority}</Badge>
                  </div>
                  <p className="muted-text">{item.summary}</p>
                </div>
                <Link to={item.targetPath}>
                  <Button variant="secondary">{item.ctaLabel}</Button>
                </Link>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="tpo-list-card">
        <div className="workspace-panel-header">
          <div>
            <p className="workspace-eyebrow">Active Drive Health</p>
            <h2>Live drive operations</h2>
          </div>
          <p className="muted-text">Each card shows eligibility coverage, application movement, export readiness, and next direct actions.</p>
        </div>
        <div className="tpo-drive-health-grid">
          {data.drivePreparedness.items.length === 0 ? (
            <p className="muted-text">No active or upcoming drives yet. Create your first drive to start eligibility, applications, and export workflows.</p>
          ) : (
            data.drivePreparedness.items.map((drive) => (
              <div key={drive.driveId} className="tpo-drive-health-card">
                <div className="tpo-drive-health-head">
                  <div>
                    <strong>{drive.company}</strong>
                    <p className="muted-text">
                      {drive.role ? `${drive.role} | ` : ""}
                      {formatDate(drive.driveDate)}
                    </p>
                  </div>
                  <div className="tpo-drive-health-badges">
                    <Badge variant={badgeVariantFromRisk(drive.driveRiskScore)}>Risk {drive.driveRiskScore}</Badge>
                    <Badge variant={drive.lowApplyRisk ? "warning" : "default"}>{drive.status.replace(/_/g, " ")}</Badge>
                  </div>
                </div>
                <div className="tpo-drive-health-metrics">
                  <div><span>Eligible</span><strong>{drive.eligibleStudents}</strong></div>
                  <div><span>Applied</span><strong>{drive.appliedCount}</strong></div>
                  <div><span>Eligible Not Applied</span><strong>{drive.eligibleButNotAppliedCount}</strong></div>
                  <div><span>Days Remaining</span><strong>{drive.daysRemaining ?? "NA"}</strong></div>
                </div>
                <div className="tpo-drive-health-meta">
                  <div>
                    <span>Resume export</span>
                    <strong>{drive.resumeExportReady ? "Ready" : `${drive.exportReadyApplicants}/${drive.appliedCount} ready`}</strong>
                  </div>
                  <div>
                    <span>Results</span>
                    <strong>{drive.resultPublicationState.replace(/_/g, " ")}</strong>
                  </div>
                  <div>
                    <span>Eligible but weak</span>
                    <strong>{drive.drilldown.eligibleButWeak}</strong>
                  </div>
                  <div>
                    <span>No recent activity</span>
                    <strong>{drive.drilldown.noRecentActivity}</strong>
                  </div>
                </div>
                <div className="hero-actions">
                  <Link to={`/tpo/drives/${drive.driveId}`}>
                    <Button variant="secondary">Open Drive</Button>
                  </Link>
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      try {
                        await computeDriveEligibility(drive.driveId);
                        await mutate("/api/v1/tpo/dashboard/control-center");
                      } catch (actionError) {
                        window.alert(actionError instanceof Error ? actionError.message : "Unable to compute eligibility right now.");
                      }
                    }}
                  >
                    Compute Eligibility
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setPendingExport({
                        title: "Export eligible CSV",
                        href: `/api/v1/drives/${drive.driveId}/export?format=csv`,
                        details: [
                          `Drive: ${drive.company}${drive.role ? ` - ${drive.role}` : ""}`,
                          `Eligible students: ${drive.eligibleStudents}`,
                        ],
                      })
                    }
                  >
                    Export Eligible CSV
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setPendingExport({
                        title: "Export resumes",
                        href: `/api/v1/drives/${drive.driveId}/export/resumes`,
                        details: [
                          `Drive: ${drive.company}${drive.role ? ` - ${drive.role}` : ""}`,
                          `Applied students: ${drive.appliedCount}`,
                        ],
                      })
                    }
                  >
                    Export Resumes
                  </Button>
                  <Link to={`/tpo/drives/${drive.driveId}/results`}>
                    <Button variant="secondary">Manage Results</Button>
                  </Link>
                  <Link to="/tpo/communication">
                    <Button variant="secondary">Send Reminder</Button>
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <div className="tpo-ops-grid">
        <Card className="tpo-list-card">
          <div className="workspace-panel-header">
            <div>
              <p className="workspace-eyebrow">What&apos;s New</p>
              <h2>Recent product changes visible to TPOs</h2>
            </div>
            <Link to="/tpo/whats-new">
              <Button variant="secondary">Open changelog</Button>
            </Link>
          </div>
          <div className="tpo-action-list">
            {tpoWhatsNewEntries.slice(0, 3).map((entry) => (
              <div key={entry.id} className="tpo-action-row">
                <div>
                  <strong>{entry.title}</strong>
                  <p className="muted-text">
                    {new Date(entry.date).toLocaleDateString()} | {entry.workflow}
                  </p>
                  <p className="muted-text">{entry.summary}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="tpo-list-card">
          <div className="workspace-panel-header">
            <div>
              <p className="workspace-eyebrow">Student Readiness Funnel</p>
              <h2>Where the batch is getting blocked</h2>
            </div>
          </div>
          <div className="tpo-funnel-grid">
            <div className="tpo-funnel-step"><span>Total Students</span><strong>{data.readinessFunnel.totalStudents}</strong></div>
            <div className="tpo-funnel-step"><span>Profile Complete</span><strong>{data.readinessFunnel.completeProfiles}</strong></div>
            <div className="tpo-funnel-step"><span>Certified</span><strong>{data.readinessFunnel.certifiedProfiles}</strong></div>
            <div className="tpo-funnel-step"><span>Resume Ready</span><strong>{data.readinessFunnel.resumeReadyProfiles}</strong></div>
            <div className="tpo-funnel-step"><span>Eligible</span><strong>{data.readinessFunnel.eligibleForUpcomingDrives}</strong></div>
            <div className="tpo-funnel-step"><span>Applied Recently</span><strong>{data.readinessFunnel.appliedRecently}</strong></div>
          </div>
          <div className="tpo-blocker-grid">
            <div><span>Missing resume</span><strong>{data.blockerSegments.missingResume}</strong></div>
            <div><span>Uncertified</span><strong>{data.blockerSegments.uncertified}</strong></div>
            <div><span>Incomplete profile</span><strong>{data.blockerSegments.incompleteProfile}</strong></div>
            <div><span>Academically blocked</span><strong>{data.blockerSegments.academicallyBlocked}</strong></div>
            <div><span>Low engagement</span><strong>{data.blockerSegments.lowEngagement}</strong></div>
          </div>
        </Card>

        <Card className="tpo-list-card">
          <div className="workspace-panel-header">
            <div>
              <p className="workspace-eyebrow">Intervention Queues</p>
              <h2>Queues that need a response</h2>
            </div>
          </div>
          <div className="tpo-action-list">
            {data.dashboardQueues.profileUnlockRequests.items.slice(0, 4).map((item) => (
              <div key={item.id} className="tpo-action-row">
                <div>
                  <strong>{item.studentName}</strong>
                  <p className="muted-text">
                    {item.reasonCategory.replace(/_/g, " ")} | {formatDateTime(item.createdAt)}
                  </p>
                </div>
                <div className="hero-actions">
                  <Button
                    onClick={async () => {
                      try {
                        await reviewStudentUnlockRequest({
                          studentId: item.studentId,
                          requestId: item.requestId,
                          decision: "approved",
                        });
                        await mutate("/api/v1/tpo/dashboard/control-center");
                      } catch (actionError) {
                        window.alert(actionError instanceof Error ? actionError.message : "Unable to approve unlock request.");
                      }
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      const note = window.prompt("Add an optional note for the student:", "Please update only the requested fields.");
                      try {
                        await reviewStudentUnlockRequest({
                          studentId: item.studentId,
                          requestId: item.requestId,
                          decision: "denied",
                          responseNote: note ?? undefined,
                        });
                        await mutate("/api/v1/tpo/dashboard/control-center");
                      } catch (actionError) {
                        window.alert(actionError instanceof Error ? actionError.message : "Unable to deny unlock request.");
                      }
                    }}
                  >
                    Deny
                  </Button>
                </div>
              </div>
            ))}
            {data.dashboardQueues.studentSupportRequests.items.slice(0, 3).map((item) => (
              <div key={item.id} className="tpo-action-row">
                <div>
                  <strong>{item.subject}</strong>
                  <p className="muted-text">
                    {item.studentName} | {formatDateTime(item.createdAt)}
                  </p>
                </div>
                <Button
                  onClick={async () => {
                    const note = window.prompt("Add a short resolution note for the student:", "Resolved by placement office");
                    if (!note || !note.trim()) return;
                    try {
                      await resolveStudentSupportRequest(item.requestId, note.trim());
                      await mutate("/api/v1/tpo/dashboard/control-center");
                    } catch (actionError) {
                      window.alert(actionError instanceof Error ? actionError.message : "Unable to resolve support request.");
                    }
                  }}
                >
                  Mark Resolved
                </Button>
              </div>
            ))}
            {data.dashboardQueues.supportAccessRequests.items.slice(0, 3).map((item) => (
              <div key={item.id} className="tpo-action-row">
                <div>
                  <strong>{item.requestedByEmail}</strong>
                  <p className="muted-text">{item.reason}</p>
                </div>
                <div className="hero-actions">
                  <Button
                    onClick={async () => {
                      try {
                        await approveSupportRequest(item.requestId, 60);
                        await mutate("/api/v1/tpo/dashboard/control-center");
                      } catch (actionError) {
                        window.alert(actionError instanceof Error ? actionError.message : "Unable to approve support access.");
                      }
                    }}
                  >
                    Approve (60m)
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      try {
                        await denySupportRequest(item.requestId, "Denied by TPO");
                        await mutate("/api/v1/tpo/dashboard/control-center");
                      } catch (actionError) {
                        window.alert(actionError instanceof Error ? actionError.message : "Unable to deny support access.");
                      }
                    }}
                  >
                    Deny
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="tpo-list-card">
        <div className="workspace-panel-header">
          <div>
            <p className="workspace-eyebrow">Students Needing Follow-up</p>
            <h2>Ready but inactive, or eligible but underprepared</h2>
          </div>
        </div>
        <div className="tpo-ranking-table-wrap">
          <Table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Branch</th>
                <th>Batch</th>
                <th>Risk</th>
                <th>Profile</th>
                <th>Resume</th>
                <th>Certified</th>
                <th>Next Action</th>
              </tr>
            </thead>
            <tbody>
              {followUpStudents.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted-text">No follow-up students right now.</td>
                </tr>
              ) : (
                followUpStudents.map((student) => {
                  const fullRow = data.operationsBoard.items.find((item) => item.studentId === student.studentId);
                  return (
                    <tr key={student.studentId}>
                      <td>
                        <Link to={`/tpo/students/${student.studentId}`}>{student.fullName}</Link>
                      </td>
                      <td>{fullRow?.branch ?? "-"}</td>
                      <td>{fullRow?.batch ?? "-"}</td>
                      <td>
                        <Badge variant={badgeVariantFromRisk(fullRow?.riskScore ?? 0)}>
                          {fullRow?.riskLevel ?? "Monitor"}
                        </Badge>
                      </td>
                      <td>{fullRow ? `${fullRow.profileCompletenessPct}%` : "-"}</td>
                      <td>{fullRow?.hasResumeReady ? "Ready" : "Missing"}</td>
                      <td>{fullRow?.isProfileCertified ? "Certified" : "Pending"}</td>
                      <td>{student.nextRecommendedAction}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </Table>
        </div>
      </Card>

      <div className="tpo-ops-grid">
        <Card className="tpo-list-card">
          <div className="workspace-panel-header">
            <div>
              <p className="workspace-eyebrow">Drive-Specific Intervention</p>
              <h2>Eligible but not applied</h2>
            </div>
            <Link to="/tpo/interventions/eligible-not-applied">
              <Button variant="secondary">Open full queue</Button>
            </Link>
          </div>
          <div className="tpo-action-list">
            {data.actionCenter.eligibleButNotApplied.length === 0 ? (
              <p className="muted-text">No eligible-but-not-applied drive queues right now.</p>
            ) : (
              data.actionCenter.eligibleButNotApplied.map((drive) => (
                <div key={drive.driveId} className="tpo-action-row">
                  <div>
                    <strong>{drive.company}</strong>
                    <p className="muted-text">
                      {drive.eligibleButNotAppliedCount} eligible students still have not applied | {formatDate(drive.driveDate)}
                    </p>
                  </div>
                  <Link to={`/tpo/drives/${drive.driveId}`}>
                    <Button variant="secondary">Open Drive</Button>
                  </Link>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="tpo-list-card">
          <div className="workspace-panel-header">
            <div>
              <p className="workspace-eyebrow">Practice Intervention</p>
              <h2>Needs mock push</h2>
            </div>
            <Link to="/tpo/interventions/needs-mock-push">
              <Button variant="secondary">Open full queue</Button>
            </Link>
          </div>
          <div className="tpo-action-list">
            {data.actionCenter.lowReadinessNearDriveImpact.length === 0 ? (
              <p className="muted-text">No students need an urgent mock push right now.</p>
            ) : (
              data.actionCenter.lowReadinessNearDriveImpact.map((student) => (
                <div key={student.studentId} className="tpo-action-row">
                  <div>
                    <strong>{student.fullName}</strong>
                    <p className="muted-text">
                      {student.riskLevel} risk | {student.nextRecommendedAction}
                    </p>
                  </div>
                  <Link to={`/tpo/students/${student.studentId}`}>
                    <Button variant="secondary">Open Student</Button>
                  </Link>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="tpo-list-card">
          <div className="workspace-panel-header">
            <div>
              <p className="workspace-eyebrow">Secondary Trends</p>
              <h2>Compact signals, kept below operations</h2>
            </div>
          </div>
          <div className="tpo-blocker-grid">
            <div>
              <span>Readiness trend points</span>
              <strong>{data.trends.readinessTrend.length}</strong>
            </div>
            <div>
              <span>Batch mixes</span>
              <strong>{data.trends.batchActivity.length}</strong>
            </div>
            <div>
              <span>Weak-topic clusters</span>
              <strong>{data.trends.weakTopicsByBranch.length}</strong>
            </div>
          </div>
          <div className="tpo-action-list">
            {(data.alerts.topAlerts.length > 0 ? data.alerts.topAlerts : ["No major alert spikes at the moment."]).map((alert) => (
              <div key={alert} className="tpo-action-row">
                <div>
                  <strong>{alert}</strong>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <ConfirmActionModal
        open={Boolean(pendingExport)}
        onClose={() => setPendingExport(null)}
        onConfirm={confirmExport}
        title={pendingExport?.title ?? "Confirm export"}
        message="This export will start immediately for the currently selected drive."
        confirmLabel="Start export"
        details={pendingExport?.details}
      />
    </section>
  );
}
