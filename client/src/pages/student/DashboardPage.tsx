import { Link } from "react-router-dom";
import { useEffect, useState, type CSSProperties } from "react";

import { Badge, Button, Modal, Skeleton, Tabs } from "../../components/ui";
import { isClientFeatureEnabled } from "../../config/features";
import {
  dismissAnnouncementPopup,
  markAnnouncementRead,
  useStudentAnnouncements,
} from "../../hooks/use-announcements";
import { usePilotStudentDashboard } from "../../hooks/use-pilot-dashboard";
import { useStudentDashboard } from "../../hooks/use-student-dashboard";
import { useStudentRiskScore } from "../../hooks/use-risk-assessment";
import { useStudentProfile } from "../../hooks/use-student-profile";
import { finishPerfMark, startPerfMark } from "../../utils/perf";

type DashboardView = "overview" | "announcements" | "checklist" | "drives" | "resources";

const dashboardTabs: Array<{ id: DashboardView; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "announcements", label: "Announcements" },
  { id: "checklist", label: "Checklist" },
  { id: "drives", label: "Upcoming Drives" },
  { id: "resources", label: "Continue Reading" },
];

function DashboardSkeleton() {
  return (
    <section className="student-workspace-shell">
      <header className="student-workspace-header">
        <div style={{ display: "grid", gap: 12, width: "100%" }}>
          <Skeleton size="sm" />
          <Skeleton size="lg" />
          <Skeleton size="md" />
        </div>
        <div className="hero-actions">
          <Skeleton size="md" />
          <Skeleton size="md" />
          <Skeleton size="md" />
        </div>
      </header>

      <section className="student-workspace-hero">
        <div className="student-workspace-hero-main">
          <Skeleton size="sm" />
          <Skeleton size="lg" />
          <Skeleton size="md" />
        </div>
        <div className="student-workspace-metrics">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={`dashboard-skeleton-metric-${index}`}>
              <Skeleton size="sm" />
              <Skeleton size="md" />
            </div>
          ))}
        </div>
      </section>

      <section className="student-workspace-panel">
        <div className="student-workspace-panel-head">
          <div style={{ display: "grid", gap: 8, width: "100%" }}>
            <Skeleton size="md" />
            <Skeleton size="sm" />
          </div>
        </div>
        <div className="student-workspace-list">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={`dashboard-skeleton-row-${index}`} className="student-workspace-row">
              <div style={{ display: "grid", gap: 8, width: "100%" }}>
                <Skeleton size="md" />
                <Skeleton size="sm" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

