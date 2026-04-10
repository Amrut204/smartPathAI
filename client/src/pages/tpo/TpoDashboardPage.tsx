import { useEffect, useMemo, useState } from "react";
import { mutate } from "swr";
import { Link } from "react-router-dom";

import { Badge, Button, Card, ConfirmActionModal, Skeleton, Table } from "../../components/ui";
import { TpoActionMenu } from "../../components/composites/TpoActionMenu";
import { TpoSubviewSwitcher } from "../../components/composites/TpoSubviewSwitcher";
import { TpoWorkspaceHeader } from "../../components/composites/TpoWorkspaceHeader";
import { AnimatedNumber } from "../../components/motion/AnimatedNumber";
import { useTpoControlCenter } from "../../hooks/use-analytics";
import { runAutomationNow, useTpoAutomationSummary } from "../../hooks/use-tpo-automation";
import { computeDriveEligibility } from "../../hooks/use-drives";
import { getTpoGreeting } from "../../config/tpo-workspace";
import { tpoWhatsNewEntries } from "../../config/tpo-whats-new";
import {
  getAutomationDisplayMeta,
  getAutomationRunCountLabel,
  getAutomationRunReason,
  getAutomationRunTargetPath,
  getAutomationRunTitle,
} from "../../config/tpo-automation-display";
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
  const automationSummary = useTpoAutomationSummary();
  const { profile } = useAuth();
  const [activePane, setActivePane] = useState<"today" | "students" | "drives" | "reports" | "updates">("today");
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
    { id: "announcements", label: "Send an announcement", href: "/tpo/communication?view=announcements", complete: data.summary.outreachStartedCount > 0 },
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

  const followUpStudents = [
    ...data.actionCenter.studentsToContactToday,
    ...data.actionCenter.readyButInactive,
    ...data.actionCenter.lowReadinessNearDriveImpact,
  ]
    .filter((student, index, list) => list.findIndex((candidate) => candidate.studentId === student.studentId) === index)
    .slice(0, 12);

  const pilotProof = data.pilotProof ?? {
    activationWindowDays: 7,
    metrics: {
      activatedStudents7d: {
        count: data.summary.activeStudents7d,
        pct: data.summary.totalStudents > 0 ? Math.round((data.summary.activeStudents7d / data.summary.totalStudents) * 100) : 0,
        helper: "Students active in the last 7 days.",
      },
      profileComplete: {
        count: Math.round((data.summary.profileCompletePct / 100) * data.summary.totalStudents),
        pct: data.summary.profileCompletePct,
        helper: "Students with complete profiles.",
      },
      certifiedProfiles: {
        count: data.readinessFunnel.certifiedProfiles,
        pct: data.summary.totalStudents > 0 ? Math.round((data.readinessFunnel.certifiedProfiles / data.summary.totalStudents) * 100) : 0,
        helper: "Students with certified profiles.",
      },
      resumeReady: {
        count: data.readinessFunnel.resumeReadyProfiles,
        pct: data.summary.totalStudents > 0 ? Math.round((data.readinessFunnel.resumeReadyProfiles / data.summary.totalStudents) * 100) : 0,
        helper: "Students with a resume ready for drive workflows.",
      },
      eligibleForUpcoming: {
        count: data.readinessFunnel.eligibleForUpcomingDrives,
        pct: data.summary.totalStudents > 0 ? Math.round((data.readinessFunnel.eligibleForUpcomingDrives / data.summary.totalStudents) * 100) : 0,
        helper: "Students currently eligible for at least one upcoming drive.",
      },
      eligibleButNotApplied: {
        count: data.actionCenter.eligibleButNotApplied.reduce((total, item) => total + item.eligibleButNotAppliedCount, 0),
        pct: 0,
        helper: "Students eligible for a drive but still not applied.",
      },
      mockAdoption: {
        count: data.mockInsights.summary.totalAttempts > 0 ? data.mockInsights.students.filter((item) => item.attempts > 0).length : 0,
        pct: data.summary.totalStudents > 0 && data.mockInsights.summary.totalAttempts > 0
          ? Math.round((data.mockInsights.students.filter((item) => item.attempts > 0).length / data.summary.totalStudents) * 100)
          : 0,
        helper: "Students who attempted at least one mock test.",
      },
      announcementReadRate: {
        readCount: 0,
        recipientCount: 0,
        pct: 0,
        helper: "Announcement read tracking is not available in this environment yet.",
      },
    },
    milestoneChecklist: {
      importedStudents: data.summary.totalStudents > 0,
      createdFirstDrive: data.summary.totalDrives > 0,
      sentFirstAnnouncement: data.summary.outreachStartedCount > 0,
      releasedFirstResult: false,
    },
  };

  const pilotProofItems = [
    {
      label: "Activated in 7d",
      value: `${pilotProof.metrics.activatedStudents7d.pct}%`,
      countLabel: `${pilotProof.metrics.activatedStudents7d.count} students`,
    },
    {
      label: "Profiles complete",
      value: `${pilotProof.metrics.profileComplete.pct}%`,
      countLabel: `${pilotProof.metrics.profileComplete.count} students`,
    },
    {
      label: "Resume ready",
      value: `${pilotProof.metrics.resumeReady.pct}%`,
      countLabel: `${pilotProof.metrics.resumeReady.count} students`,
    },
    {
      label: "Eligible for drives",
      value: `${pilotProof.metrics.eligibleForUpcoming.pct}%`,
      countLabel: `${pilotProof.metrics.eligibleForUpcoming.count} students`,
    },
    {
      label: "Eligible not applied",
      value: `${pilotProof.metrics.eligibleButNotApplied.pct}%`,
      countLabel: `${pilotProof.metrics.eligibleButNotApplied.count} students`,
    },
    {
      label: "Mock adoption",
      value: `${pilotProof.metrics.mockAdoption.pct}%`,
      countLabel: `${pilotProof.metrics.mockAdoption.count} students`,
    },
    {
      label: "Announcement read rate",
      value: `${pilotProof.metrics.announcementReadRate.pct}%`,
      countLabel: `${pilotProof.metrics.announcementReadRate.readCount}/${pilotProof.metrics.announcementReadRate.recipientCount || 0} reads`,
    },
  ];

  const milestoneChecklist = [
    { label: "Imported students", complete: pilotProof.milestoneChecklist.importedStudents },
    { label: "Created first drive", complete: pilotProof.milestoneChecklist.createdFirstDrive },
    { label: "Sent first announcement", complete: pilotProof.milestoneChecklist.sentFirstAnnouncement },
    { label: "Released first result", complete: pilotProof.milestoneChecklist.releasedFirstResult },
  ];

  const automationMetrics = automationSummary.data ? [
    {
      label: getAutomationDisplayMeta("eligible_not_applied").dashboardMetricLabel,
      value: automationSummary.data.counts.eligibleNotApplied,
      note: "Students currently sitting in reminder drafts.",
    },
    {
      label: getAutomationDisplayMeta("blocked_profile_followup").dashboardMetricLabel,
      value: automationSummary.data.counts.blockedProfiles,
      note: "Students blocked by profile, resume, or certification gaps.",
    },
    {
      label: getAutomationDisplayMeta("scheduled_report_pack").dashboardMetricLabel,
      value: automationSummary.data.lastReportPackAt ? 1 : 0,
      note: automationSummary.data.lastReportPackAt ? `Last prepared ${formatDateTime(automationSummary.data.lastReportPackAt)}` : "No scheduled pack generated yet.",
    },
    {
      label: getAutomationDisplayMeta("unplaced_intervention_refresh").dashboardMetricLabel,
      value: automationSummary.data.counts.unplacedIntervention,
      note: "Students currently grouped into intervention queues.",
    },
  ] : [];

  const greeting = getTpoGreeting(profile?.full_name ?? "Placement team");
  const eligibleStudentQueuePath = "/tpo/students?mode=ops&view=eligible_but_not_applied";
  const interventionQueuePath = "/tpo/students?mode=ops&view=needs_mock_push";
  const studentsQueuePath = "/tpo/students?mode=ops&view=ready_but_inactive";
  const reportsPath = "/tpo/reports?focus=scheduled-reports";
  const reviewQueuePath = "/tpo/communication?view=review";

  if (isFullyEmptyTenant && !onboardingDismissed) {
    return (
      <section className="tpo-dashboard control-center-page">
        <Card className="career-hero-card control-center-hero-card">
          <TpoWorkspaceHeader
            eyebrow="First Run Setup"
            greeting={greeting}
            title="Let's get this placement workspace ready."
            description="A brand new TPO account should not feel broken or empty. Start with these four setup steps, then the regular dashboard takes over."
            primaryAction={(
              <Link to="/tpo/students/upload">
                <Button>Import Students</Button>
              </Link>
            )}
            actionMenu={(
              <TpoActionMenu
                items={[
                  { label: "Create first drive", href: "/tpo/drives/create" },
                  { label: "Open communication", href: "/tpo/communication" },
                  { label: "What's new", href: "/tpo/whats-new" },
                ]}
              />
            )}
          />
          <div className="tpo-action-list">
            {checklistSteps.map((step, index) => (
              <div key={step.id} className="tpo-action-row">
                <div>
                  <div className="tpo-action-row-head">
                    <strong>{index + 1}. {step.label}</strong>
                    <Badge variant={step.complete ? "success" : "warning"}>{step.complete ? "Done" : "Pending"}</Badge>
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
                    <Button variant={step.complete ? "secondary" : "primary"}>{step.complete ? "Review" : "Open"}</Button>
                  </Link>
                ) : (
                  <Button variant="secondary" disabled>Ready state</Button>
                )}
              </div>
            ))}
          </div>
          {checklistComplete ? (
            <div className="hero-actions">
              <Button
                onClick={() => {
                  if (onboardingStorageKey) localStorage.setItem(onboardingStorageKey, "true");
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
      <TpoWorkspaceHeader
        eyebrow="TPO Workspace"
        greeting={greeting}
        title="Start with today's queue, then open one workspace at a time."
        description="This dashboard is now the calm starting point for TPO work. Pick the current workspace below and focus on one operational block instead of scanning multiple competing cards."
        primaryAction={(
          <Link to={reviewQueuePath}>
            <Button>Open Review Queue</Button>
          </Link>
        )}
        secondaryAction={(
          <Link to={studentsQueuePath}>
            <Button variant="secondary">Open Students Queue</Button>
          </Link>
        )}
        actionMenu={(
          <TpoActionMenu
            items={[
              { label: "Create drive", href: "/tpo/drives/create" },
              { label: "Open scheduled reports", href: reportsPath },
              { label: "Open changelog", href: "/tpo/whats-new" },
            ]}
          />
        )}
      />

      <TpoSubviewSwitcher
        label="TPO workspace sections"
        items={[
          { id: "today", label: "Today's queue" },
          { id: "students", label: "Students" },
          { id: "drives", label: "Drives" },
          { id: "reports", label: "Reports" },
          { id: "updates", label: "Updates" },
        ]}
        activeId={activePane}
        onChange={(next) => setActivePane(next as typeof activePane)}
      />

      {activePane === "today" ? (
        <Card className="tpo-single-pane-card">
          <div className="tpo-inline-section-head">
            <div>
              <p className="workspace-eyebrow">Today's queue</p>
              <h2>What needs attention now</h2>
              <p className="muted-text">Start here to review reminders, follow-ups, and manual approvals generated for today.</p>
            </div>
          </div>

          <div className="tpo-inline-section">
            <div className="tpo-queue-summary-grid">
              {queueSummary.map((item) => (
                <div key={item.label} className="tpo-queue-summary-card">
                  <span>{item.label}</span>
                  <strong><AnimatedNumber value={item.value} /></strong>
                  <p className="muted-text">{item.helper}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="tpo-inline-section">
            <div className="tpo-inline-section-head">
              <div>
                <h3>Automation review</h3>
                <p className="muted-text">These drafts are waiting for approval or follow-up.</p>
              </div>
              <TpoActionMenu
                items={[
                  {
                    label: "Refresh blocked follow-up",
                    onSelect: async () => {
                      try {
                        await runAutomationNow({ automationType: "blocked_profile_followup" });
                      } catch (actionError) {
                        window.alert(actionError instanceof Error ? actionError.message : "Unable to refresh automation drafts right now.");
                      }
                    },
                  },
                  { label: "Open scheduled reports", href: reportsPath },
                ]}
              />
            </div>
            {automationSummary.data ? (
              <>
                <div className="tpo-blocker-grid">
                  {automationMetrics.map((metric) => (
                    <div key={metric.label}>
                      <span>{metric.label}</span>
                      <strong>{metric.value}</strong>
                      <p className="muted-text">{metric.note}</p>
                    </div>
                  ))}
                </div>
                <div className="tpo-action-list">
                  {automationSummary.data.items.length === 0 ? (
                    <p className="muted-text">No review-first automation drafts are waiting right now.</p>
                  ) : (
                    automationSummary.data.items.map((item) => (
                      <div key={item.id} className="tpo-action-row">
                        <div>
                          <div className="tpo-action-row-head">
                            <strong>{getAutomationRunTitle(item)}</strong>
                            <Badge variant="warning">{getAutomationRunCountLabel(item)}</Badge>
                          </div>
                          <p className="muted-text">{getAutomationRunReason(item)}</p>
                        </div>
                        <Link to={getAutomationRunTargetPath(item)}>
                          <Button variant="secondary">Open</Button>
                        </Link>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <p className="muted-text">Automation review is loading.</p>
            )}
          </div>
        </Card>
      ) : null}

      {activePane === "students" ? (
        <Card className="tpo-single-pane-card">
          <div className="tpo-inline-section-head">
            <div>
              <p className="workspace-eyebrow">Students</p>
              <h2>Act on one student queue at a time</h2>
              <p className="muted-text">Use this section for follow-up cohorts, approvals, and intervention-ready student lists.</p>
            </div>
            <TpoActionMenu
              items={[
                { label: "Open full student workspace", href: studentsQueuePath },
                { label: "Eligible, not applied", href: eligibleStudentQueuePath },
                { label: "Needs intervention", href: interventionQueuePath },
                { label: "Upload students", href: "/tpo/students/upload" },
              ]}
            />
          </div>

          <div className="tpo-inline-section">
            <div className="tpo-inline-section-head">
              <div>
                <h3>Students needing follow-up</h3>
                <p className="muted-text">Ready but inactive, or eligible but still underprepared.</p>
              </div>
              <Link to={studentsQueuePath}>
                <Button variant="secondary">View students</Button>
              </Link>
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
                          <td><Link to={`/tpo/students/${student.studentId}`}>{student.fullName}</Link></td>
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
          </div>
        </Card>
      ) : null}

      {activePane === "drives" ? (
        <Card className="tpo-single-pane-card">
          <div className="tpo-inline-section-head">
            <div>
              <p className="workspace-eyebrow">Drives</p>
              <h2>Live drive operations</h2>
              <p className="muted-text">Review one drive list at a time, then open the drive itself for deeper work.</p>
            </div>
            <Link to="/tpo/drives">
              <Button variant="secondary">Open drives</Button>
            </Link>
          </div>
          <div className="tpo-inline-section">
            <div className="tpo-drive-health-grid">
              {data.drivePreparedness.items.length === 0 ? (
                <p className="muted-text">No active or upcoming drives yet. Create your first drive to start eligibility, applications, and export workflows.</p>
              ) : (
                data.drivePreparedness.items.map((drive) => (
                  <div key={drive.driveId} className="tpo-drive-health-card">
                    <div className="tpo-drive-health-head">
                      <div>
                        <strong>{drive.company}</strong>
                        <p className="muted-text">{drive.role ? `${drive.role} | ` : ""}{formatDate(drive.driveDate)}</p>
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
                    <div className="tpo-drives-actions">
                      <Link to={`/tpo/drives/${drive.driveId}`}>Open</Link>
                      <TpoActionMenu
                        items={[
                          {
                            label: "Compute eligibility",
                            onSelect: async () => {
                              try {
                                await computeDriveEligibility(drive.driveId);
                                await mutate("/api/v1/tpo/dashboard/control-center");
                              } catch (actionError) {
                                window.alert(actionError instanceof Error ? actionError.message : "Unable to compute eligibility right now.");
                              }
                            },
                          },
                          {
                            label: "Export eligible CSV",
                            onSelect: () => setPendingExport({
                              title: "Export eligible CSV",
                              href: `/api/v1/drives/${drive.driveId}/export?format=csv`,
                              details: [
                                `Drive: ${drive.company}${drive.role ? ` - ${drive.role}` : ""}`,
                                `Eligible students: ${drive.eligibleStudents}`,
                              ],
                            }),
                          },
                          { label: "Manage results", href: `/tpo/drives/${drive.driveId}/results` },
                        ]}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>
      ) : null}

      {activePane === "reports" ? (
        <Card className="tpo-single-pane-card">
          <div className="tpo-inline-section-head">
            <div>
              <p className="workspace-eyebrow">Reports</p>
              <h2>Readiness and export health</h2>
              <p className="muted-text">Keep report signals and evidence together in one calm workspace instead of spreading them across the page.</p>
            </div>
            <Link to={reportsPath}>
              <Button variant="secondary">Open reports</Button>
            </Link>
          </div>
          <div className="tpo-inline-section">
            <h3>Adoption snapshot</h3>
            <div className="tpo-queue-summary-grid">
              {pilotProofItems.map((item) => (
                <div key={item.label} className="tpo-queue-summary-card">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <p className="muted-text">{item.countLabel}</p>
                </div>
              ))}
            </div>
            <div className="student-workspace-inline-note">
              {milestoneChecklist.map((item) => (
                <span key={item.label}>{item.complete ? "Done" : "Pending"}: {item.label}</span>
              ))}
            </div>
          </div>
        </Card>
      ) : null}

      {activePane === "updates" ? (
        <Card className="tpo-single-pane-card">
          <div className="tpo-inline-section-head">
            <div>
              <p className="workspace-eyebrow">Updates</p>
              <h2>Recent changes and compact trend signals</h2>
              <p className="muted-text">Keep secondary product updates and trend reading below the operational queue.</p>
            </div>
            <Link to="/tpo/whats-new">
              <Button variant="secondary">Open changelog</Button>
            </Link>
          </div>
          <div className="tpo-inline-section">
            <div className="tpo-action-list">
              {tpoWhatsNewEntries.slice(0, 4).map((entry) => (
                <div key={entry.id} className="tpo-action-row">
                  <div>
                    <strong>{entry.title}</strong>
                    <p className="muted-text">{new Date(entry.date).toLocaleDateString()} | {entry.workflow}</p>
                    <p className="muted-text">{entry.summary}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      ) : null}

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
