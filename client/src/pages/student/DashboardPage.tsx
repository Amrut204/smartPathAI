import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

import { Badge, Button, Modal, Skeleton, Tabs } from "../../components/ui";
import { isClientFeatureEnabled } from "../../config/features";
import {
  dismissAnnouncementPopup,
  markAnnouncementRead,
  useStudentAnnouncements,
} from "../../hooks/use-announcements";
import { usePilotStudentDashboard } from "../../hooks/use-pilot-dashboard";
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
  const { data: profileData } = useStudentProfile();
  const { data: riskScore } = useStudentRiskScore();
  const { data: announcements } = useStudentAnnouncements();
  const [activeView, setActiveView] = useState<DashboardView>("overview");
  const [announcementBusy, setAnnouncementBusy] = useState<string | null>(null);
  const [expandedAnnouncementId, setExpandedAnnouncementId] = useState<string | null>(null);
  const [orientationDismissed, setOrientationDismissed] = useState(false);

  useEffect(() => {
    startPerfMark("student-dashboard:usable");
    return () => finishPerfMark("student-dashboard:usable");
  }, []);

  useEffect(() => {
    if (data) {
      finishPerfMark("student-dashboard:usable");
    }
  }, [data]);

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
  const profileCompletenessPct = profileData?.profileCompleteness.pct ?? Number(data.profileCompletenessPct ?? 0);
  const canAccessMockTests = profileData?.canAccessMockTests ?? Boolean(data.canAccessMockTests);
  const canAccessResources = profileData?.canAccessResources ?? Boolean(data.canAccessResources);
  const missingStudentFields = profileData?.missingRequiredFields ?? (Array.isArray(data.missingStudentFields) ? data.missingStudentFields : []);
  const safeAnnouncements = Array.isArray(announcements) ? announcements : [];
  const unreadAnnouncements = safeAnnouncements.filter((item) => item?.unread);
  const popupAnnouncement = unreadAnnouncements.find((item) => item.popupEligible) ?? null;
  const showAdvancedMetrics = isClientFeatureEnabled("studentAdvancedMetrics");
  const studentStorageKey = useMemo(() => {
    const stableId = profileData?.seededProfile.collegeEmail || data.studentName;
    return `pilot-orientation-dismissed:${stableId}`;
  }, [data.studentName, profileData?.seededProfile.collegeEmail]);
  const riskRecommendations = Array.isArray(riskScore?.recommendations) ? riskScore.recommendations : [];
  const peerComparison = riskScore?.comparisonToPeers ?? {
    yourMockTests: 0,
    avgInYourBranch: 0,
    yourScore: 0,
    avgScoreInYourBranch: 0,
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    setOrientationDismissed(window.localStorage.getItem(studentStorageKey) === "true");
  }, [studentStorageKey]);

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

      <header className="student-workspace-header">
        <div>
          <p className="resources-kicker">{branch} - Batch {batch}</p>
          <h1>Keep your placement profile current and act on official updates.</h1>
          <p>Finish required details, track college announcements, and apply only to the drives you actually qualify for.</p>
        </div>
        <div className="hero-actions">
          <Link to="/drives" className="ui-button primary">Check Drives</Link>
          <Link to={canAccessMockTests ? "/mock-tests" : "/profile?blocked=mock-tests"} className="ui-button secondary">
            {canAccessMockTests ? "Take Mock Test" : "Complete Profile"}
          </Link>
          <Link to={canAccessResources ? "/resources" : "/profile?blocked=resources"} className="ui-button secondary">
            {canAccessResources ? "Browse Resources" : "Unlock Resources"}
          </Link>
        </div>
      </header>

      {!orientationDismissed ? (
        <section className="student-workspace-panel">
          <div className="student-workspace-panel-head">
            <div>
              <h2>Start here</h2>
              <p>Complete your academic, contact, and placement details to unlock resources and mock tests. Check available drives once your profile is certified.</p>
            </div>
            <Button variant="ghost" onClick={dismissOrientationBanner}>Dismiss</Button>
          </div>
        </section>
      ) : null}

      <section className="student-workspace-hero">
        <div className="student-workspace-hero-main">
          <span className="student-workspace-eyebrow">Placement snapshot</span>
          <strong>{showAdvancedMetrics ? `${readinessScore.toFixed(1)}%` : eligibleUpcomingDrives}</strong>
          <p className="muted-text">
            {showAdvancedMetrics
              ? `${eligibleUpcomingDrives} upcoming drive(s) currently match your profile.`
              : "Upcoming drive(s) currently match your profile."}
          </p>
        </div>

        <div className="student-workspace-metrics">
          <div><span>CGPA</span><strong>{cgpa.toFixed(2)}</strong></div>
          <div><span>Profile</span><strong>{profileCompletenessPct}%</strong></div>
          {showAdvancedMetrics ? <div><span>Study 7d</span><strong>{studyHours7d.toFixed(1)}h</strong></div> : null}
          <div><span>Mocks 7d</span><strong>{mockTestsTaken7d}</strong></div>
          <div><span>Eligible Drives</span><strong>{eligibleUpcomingDrives}</strong></div>
        </div>
      </section>

      {showAdvancedMetrics && riskScore ? (
        <section className="student-workspace-panel">
          <div className="student-workspace-panel-head">
            <div>
              <h2>Your placement risk check</h2>
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

      {(!canAccessResources || !canAccessMockTests) ? (
        <section className="student-workspace-panel">
          <div className="student-workspace-panel-head">
            <div>
              <h2>Complete your profile to unlock practice</h2>
              <p>Resources and mock tests stay locked until all required student details are filled.</p>
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

      {activeView === "overview" ? (
        <section className="student-workspace-panel">
          <div className="student-workspace-panel-head">
            <div>
              <h2>Overview</h2>
              <p>See the factual placement metrics that matter right now.</p>
            </div>
          </div>

          <div className="student-workspace-metric-grid">
            <div><span>CGPA</span><strong>{cgpa.toFixed(2)}</strong></div>
            <div><span>Upcoming eligible drives</span><strong>{eligibleUpcomingDrives}</strong></div>
            <div><span>Profile completion</span><strong>{profileCompletenessPct}%</strong></div>
            <div><span>{showAdvancedMetrics ? "Recent study focus" : "Mock tests taken"}</span><strong>{showAdvancedMetrics ? `${studyHours7d.toFixed(1)} hrs` : mockTestsTaken7d}</strong></div>
          </div>

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
        </section>
      ) : null}

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