export default function DashboardPage() {
  const { data, error, isLoading } = usePilotStudentDashboard();
  const { data: richDashboard } = useStudentDashboard();
  const { data: profileData } = useStudentProfile();
  const { data: riskScore } = useStudentRiskScore();
  const { data: announcements } = useStudentAnnouncements();
  const [activeView, setActiveView] = useState<DashboardView>("overview");
  const [announcementBusy, setAnnouncementBusy] = useState<string | null>(null);
  const [expandedAnnouncementId, setExpandedAnnouncementId] = useState<string | null>(null);
  const [orientationDismissed, setOrientationDismissed] = useState(false);
  const [animateMetricCards, setAnimateMetricCards] = useState(false);

  useEffect(() => {
    startPerfMark("student-dashboard:usable");
    return () => finishPerfMark("student-dashboard:usable");
  }, []);

  useEffect(() => {
    if (data) {
      finishPerfMark("student-dashboard:usable");
    }
  }, [data]);

  useEffect(() => {
    if (!isLoading && data && !animateMetricCards) {
      setAnimateMetricCards(true);
    }
  }, [animateMetricCards, data, isLoading]);

  const stableStudentId = profileData?.seededProfile.collegeEmail || data?.studentName || "student";
  const studentStorageKey = `pilot-orientation-dismissed:${stableStudentId}`;

  useEffect(() => {
    if (typeof window === "undefined") return;
    setOrientationDismissed(window.localStorage.getItem(studentStorageKey) === "true");
  }, [studentStorageKey]);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (error || !data) {
    return (
      <section className="student-workspace-shell">
        <div className="student-workspace-panel app-state-card app-state-card-error">
          <h2>Unable to load dashboard</h2>
          <p>{error instanceof Error ? error.message : "Unknown error"}</p>
        </div>
      </section>
    );
  }

  const branch = String(data.branch ?? "");
  const batch = String(data.batch ?? "");
  const cgpa = Number(data.cgpa ?? 0);
  const readinessScore = Number(data.readinessScore ?? 0);
  const studyHours7d = Number(data.studyHours7d ?? 0);
  const mockTestsTaken7d = Number(data.mockTestsTaken7d ?? 0);
  const eligibleUpcomingDrives = Number(data.eligibleUpcomingDrives ?? 0);
  const checklist = Array.isArray(data.checklist) ? data.checklist : [];
  const upcomingDrives = Array.isArray(data.upcomingDrives) ? data.upcomingDrives : [];
  const recentResources = Array.isArray(data.recentResources) ? data.recentResources : [];
  const richerRecentResources = Array.isArray(richDashboard?.resourceUsage?.recentResources)
    ? richDashboard.resourceUsage.recentResources
    : [];
  const profileCompletenessPct = profileData?.profileCompleteness.pct ?? Number(data.profileCompletenessPct ?? 0);
  const isProfileComplete = profileCompletenessPct >= 100;
  const canAccessMockTests = profileData?.canAccessMockTests ?? Boolean(data.canAccessMockTests);
  const canAccessResources = profileData?.canAccessResources ?? Boolean(data.canAccessResources);
  const missingStudentFields = profileData?.missingRequiredFields ?? (Array.isArray(data.missingStudentFields) ? data.missingStudentFields : []);
  const safeAnnouncements = Array.isArray(announcements) ? announcements : [];
  const unreadAnnouncements = safeAnnouncements.filter((item) => item?.unread);
  const popupAnnouncement = unreadAnnouncements.find((item) => item.popupEligible) ?? null;
  const showAdvancedMetrics = isClientFeatureEnabled("studentAdvancedMetrics");
  const riskRecommendations = Array.isArray(riskScore?.recommendations) ? riskScore.recommendations : [];
  const readinessBanner = richDashboard?.readinessBanner ?? profileData?.readinessBanner ?? null;
  const sharedNextActions = Array.isArray(richDashboard?.nextBestActions) ? richDashboard.nextBestActions : [];
  const activeBlockers = Array.isArray(richDashboard?.activeBlockers) ? richDashboard.activeBlockers : [];
  const pendingAttempt = richDashboard?.pendingAttempt ?? null;
  const featuredDrivePrep = richDashboard?.featuredDrivePrep ?? null;
  const nearestUpcomingDrive = [...upcomingDrives]
    .filter((drive) => {
      const driveDate = new Date(String(drive.driveDate ?? ""));
      return !Number.isNaN(driveDate.getTime());
    })
    .sort((left, right) => new Date(left.driveDate).getTime() - new Date(right.driveDate).getTime())[0] ?? null;
  const daysUntilNearestDrive = nearestUpcomingDrive
    ? Math.max(
        0,
        Math.ceil((new Date(nearestUpcomingDrive.driveDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
      )
    : null;
  const recommendedMockTest = richDashboard?.recommendedTest ?? null;
  const shouldShowOrientation = !isProfileComplete
    || (
      !orientationDismissed
      && (
        mockTestsTaken7d === 0
        || richerRecentResources.length === 0
      )
    );
  const peerComparison = riskScore?.comparisonToPeers ?? {
    yourMockTests: 0,
    avgInYourBranch: 0,
    yourScore: 0,
    avgScoreInYourBranch: 0,
  };

  const onMarkAnnouncementRead = async (announcementId: string) => {
    setAnnouncementBusy(announcementId);
    try {
      await markAnnouncementRead(announcementId);
    } finally {
      setAnnouncementBusy(null);
    }
  };

  const onDismissPopup = async (announcementId: string) => {
    setAnnouncementBusy(announcementId);
    try {
      await dismissAnnouncementPopup(announcementId);
    } finally {
      setAnnouncementBusy(null);
    }
  };

  const dismissOrientationBanner = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(studentStorageKey, "true");
    }
    setOrientationDismissed(true);
  };

  const fallbackNextAction = (() => {
    if (profileCompletenessPct < 100) {
      const pending = missingStudentFields[0]?.label ?? "required profile details";
      return {
        title: "Complete your profile",
        explanation: `Finish ${pending} to keep practice modules and drive access fully available.`,
        ctaLabel: "Open profile",
        targetPath: "/profile",
      };
    }

    if (mockTestsTaken7d === 0 && canAccessMockTests) {
      return {
        title: "Take your next mock test",
        explanation: recommendedMockTest
          ? `${recommendedMockTest.title} is a strong next step based on your current progress.`
          : "Start one mock test this week to add stronger practice evidence for upcoming drives.",
        ctaLabel: recommendedMockTest ? "Open suggested mock" : "Browse mock tests",
        targetPath: recommendedMockTest ? `/mock-tests/${encodeURIComponent(recommendedMockTest.id)}` : "/mock-tests",
      };
    }

    if (richerRecentResources.length === 0 && canAccessResources) {
      return {
        title: "Open a recommended resource",
        explanation: "Use one curated resource if you want a focused starting point. You can still prepare from any trusted source and use Smart Path for official placement workflows.",
        ctaLabel: "Browse resources",
        targetPath: "/resources",
      };
    }

    if (nearestUpcomingDrive) {
      return {
        title: "Prepare for your next drive",
        explanation: `${nearestUpcomingDrive.company}${nearestUpcomingDrive.role ? ` - ${nearestUpcomingDrive.role}` : ""} is the nearest active opportunity.`,
        ctaLabel: "Check drives",
        targetPath: "/drives",
      };
    }

    if (richerRecentResources[0]) {
      return {
        title: "Resume where you left off",
        explanation: `Continue ${richerRecentResources[0].title} instead of starting a new topic from scratch.`,
        ctaLabel: "Continue reading",
        targetPath: `/resources/view/${encodeURIComponent(richerRecentResources[0].resourceId)}`,
      };
    }

    return {
      title: "Keep your preparation active",
      explanation: "Review announcements, drives, and your recent practice so your profile stays ready for the next opportunity.",
      ctaLabel: "Go to drives",
      targetPath: "/drives",
    };
  })();
  const nextAction = sharedNextActions[0] ?? fallbackNextAction;
  const firstRunPracticeCard = pendingAttempt
    ? {
        title: "Resume your pending mock test",
        explanation: `${pendingAttempt.title} still has saved answers waiting for you.`,
        ctaLabel: "Resume test",
        targetPath: `/mock-tests/${pendingAttempt.testId}`,
      }
    : recommendedMockTest && canAccessMockTests
      ? {
          title: `Recommended practice: ${recommendedMockTest.title}`,
          explanation: "One focused mock gives you stronger placement evidence than browsing the full catalog right now.",
          ctaLabel: "Open mock",
          targetPath: `/mock-tests/${encodeURIComponent(recommendedMockTest.id)}`,
        }
      : canAccessResources
        ? {
            title: "Open one focused resource",
            explanation: "Start with one curated resource if it helps. You can keep learning from GFG, PrepInsta, YouTube, or any source that works for you.",
            ctaLabel: "Browse resources",
            targetPath: "/resources",
          }
        : {
            title: "Unlock practice modules",
            explanation: "Complete the required profile fields first. Resources and mock tests unlock after that.",
            ctaLabel: "Open profile",
            targetPath: "/profile",
          };
  const quickStartContextStep = !isProfileComplete
    ? {
        title: "Complete your profile first",
        explanation: "Eligibility and blocker diagnostics appear after required profile fields are complete.",
        ctaLabel: "Open profile",
        targetPath: "/profile",
      }
    : activeBlockers[0]
      ? {
          title: `Resolve blocker: ${activeBlockers[0].label}`,
          explanation: activeBlockers[0].explanation,
          ctaLabel: activeBlockers[0].ctaLabel,
          targetPath: activeBlockers[0].targetPath,
        }
      : nearestUpcomingDrive
        ? {
            title: `Review nearest drive: ${nearestUpcomingDrive.company}`,
            explanation: daysUntilNearestDrive === null
              ? "Check the drive details and prepare early."
              : `${daysUntilNearestDrive} day(s) left. Confirm your readiness and next prep step now.`,
            ctaLabel: "Open drives",
            targetPath: "/drives",
          }
        : {
            title: "Check live opportunities",
            explanation: "Review current drive feed so your preparation stays aligned with active roles.",
            ctaLabel: "Open drives",
            targetPath: "/drives",
          };
  const quickStartSteps = [
    {
      id: "primary",
      title: nextAction.title,
      explanation: nextAction.explanation,
      ctaLabel: nextAction.ctaLabel,
      targetPath: nextAction.targetPath,
    },
    {
      id: "context",
      ...quickStartContextStep,
    },
    {
      id: "practice",
      title: firstRunPracticeCard.title,
      explanation: firstRunPracticeCard.explanation,
      ctaLabel: firstRunPracticeCard.ctaLabel,
      targetPath: firstRunPracticeCard.targetPath,
    },
  ];
  const quickStartContextBadges = [
    !isProfileComplete || daysUntilNearestDrive === null ? null : `${daysUntilNearestDrive} day(s) to nearest drive`,
    unreadAnnouncements.length > 0 ? `${unreadAnnouncements.length} unread announcement(s)` : null,
    canAccessMockTests ? null : "Mock tests unlock after required profile fields are complete",
    canAccessResources ? null : "Resources unlock after required profile fields are complete",
  ].filter((badge): badge is string => Boolean(badge));
  const dashboardMetricItems = [
    { label: "CGPA", value: cgpa.toFixed(2) },
    { label: "Profile", value: `${profileCompletenessPct}%` },
    ...(showAdvancedMetrics ? [{ label: "Study 7d", value: `${studyHours7d.toFixed(1)}h` }] : []),
    { label: "Mocks 7d", value: String(mockTestsTaken7d) },
    ...(isProfileComplete ? [{ label: "Eligible Drives", value: String(eligibleUpcomingDrives) }] : []),
  ];
  const overviewMetricItems = [
    { label: "CGPA", value: cgpa.toFixed(2) },
    ...(isProfileComplete ? [{ label: "Upcoming eligible drives", value: String(eligibleUpcomingDrives) }] : []),
    { label: "Profile completion", value: `${profileCompletenessPct}%` },
    {
      label: showAdvancedMetrics ? "Platform engagement" : "Mock tests taken",
      value: showAdvancedMetrics ? `${studyHours7d.toFixed(1)} hrs` : String(mockTestsTaken7d),
    },
  ];

  return (
    <section className="student-workspace-shell">
      <Modal
        open={Boolean(popupAnnouncement)}
        onClose={() => { if (popupAnnouncement) void onDismissPopup(popupAnnouncement.id); }}
        title={popupAnnouncement?.title ?? "Announcement"}
      >
        {popupAnnouncement ? (
          <div className="student-announcement-modal">
            <Badge variant="danger">Urgent</Badge>
            {popupAnnouncement.relatedDriveName ? <p><strong>Drive:</strong> {popupAnnouncement.relatedDriveName}</p> : null}
            <p>{popupAnnouncement.message}</p>
            <div className="hero-actions">
              <Button variant="ghost" disabled={announcementBusy === popupAnnouncement.id} onClick={() => void onDismissPopup(popupAnnouncement.id)}>
                Dismiss
              </Button>
              <Button disabled={announcementBusy === popupAnnouncement.id} onClick={() => void onMarkAnnouncementRead(popupAnnouncement.id)}>
                Mark Read
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <header className="student-workspace-header student-home-header-v2">
        <div>
          <p className="resources-kicker">{branch} - Batch {batch}</p>
          <h1>{`Hi ${data.studentName || "there"}, focus on the next placement move.`}</h1>
          <p>
            Smart Path is your official college workflow for readiness, drives, and announcements. You can still prepare from GFG,
            PrepInsta, YouTube, or any trusted source that works for you.
          </p>
        </div>
        <div className="hero-actions">
          {isProfileComplete ? (
            <>
              <Link to="/drives" className="ui-button primary">View eligible drives</Link>
              <Link to="/profile" className="ui-button secondary">Review profile</Link>
            </>
          ) : (
            <>
              <Link to="/profile" className="ui-button primary">Complete profile</Link>
              <Link to="/drives" className="ui-button secondary">Open drives</Link>
            </>
          )}
        </div>
      </header>

      {readinessBanner ? (
        <section className={`student-workspace-panel student-guidance-banner student-guidance-banner-${readinessBanner.tone}`}>
          <div className="student-workspace-panel-head">
            <div>
              <h2>{readinessBanner.title}</h2>
              <p>{readinessBanner.message}</p>
            </div>
            <Link to={readinessBanner.action === "View drives" ? "/drives" : "/profile"} className="ui-button ghost">
              {readinessBanner.action}
            </Link>
          </div>
        </section>
      ) : null}

      <section className="student-home-v2-grid">
        <section className="student-workspace-panel student-home-primary-card">
          <div className="student-home-score-row">
            <div>
              <span className="student-workspace-eyebrow">Readiness</span>
              <h2>{readinessScore.toFixed(0)}%</h2>
              <p className="muted-text">
                {profileCompletenessPct}% profile complete
                {isProfileComplete ? ` • ${eligibleUpcomingDrives} eligible drive${eligibleUpcomingDrives === 1 ? "" : "s"}` : ""}
              </p>
              <p className="muted-text">Readiness combines profile completion, current practice activity, and live drive eligibility.</p>
            </div>
            <div className="student-home-score-metrics">
              {dashboardMetricItems.slice(0, 4).map((item, index) => (
                <div
                  key={item.label}
                  className={animateMetricCards ? "motion-stagger-enter" : undefined}
                  style={animateMetricCards ? ({ "--motion-delay": `${Math.min(index, 3) * 60}ms` } as CSSProperties) : undefined}
                >
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>
          <div className="student-home-hero-copy">
            <span className="student-workspace-eyebrow">Do this next</span>
            <strong>{nextAction.title}</strong>
            <p>{nextAction.explanation}</p>
          </div>
          <div className="hero-actions">
            <Link to={nextAction.targetPath} className="ui-button primary">{nextAction.ctaLabel}</Link>
            <Link to="/drives" className="ui-button ghost">Open drives</Link>
          </div>

          {activeView === "overview" ? (
            <>
              <div className="student-workspace-panel-head" style={{ marginTop: 20 }}>
                <div>
                  <h3>Progress and activity</h3>
                  <p>Expanded context is merged here so everything stays in one place.</p>
                </div>
              </div>

              <div className="student-workspace-metric-grid">
                {overviewMetricItems.map((item) => (
                  <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>
                ))}
              </div>

              {featuredDrivePrep ? (
                <div className="student-dashboard-prep-grid">
                  <div className="student-dashboard-prep-card">
                    <span>Nearest drive</span>
                    <strong>{featuredDrivePrep.company}{featuredDrivePrep.role ? ` - ${featuredDrivePrep.role}` : ""}</strong>
                    <p>{new Date(featuredDrivePrep.driveDate).toLocaleDateString()} {featuredDrivePrep.daysRemaining === null ? "" : `- ${featuredDrivePrep.daysRemaining} day(s) left`}</p>
                  </div>
                  <div className="student-dashboard-prep-card">
                    <span>Recommended mocks</span>
                    {featuredDrivePrep.mockTests.length > 0 ? (
                      <ul>
                        {featuredDrivePrep.mockTests.slice(0, 2).map((test) => (
                          <li key={test.id}>
                            <Link to={`/mock-tests/${test.id}`}>{test.title}</Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No mock bundle yet. Keep your common prep active.</p>
                    )}
                  </div>
                  <div className="student-dashboard-prep-card">
                    <span>Recommended resources</span>
                    {featuredDrivePrep.resources.length > 0 ? (
                      <ul>
                        {featuredDrivePrep.resources.slice(0, 2).map((resource) => (
                          <li key={resource.id}>
                            <Link to={`/resources/view/${encodeURIComponent(resource.id)}`}>{resource.title}</Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No resource bundle yet. Start with placement essentials.</p>
                    )}
                  </div>
                </div>
              ) : null}

              {safeAnnouncements.length > 0 ? (
                <div className="student-workspace-inline-note">
                  <span>{unreadAnnouncements.length} unread announcement(s)</span>
                  <span>{safeAnnouncements.length} active notice(s)</span>
                </div>
              ) : null}

              {showAdvancedMetrics && riskScore ? (
                <div className="student-workspace-inline-note">
                  <span>Your mocks: {peerComparison.yourMockTests}</span>
                  <span>Branch avg mocks: {peerComparison.avgInYourBranch}</span>
                  <span>Your score: {peerComparison.yourScore}</span>
                  <span>Branch avg score: {peerComparison.avgScoreInYourBranch}</span>
                </div>
              ) : null}

              {isProfileComplete && activeBlockers.length > 0 ? (
                <div className="student-dashboard-action-feed">
                  {activeBlockers.slice(0, 3).map((blocker) => (
                    <div key={blocker.code} className="student-dashboard-action-card">
                      <div>
                        <strong>{blocker.label}</strong>
                        <p>{blocker.explanation}</p>
                        <span className="muted-text">{blocker.count} drive(s) affected</span>
                      </div>
                      <Link to={blocker.targetPath} className="ui-button ghost">{blocker.ctaLabel}</Link>
                    </div>
                  ))}
                </div>
              ) : null}

              {showAdvancedMetrics && riskScore ? (
                <section className="student-dashboard-risk-inline">
                  <div className="student-workspace-panel-head">
                    <div>
                      <h3>Your placement risk check</h3>
                      <p>{riskScore.message}</p>
                    </div>
                    <div className="risk-student-meta">
                      <Badge variant={riskScore.category === "HIGH_RISK" ? "danger" : riskScore.category === "MEDIUM_RISK" ? "warning" : "success"}>
                        {riskScore.category.replace("_", " ")}
                      </Badge>
                      <strong>Score {riskScore.score}</strong>
                    </div>
                  </div>
                  <ul className="risk-student-actions">
                    {riskRecommendations.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : null}
        </section>

        <section className="student-workspace-panel student-home-support-card student-home-quickstart-card">
          <div className="student-workspace-panel-head">
            <div>
              <h2>{shouldShowOrientation ? "Guided quick start" : "Current focus sequence"}</h2>
              <p>
                {shouldShowOrientation
                  ? "Follow these three steps in order to avoid extra navigation and keep your first session clear."
                  : "Use this sequence to keep momentum without context-switching."}
              </p>
            </div>
            {shouldShowOrientation ? <Button variant="ghost" onClick={dismissOrientationBanner}>Hide guide</Button> : null}
          </div>
          {quickStartContextBadges.length > 0 ? (
            <div className="student-workspace-inline-note student-home-quickstart-meta">
              {quickStartContextBadges.map((badge) => (
                <span key={badge}>{badge}</span>
              ))}
            </div>
          ) : null}
          <ol className="student-home-quickstart-list">
            {quickStartSteps.map((step, index) => (
              <li key={step.id} className="student-home-quickstart-item">
                <div className="student-home-quickstart-copy">
                  <span className="student-workspace-eyebrow">{index === 0 ? "Now" : index === 1 ? "Then" : "After that"}</span>
                  <strong>{step.title}</strong>
                  <p>{step.explanation}</p>
                </div>
                <Link to={step.targetPath} className={`ui-button ${index === 0 ? "primary" : "ghost"}`}>{step.ctaLabel}</Link>
              </li>
            ))}
          </ol>
        </section>
      </section>

      {sharedNextActions.length > 1 && !shouldShowOrientation ? (
        <section className="student-workspace-panel">
          <div className="student-workspace-panel-head">
            <div>
              <h2>Optional follow-up actions</h2>
              <p>Use these only after you finish the guided sequence above.</p>
            </div>
          </div>
          <div className="student-dashboard-action-feed">
            {sharedNextActions.slice(1, 4).map((action) => (
              <div key={action.id} className="student-dashboard-action-card">
                <div>
                  <strong>{action.title}</strong>
                  <p>{action.explanation}</p>
                </div>
                <Link to={action.targetPath} className="ui-button ghost">{action.ctaLabel}</Link>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {(!canAccessResources || !canAccessMockTests) ? (
        <section className="student-workspace-panel">
          <div className="student-workspace-panel-head">
            <div>
              <h2>Finish profile steps to unlock resources and tests</h2>
              <p>Complete required profile fields below to enable learning modules and keep drive workflows trustworthy.</p>
            </div>
            <Link to="/profile" className="ui-button ghost">Open profile</Link>
          </div>
          <div className="student-workspace-inline-note">
            {missingStudentFields.map((field) => (
              <span key={field.key}>{field.label}</span>
            ))}
          </div>
        </section>
      ) : null}

      <div className="student-workspace-switcher">
        <Tabs tabs={dashboardTabs} activeId={activeView} onChange={(id) => setActiveView(id as DashboardView)} />
      </div>

      {activeView === "announcements" ? (
        <section className="student-workspace-panel">
          <div className="student-workspace-panel-head">
            <div>
              <h2>Announcements</h2>
              <p>Important placement updates published by your college placement office.</p>
            </div>
          </div>

          {safeAnnouncements.length === 0 ? (
            <p className="muted-text">No active announcements right now.</p>
          ) : (
            <div className="student-announcement-stack">
              {safeAnnouncements.map((item) => {
                const expanded = expandedAnnouncementId === item.id;
                const message = String(item?.message ?? "");
                return (
                  <div key={item.id} className={`student-announcement-row ${item.unread ? "unread" : ""}`}>
                    <div className="student-announcement-row-head">
                      <div>
                        <strong>{String(item?.title ?? "Announcement")}</strong>
                        <p>
                          {item?.publishedAt ? new Date(item.publishedAt).toLocaleString() : "-"}
                          {item?.relatedDriveName ? ` - ${item.relatedDriveName}` : ""}
                        </p>
                      </div>
                      <div className="student-announcement-row-meta">
                        <Badge variant={item.priority === "urgent" ? "danger" : item.priority === "important" ? "warning" : "default"}>
                          {item.priority}
                        </Badge>
                        {item.unread ? <Badge variant="success">Unread</Badge> : null}
                      </div>
                    </div>
                    <p>{expanded ? message : `${message.slice(0, 180)}${message.length > 180 ? "..." : ""}`}</p>
                    <div className="hero-actions">
                      {message.length > 180 ? (
                        <Button variant="ghost" onClick={() => setExpandedAnnouncementId(expanded ? null : item.id)}>
                          {expanded ? "Show Less" : "Show More"}
                        </Button>
                      ) : null}
                      {item.unread ? (
                        <Button variant="secondary" disabled={announcementBusy === item.id} onClick={() => void onMarkAnnouncementRead(item.id)}>
                          {announcementBusy === item.id ? "Saving..." : "Mark Read"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {activeView === "checklist" ? (
        <section className="student-workspace-panel">
          <div className="student-workspace-panel-head">
            <div>
              <h2>This week&apos;s checklist</h2>
              <p>Work through these items first before adding more activity.</p>
            </div>
          </div>

          <div className="student-workspace-list">
            {checklist.map((item) => (
              <div key={item.id} className="student-workspace-row">
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.done ? "Completed" : "Still pending"}</p>
                </div>
                <Badge variant={item.done ? "success" : "warning"}>{item.done ? "Done" : "Pending"}</Badge>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeView === "drives" ? (
        <section className="student-workspace-panel">
          <div className="student-workspace-panel-head">
            <div>
              <h2>Upcoming drives</h2>
              <p>Focus on the opportunities already closest to your current profile.</p>
            </div>
            <Link to="/drives" className="ui-button ghost">Open full drives page</Link>
          </div>

          <div className="student-workspace-list">
            {upcomingDrives.map((drive) => (
              <div key={drive.id} className="student-workspace-row">
                <div>
                  <strong>{drive.company}</strong>
                  <p>{drive.role} - {new Date(drive.driveDate).toLocaleDateString()}</p>
                </div>
                <Badge variant={drive.myStatus === "eligible" ? "success" : "warning"}>{drive.myStatus}</Badge>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeView === "resources" ? (
        <section className="student-workspace-panel">
          <div className="student-workspace-panel-head">
            <div>
              <h2>Continue reading</h2>
              <p>Resume the resources you already opened instead of searching from scratch.</p>
            </div>
            <Link to="/resources" className="ui-button ghost">Open resource library</Link>
          </div>

          {recentResources.length === 0 ? (
            <p className="muted-text">No recent resource activity yet.</p>
          ) : (
            <div className="student-workspace-list">
              {recentResources.map((item) => (
                <div key={item.resourceId} className="student-workspace-row">
                  <div>
                    <strong>{item.title}</strong>
                    <p>{new Date(item.viewedAt).toLocaleString()}</p>
                  </div>
                  <Link to={`/resources/view/${encodeURIComponent(item.resourceId)}`} className="ui-button secondary">
                    Open
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </section>
  );
}
