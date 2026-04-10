import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { TpoActionMenu } from "../../components/composites/TpoActionMenu";
import { TpoWorkspaceHeader } from "../../components/composites/TpoWorkspaceHeader";
import { useAuth } from "../../components/providers/AuthProvider";
import { Badge, Button, Card, Input, Select, Table, Toggle } from "../../components/ui";
import { getTpoGreeting } from "../../config/tpo-workspace";
import { runAutomationNow } from "../../hooks/use-tpo-automation";
import { useTpoStudents, type TpoStudentRow } from "../../hooks/use-tpo-students";

type PageMode = "all" | "ops";
type SavedViewId = "all" | "ready_but_inactive" | "eligible_but_not_applied" | "missing_resume" | "uncertified" | "incomplete_profile" | "needs_mock_push" | "academically_blocked";
type SortBy = "cgpa" | "created_at" | "readiness_score" | "profile_completeness" | "risk_score" | "upcoming_drive_impact" | "activity";

const ADVANCED_FILTER_KEYS = ["prn", "attendanceMin", "attendanceMax", "totalHistoricalBacklogsMin", "totalHistoricalBacklogsMax", "profileCompletenessMin", "profileCompletenessMax", "missingResume", "waitingOnStudent", "canAccessResources", "canAccessMockTests", "targetRole", "preferredLocation", "willingToRelocate", "readinessMin", "readinessMax", "eligibleForUpcomingDrive", "isCertified", "hasResume", "isPlaced", "isActive7d", "appliedRecently", "needsIntervention"] as const;
const FILTER_KEYS = ["q", "mode", "view", "batch", "branch", "prn", "cgpaMin", "cgpaMax", "readinessMin", "readinessMax", "attendanceMin", "attendanceMax", "backlogsMin", "backlogsMax", "totalHistoricalBacklogsMin", "totalHistoricalBacklogsMax", "profileCompletenessMin", "profileCompletenessMax", "missingResume", "waitingOnStudent", "canAccessResources", "canAccessMockTests", "targetRole", "preferredLocation", "willingToRelocate", "eligibleForUpcomingDrive", "isCertified", "hasResume", "isPlaced", "isActive7d", "appliedRecently", "needsIntervention", "sortBy", "sortDir"] as const;
const SAVED_VIEW_PARAM_KEYS = ["view", "eligibleForUpcomingDrive", "isCertified", "hasResume", "isActive7d", "appliedRecently", "needsIntervention", "profileCompletenessMin", "profileCompletenessMax", "sortBy", "sortDir"] as const;
const SAVED_VIEWS: Array<{ id: SavedViewId; label: string; description: string }> = [
  { id: "ready_but_inactive", label: "Ready but inactive", description: "Profile-ready students who need a push now." },
  { id: "eligible_but_not_applied", label: "Eligible but not applied", description: "Students who can act on live drives but have not done it yet." },
  { id: "missing_resume", label: "Missing resume", description: "Students blocked by the simplest missing document." },
  { id: "uncertified", label: "Uncertified", description: "Students still blocked by profile certification." },
  { id: "incomplete_profile", label: "Incomplete profile", description: "Students missing required profile data." },
  { id: "needs_mock_push", label: "Needs mock push", description: "Students who need practice activity before near-term drives." },
  { id: "academically_blocked", label: "Academically blocked", description: "Students whose records are blocking upcoming drive access." },
  { id: "all", label: "All students", description: "The full student database without an intervention preset." },
];

const getStringParam = (searchParams: URLSearchParams, key: string) => searchParams.get(key) ?? "";
const getNumberParam = (searchParams: URLSearchParams, key: string) => {
  const raw = searchParams.get(key);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const getBooleanParam = (searchParams: URLSearchParams, key: string) => {
  const raw = searchParams.get(key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
};
const getSavedViewMeta = (viewId: SavedViewId) => SAVED_VIEWS.find((view) => view.id === viewId) ?? SAVED_VIEWS[0];

function applySavedViewPreset(next: URLSearchParams, viewId: SavedViewId) {
  SAVED_VIEW_PARAM_KEYS.forEach((key) => next.delete(key));
  next.set("view", viewId);
  if (viewId === "ready_but_inactive") {
    next.set("hasResume", "true");
    next.set("isCertified", "true");
    next.set("isActive7d", "false");
    next.set("needsIntervention", "true");
    next.set("profileCompletenessMin", "100");
    next.set("sortBy", "upcoming_drive_impact");
    next.set("sortDir", "desc");
  } else if (viewId === "eligible_but_not_applied") {
    next.set("eligibleForUpcomingDrive", "true");
    next.set("appliedRecently", "false");
    next.set("needsIntervention", "true");
    next.set("sortBy", "upcoming_drive_impact");
    next.set("sortDir", "desc");
  } else if (viewId === "missing_resume") {
    next.set("hasResume", "false");
    next.set("sortBy", "risk_score");
    next.set("sortDir", "desc");
  } else if (viewId === "uncertified") {
    next.set("isCertified", "false");
    next.set("sortBy", "risk_score");
    next.set("sortDir", "desc");
  } else if (viewId === "incomplete_profile") {
    next.set("profileCompletenessMax", "99");
    next.set("sortBy", "profile_completeness");
    next.set("sortDir", "asc");
  } else if (viewId === "needs_mock_push") {
    next.set("needsIntervention", "true");
    next.set("sortBy", "risk_score");
    next.set("sortDir", "desc");
  } else if (viewId === "academically_blocked") {
    next.set("hasResume", "true");
    next.set("isCertified", "true");
    next.set("profileCompletenessMin", "100");
    next.set("needsIntervention", "true");
    next.set("eligibleForUpcomingDrive", "false");
    next.set("sortBy", "upcoming_drive_impact");
    next.set("sortDir", "desc");
  } else {
    next.set("sortBy", "created_at");
    next.set("sortDir", "desc");
  }
}

function buildSavedViewBaseline(viewId: SavedViewId) {
  const next = new URLSearchParams();
  next.set("mode", viewId === "all" ? "all" : "ops");
  applySavedViewPreset(next, viewId);
  return next;
}

function matchesSavedView(student: TpoStudentRow, viewId: SavedViewId) {
  if (viewId === "ready_but_inactive") return !student.placementStatus.isPlaced && student.hasResumeReady && student.isProfileCertified && student.profileCompletenessPct >= 100 && !student.isActive7d;
  if (viewId === "eligible_but_not_applied") return !student.placementStatus.isPlaced && student.eligibleUpcomingDriveCount > 0 && !student.appliedRecently;
  if (viewId === "missing_resume") return !student.hasResumeReady;
  if (viewId === "uncertified") return !student.isProfileCertified;
  if (viewId === "incomplete_profile") return student.profileCompletenessPct < 100;
  if (viewId === "needs_mock_push") return student.interventionLabel === "Needs mock push";
  if (viewId === "academically_blocked") return student.interventionLabel === "Academically blocked";
  return true;
}

function statusBadges(student: TpoStudentRow) {
  const badges: Array<{ label: string; variant: "default" | "success" | "warning" | "danger" }> = [];
  if (student.placementStatus.isPlaced) {
    badges.push({ label: `Placed${student.placementStatus.placedCompany ? ` - ${student.placementStatus.placedCompany}` : ""}`, variant: "success" });
  }
  badges.push({ label: student.hasResumeReady ? "Resume ready" : "Resume missing", variant: student.hasResumeReady ? "success" : "warning" });
  badges.push({ label: student.isProfileCertified ? "Certified" : "Uncertified", variant: student.isProfileCertified ? "success" : "warning" });
  badges.push({ label: student.isActive7d ? "Active in 7d" : "Inactive in 7d", variant: student.isActive7d ? "success" : "danger" });
  if (student.eligibleUpcomingDriveCount > 0) badges.push({ label: `${student.eligibleUpcomingDriveCount} upcoming eligible`, variant: "success" });
  else if (student.blockedUpcomingDriveCount > 0) badges.push({ label: `${student.blockedUpcomingDriveCount} blocked`, variant: "warning" });
  return badges;
}

function formatShortDate(value: string | null) {
  if (!value) return "No upcoming drive";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function buildBulkReminderPreset(viewId: SavedViewId) {
  if (viewId === "eligible_but_not_applied") return "eligible-reminder";
  if (viewId === "needs_mock_push" || viewId === "ready_but_inactive") return "mock-test";
  return "profile-completion";
}

function downloadCsv(filename: string, rows: string[][]) {
  const escapeValue = (value: string) => {
    const normalized = String(value ?? "");
    return normalized.includes(",") || normalized.includes("\n") || normalized.includes('"')
      ? `"${normalized.replace(/"/g, '""')}"`
      : normalized;
  };
  const csv = rows.map((row) => row.map(escapeValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
export default function TpoStudentsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);

  useEffect(() => {
    if (!searchParams.has("mode") && !searchParams.has("view")) {
      const next = new URLSearchParams(searchParams);
      next.set("mode", "ops");
      applySavedViewPreset(next, "ready_but_inactive");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const mode = (getStringParam(searchParams, "mode") || "ops") as PageMode;
  const currentView = (getStringParam(searchParams, "view") || (mode === "ops" ? "ready_but_inactive" : "all")) as SavedViewId;
  const baselineParams = useMemo(() => buildSavedViewBaseline(currentView), [currentView]);
  const hasCustomFilters = useMemo(
    () => FILTER_KEYS.some((key) => key !== "mode" && key !== "view" && (searchParams.get(key) ?? null) !== (baselineParams.get(key) ?? null)),
    [baselineParams, searchParams],
  );
  const hasCustomAdvancedFilters = useMemo(
    () => ADVANCED_FILTER_KEYS.some((key) => (searchParams.get(key) ?? null) !== (baselineParams.get(key) ?? null)),
    [baselineParams, searchParams],
  );

  useEffect(() => {
    if (hasCustomFilters) {
      setFiltersOpen(true);
    }
    if (hasCustomAdvancedFilters) {
      setFiltersOpen(true);
      setAdvancedOpen(true);
    }
  }, [hasCustomAdvancedFilters, hasCustomFilters]);

  const query = useMemo(() => ({
    q: getStringParam(searchParams, "q") || undefined,
    batch: getStringParam(searchParams, "batch") || undefined,
    branch: getStringParam(searchParams, "branch") || undefined,
    prn: getStringParam(searchParams, "prn") || undefined,
    cgpaMin: getNumberParam(searchParams, "cgpaMin"),
    cgpaMax: getNumberParam(searchParams, "cgpaMax"),
    readinessMin: getNumberParam(searchParams, "readinessMin"),
    readinessMax: getNumberParam(searchParams, "readinessMax"),
    attendanceMin: getNumberParam(searchParams, "attendanceMin"),
    attendanceMax: getNumberParam(searchParams, "attendanceMax"),
    backlogsMin: getNumberParam(searchParams, "backlogsMin"),
    backlogsMax: getNumberParam(searchParams, "backlogsMax"),
    totalHistoricalBacklogsMin: getNumberParam(searchParams, "totalHistoricalBacklogsMin"),
    totalHistoricalBacklogsMax: getNumberParam(searchParams, "totalHistoricalBacklogsMax"),
    profileCompletenessMin: getNumberParam(searchParams, "profileCompletenessMin"),
    profileCompletenessMax: getNumberParam(searchParams, "profileCompletenessMax"),
    missingResume: getBooleanParam(searchParams, "missingResume"),
    waitingOnStudent: getBooleanParam(searchParams, "waitingOnStudent"),
    canAccessResources: getBooleanParam(searchParams, "canAccessResources"),
    canAccessMockTests: getBooleanParam(searchParams, "canAccessMockTests"),
    targetRole: getStringParam(searchParams, "targetRole") || undefined,
    preferredLocation: getStringParam(searchParams, "preferredLocation") || undefined,
    willingToRelocate: getBooleanParam(searchParams, "willingToRelocate"),
    eligibleForUpcomingDrive: getBooleanParam(searchParams, "eligibleForUpcomingDrive"),
    isCertified: getBooleanParam(searchParams, "isCertified"),
    hasResume: getBooleanParam(searchParams, "hasResume"),
    isPlaced: getBooleanParam(searchParams, "isPlaced"),
    isActive7d: getBooleanParam(searchParams, "isActive7d"),
    appliedRecently: getBooleanParam(searchParams, "appliedRecently"),
    needsIntervention: getBooleanParam(searchParams, "needsIntervention"),
    sortBy: (getStringParam(searchParams, "sortBy") || (mode === "ops" ? "upcoming_drive_impact" : "created_at")) as SortBy,
    sortDir: (getStringParam(searchParams, "sortDir") || "desc") as "asc" | "desc",
    limit: 200,
  }), [mode, searchParams]);

  const { data, error, isLoading } = useTpoStudents(query);

  const updateParams = (updates: Record<string, string | number | boolean | null | undefined>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") next.delete(key);
      else next.set(key, String(value));
    });
    setSearchParams(next, { replace: true });
  };

  const setMode = (nextMode: PageMode) => {
    const next = new URLSearchParams(searchParams);
    next.set("mode", nextMode);
    applySavedViewPreset(next, nextMode === "ops" ? (currentView === "all" ? "ready_but_inactive" : currentView) : "all");
    setSearchParams(next, { replace: true });
  };

  const setSavedView = (viewId: SavedViewId) => {
    const next = new URLSearchParams(searchParams);
    next.set("mode", viewId === "all" ? "all" : "ops");
    applySavedViewPreset(next, viewId);
    setSearchParams(next, { replace: true });
  };

  const resetFilters = () => {
    const next = new URLSearchParams(searchParams);
    FILTER_KEYS.forEach((key) => next.delete(key));
    next.set("mode", "ops");
    applySavedViewPreset(next, "ready_but_inactive");
    setSearchParams(next, { replace: true });
    setFiltersOpen(false);
    setAdvancedOpen(false);
  };

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string }> = [];
    const isCustom = (key: string) => (searchParams.get(key) ?? null) !== (baselineParams.get(key) ?? null);
    if (query.q && isCustom("q")) chips.push({ key: "q", label: `Search: ${query.q}` });
    if (query.batch && isCustom("batch")) chips.push({ key: "batch", label: `Batch: ${query.batch}` });
    if (query.branch && isCustom("branch")) chips.push({ key: "branch", label: `Branch: ${query.branch}` });
    if (query.prn && isCustom("prn")) chips.push({ key: "prn", label: `PRN: ${query.prn}` });
    if (query.cgpaMin !== undefined && isCustom("cgpaMin")) chips.push({ key: "cgpaMin", label: `CGPA >= ${query.cgpaMin}` });
    if (query.cgpaMax !== undefined && isCustom("cgpaMax")) chips.push({ key: "cgpaMax", label: `CGPA <= ${query.cgpaMax}` });
    if (query.readinessMin !== undefined && isCustom("readinessMin")) chips.push({ key: "readinessMin", label: `Readiness >= ${query.readinessMin}` });
    if (query.readinessMax !== undefined && isCustom("readinessMax")) chips.push({ key: "readinessMax", label: `Readiness <= ${query.readinessMax}` });
    if (query.attendanceMin !== undefined && isCustom("attendanceMin")) chips.push({ key: "attendanceMin", label: `Attendance >= ${query.attendanceMin}` });
    if (query.attendanceMax !== undefined && isCustom("attendanceMax")) chips.push({ key: "attendanceMax", label: `Attendance <= ${query.attendanceMax}` });
    if (query.backlogsMin !== undefined && isCustom("backlogsMin")) chips.push({ key: "backlogsMin", label: `Backlogs >= ${query.backlogsMin}` });
    if (query.backlogsMax !== undefined && isCustom("backlogsMax")) chips.push({ key: "backlogsMax", label: `Backlogs <= ${query.backlogsMax}` });
    if (query.profileCompletenessMin !== undefined && isCustom("profileCompletenessMin")) chips.push({ key: "profileCompletenessMin", label: `Profile >= ${query.profileCompletenessMin}%` });
    if (query.profileCompletenessMax !== undefined && isCustom("profileCompletenessMax")) chips.push({ key: "profileCompletenessMax", label: `Profile <= ${query.profileCompletenessMax}%` });
    if (query.hasResume !== undefined && isCustom("hasResume")) chips.push({ key: "hasResume", label: query.hasResume ? "Resume ready" : "Resume missing" });
    if (query.isPlaced !== undefined && isCustom("isPlaced")) chips.push({ key: "isPlaced", label: query.isPlaced ? "Placed" : "Unplaced" });
    if (query.isCertified !== undefined && isCustom("isCertified")) chips.push({ key: "isCertified", label: query.isCertified ? "Certified" : "Uncertified" });
    if (query.isActive7d !== undefined && isCustom("isActive7d")) chips.push({ key: "isActive7d", label: query.isActive7d ? "Active in 7d" : "Inactive in 7d" });
    if (query.eligibleForUpcomingDrive !== undefined && isCustom("eligibleForUpcomingDrive")) chips.push({ key: "eligibleForUpcomingDrive", label: query.eligibleForUpcomingDrive ? "Eligible upcoming drive" : "No eligible upcoming drive" });
    if (query.appliedRecently !== undefined && isCustom("appliedRecently")) chips.push({ key: "appliedRecently", label: query.appliedRecently ? "Applied recently" : "Not applied recently" });
    if (query.needsIntervention !== undefined && isCustom("needsIntervention")) chips.push({ key: "needsIntervention", label: query.needsIntervention ? "Needs intervention" : "No intervention" });
    if (query.targetRole && isCustom("targetRole")) chips.push({ key: "targetRole", label: `Target role: ${query.targetRole}` });
    if (query.preferredLocation && isCustom("preferredLocation")) chips.push({ key: "preferredLocation", label: `Preferred location: ${query.preferredLocation}` });
    if (query.willingToRelocate !== undefined && isCustom("willingToRelocate")) chips.push({ key: "willingToRelocate", label: query.willingToRelocate ? "Willing to relocate" : "Not willing to relocate" });
    return chips;
  }, [baselineParams, query, searchParams]);

  const items = useMemo(() => (data?.items ?? []).filter((student) => matchesSavedView(student, currentView)), [currentView, data?.items]);
  const selectedStudents = useMemo(() => items.filter((student) => selectedIds.includes(student.id)), [items, selectedIds]);
  const selectedCount = selectedStudents.length;
  const currentViewMeta = getSavedViewMeta(currentView);
  const hasFilters = activeFilterChips.length > 0;
  const automationQueueSummary = useMemo(() => {
    if (currentView === "eligible_but_not_applied") {
      return "Showing students who are eligible for a live drive but have not applied yet.";
    }
    if (currentView === "missing_resume" || currentView === "uncertified" || currentView === "incomplete_profile") {
      return "Showing students blocked by missing resume, certification, or profile completion.";
    }
    if (query.needsIntervention === true || currentView === "ready_but_inactive" || currentView === "needs_mock_push" || currentView === "academically_blocked") {
      return "Showing students who need intervention before they are ready to act on placement opportunities.";
    }
    return "Use these filtered queues to act on students needing intervention.";
  }, [currentView, query.needsIntervention]);
  const expandedStudent = useMemo(
    () => items.find((student) => student.id === expandedStudentId) ?? null,
    [expandedStudentId, items],
  );

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => items.some((student) => student.id === id)));
  }, [items]);

  const toggleSelect = (studentId: string) => setSelectedIds((current) => current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId]);
  const toggleSelectAll = () => setSelectedIds(selectedCount === items.length && items.length > 0 ? [] : items.map((student) => student.id));

  const onBulkReminder = () => {
    if (selectedStudents.length === 0) return;
    const studentIds = selectedStudents.map((student) => student.id).join(",");
    const preset = buildBulkReminderPreset(currentView);
    navigate(`/tpo/communication?mode=email&preset=${encodeURIComponent(preset)}&studentIds=${encodeURIComponent(studentIds)}`);
  };

  const onExportSelected = () => {
    if (selectedStudents.length === 0) return;
    downloadCsv("tpo-selected-students.csv", [["Name", "Email", "PRN", "Roll Number", "Branch", "Batch", "Placed", "Placed Company", "Readiness", "Profile %", "Resume", "Certified", "Active 7d", "Eligible Upcoming", "Blocked Upcoming", "Primary Blocker", "Intervention"], ...selectedStudents.map((student) => [student.fullName, student.email, student.prn, student.rollNumber, student.branch, student.batch, student.placementStatus.isPlaced ? "Yes" : "No", student.placementStatus.placedCompany ?? "", String(student.readinessScore), String(student.profileCompletenessPct), student.hasResumeReady ? "Yes" : "No", student.isProfileCertified ? "Yes" : "No", student.isActive7d ? "Yes" : "No", String(student.eligibleUpcomingDriveCount), String(student.blockedUpcomingDriveCount), student.primaryBlocker ?? "", student.interventionLabel])]);
  };

  const quickMetrics = useMemo(() => ({
    readyNow: items.filter((student) => student.hasResumeReady && student.isProfileCertified && student.profileCompletenessPct >= 100).length,
    intervention: items.filter((student) => student.needsIntervention).length,
    eligibleUpcoming: items.filter((student) => student.eligibleUpcomingDriveCount > 0).length,
    inactive: items.filter((student) => !student.isActive7d).length,
  }), [items]);
  return (
    <section className="tpo-page-shell tpo-students-page tpo-students-ops-shell">
      <TpoWorkspaceHeader
        eyebrow="Students"
        greeting={getTpoGreeting(profile?.full_name ?? "Placement team")}
        title="Work one student queue at a time."
        description="Use filtered queues to act on student cohorts. The selected view below should be the only main student workspace on screen."
        primaryAction={(
          <Link to="/tpo/students/upload"><Button>Bulk Upload Students</Button></Link>
        )}
        secondaryAction={(
          <Button
            variant="secondary"
            onClick={() => {
              if (filtersOpen) {
                setFiltersOpen(false);
                setAdvancedOpen(false);
              } else {
                setFiltersOpen(true);
              }
            }}
          >
            Filters
          </Button>
        )}
        actionMenu={(
          <TpoActionMenu
            items={[
              {
                label: "Show all students",
                onSelect: () => {
                  const next = new URLSearchParams();
                  next.set("mode", "all");
                  applySavedViewPreset(next, "all");
                  setSearchParams(next, { replace: true });
                  setFiltersOpen(false);
                  setAdvancedOpen(false);
                },
              },
              {
                label: "Refresh queue",
                onSelect: async () => {
                  try {
                    await runAutomationNow({ automationType: "unplaced_intervention_refresh" });
                  } catch (runError) {
                    window.alert(runError instanceof Error ? runError.message : "Unable to refresh the automation queue.");
                  }
                },
              },
              { label: "Open upload wizard", href: "/tpo/students/upload" },
            ]}
          />
        )}
      />

      <Card className="tpo-form-card tpo-students-ops-hero">
        <div className="tpo-students-control-head">
          <div className="tpo-students-hero-summary">
            <p className="workspace-eyebrow">Student queue</p>
            <strong>{currentViewMeta.label}</strong>
            <span>{automationQueueSummary}</span>
          </div>
          <div className="tpo-students-count-chip">
            <strong>{items.length}</strong>
            <span>students in this queue</span>
          </div>
        </div>

        <div className="tpo-students-stat-line">
          <span><strong>{quickMetrics.readyNow}</strong> ready now</span>
          <span><strong>{quickMetrics.intervention}</strong> need intervention</span>
          <span><strong>{quickMetrics.eligibleUpcoming}</strong> eligible upcoming</span>
          <span><strong>{quickMetrics.inactive}</strong> inactive in 7d</span>
        </div>

        {filtersOpen ? (
          <>
            <div className="tpo-students-advanced-head">
              <div>
                <h2>Filters</h2>
                <p className="muted-text">Start with the main queue. Open more filters only when you need tighter targeting.</p>
              </div>
              <div className="hero-actions">
                <Button variant="ghost" onClick={resetFilters}>Reset Filters</Button>
                <Button variant="ghost" onClick={() => setAdvancedOpen((current) => !current)}>More Filters</Button>
              </div>
            </div>

            <div className="form-grid tpo-students-primary-grid">
              <label>
                Workspace
                <Select value={mode} onChange={(event) => setMode(event.target.value as PageMode)}>
                  <option value="ops">Intervention mode</option>
                  <option value="all">All students</option>
                </Select>
              </label>
              <label>
                Queue
                <Select value={currentView} onChange={(event) => setSavedView(event.target.value as SavedViewId)}>
                  {SAVED_VIEWS.map((view) => (
                    <option key={view.id} value={view.id}>{view.label}</option>
                  ))}
                </Select>
              </label>
              <label>
                Search
                <Input value={getStringParam(searchParams, "q")} onChange={(event) => updateParams({ q: event.target.value || null })} placeholder="Name, email, roll number, or PRN" />
              </label>
              <label>
                Branch
                <Input value={getStringParam(searchParams, "branch")} onChange={(event) => updateParams({ branch: event.target.value || null })} />
              </label>
              <label>
                Batch
                <Input value={getStringParam(searchParams, "batch")} onChange={(event) => updateParams({ batch: event.target.value || null })} />
              </label>
              <label>
                Sort By
                <Select value={query.sortBy} onChange={(event) => updateParams({ sortBy: event.target.value })}>
                  <option value="created_at">Created At</option>
                  <option value="cgpa">CGPA</option>
                  <option value="readiness_score">Readiness</option>
                  <option value="profile_completeness">Profile Completeness</option>
                  <option value="risk_score">Risk score</option>
                  <option value="upcoming_drive_impact">Upcoming drive impact</option>
                  <option value="activity">Activity</option>
                </Select>
              </label>
              <label>
                Sort Direction
                <Select value={query.sortDir} onChange={(event) => updateParams({ sortDir: event.target.value })}>
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </Select>
              </label>
            </div>

            {advancedOpen ? (
              <div className="form-grid tpo-advanced-filter-grid">
                <label>
                  PRN
                  <Input value={getStringParam(searchParams, "prn")} onChange={(event) => updateParams({ prn: event.target.value || null })} />
                </label>
                <label>
                  Attendance Min
                  <Input type="number" min="0" max="100" value={getStringParam(searchParams, "attendanceMin")} onChange={(event) => updateParams({ attendanceMin: event.target.value || null })} />
                </label>
                <label>
                  Attendance Max
                  <Input type="number" min="0" max="100" value={getStringParam(searchParams, "attendanceMax")} onChange={(event) => updateParams({ attendanceMax: event.target.value || null })} />
                </label>
                <label>
                  Total Backlogs Min
                  <Input type="number" min="0" value={getStringParam(searchParams, "totalHistoricalBacklogsMin")} onChange={(event) => updateParams({ totalHistoricalBacklogsMin: event.target.value || null })} />
                </label>
                <label>
                  Total Backlogs Max
                  <Input type="number" min="0" value={getStringParam(searchParams, "totalHistoricalBacklogsMax")} onChange={(event) => updateParams({ totalHistoricalBacklogsMax: event.target.value || null })} />
                </label>
                <label>
                  Profile % Min
                  <Input type="number" min="0" max="100" value={getStringParam(searchParams, "profileCompletenessMin")} onChange={(event) => updateParams({ profileCompletenessMin: event.target.value || null })} />
                </label>
                <label>
                  Profile % Max
                  <Input type="number" min="0" max="100" value={getStringParam(searchParams, "profileCompletenessMax")} onChange={(event) => updateParams({ profileCompletenessMax: event.target.value || null })} />
                </label>
                <label>
                  Readiness Min
                  <Input type="number" min="0" max="100" value={getStringParam(searchParams, "readinessMin")} onChange={(event) => updateParams({ readinessMin: event.target.value || null })} />
                </label>
                <label>
                  Readiness Max
                  <Input type="number" min="0" max="100" value={getStringParam(searchParams, "readinessMax")} onChange={(event) => updateParams({ readinessMax: event.target.value || null })} />
                </label>
                <label>
                  Placement
                  <Select value={getStringParam(searchParams, "isPlaced")} onChange={(event) => updateParams({ isPlaced: event.target.value || null })}>
                    <option value="">Any</option>
                    <option value="true">Placed</option>
                    <option value="false">Unplaced</option>
                  </Select>
                </label>
                <label>
                  Target Role
                  <Input value={getStringParam(searchParams, "targetRole")} onChange={(event) => updateParams({ targetRole: event.target.value || null })} placeholder="Analyst, GET, developer" />
                </label>
                <label>
                  Preferred Location
                  <Input value={getStringParam(searchParams, "preferredLocation")} onChange={(event) => updateParams({ preferredLocation: event.target.value || null })} placeholder="Pune, Mumbai, Bengaluru" />
                </label>
                <div className="tpo-toggle-grid">
                  <div className="tpo-toggle-row"><span>Resume ready</span><Toggle checked={query.hasResume === true} onChange={(checked) => updateParams({ hasResume: checked ? true : null })} /></div>
                  <div className="tpo-toggle-row"><span>Certified</span><Toggle checked={query.isCertified === true} onChange={(checked) => updateParams({ isCertified: checked ? true : null })} /></div>
                  <div className="tpo-toggle-row"><span>Eligible upcoming drive</span><Toggle checked={query.eligibleForUpcomingDrive === true} onChange={(checked) => updateParams({ eligibleForUpcomingDrive: checked ? true : null })} /></div>
                  <div className="tpo-toggle-row"><span>Active in 7d</span><Toggle checked={query.isActive7d === true} onChange={(checked) => updateParams({ isActive7d: checked ? true : null })} /></div>
                  <div className="tpo-toggle-row"><span>Applied recently</span><Toggle checked={query.appliedRecently === true} onChange={(checked) => updateParams({ appliedRecently: checked ? true : null })} /></div>
                  <div className="tpo-toggle-row"><span>Needs intervention</span><Toggle checked={query.needsIntervention === true} onChange={(checked) => updateParams({ needsIntervention: checked ? true : null })} /></div>
                  <div className="tpo-toggle-row"><span>Waiting on student</span><Toggle checked={query.waitingOnStudent === true} onChange={(checked) => updateParams({ waitingOnStudent: checked ? true : null })} /></div>
                  <div className="tpo-toggle-row"><span>Resources unlocked</span><Toggle checked={query.canAccessResources === true} onChange={(checked) => updateParams({ canAccessResources: checked ? true : null })} /></div>
                  <div className="tpo-toggle-row"><span>Mock Tests unlocked</span><Toggle checked={query.canAccessMockTests === true} onChange={(checked) => updateParams({ canAccessMockTests: checked ? true : null })} /></div>
                  <div className="tpo-toggle-row"><span>Willing to relocate</span><Toggle checked={query.willingToRelocate === true} onChange={(checked) => updateParams({ willingToRelocate: checked ? true : null })} /></div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {activeFilterChips.length > 0 ? (
          <div className="tpo-active-filters">
            {activeFilterChips.map((chip) => (
              <button key={chip.key} type="button" className="resources-filter-chip active" onClick={() => updateParams({ [chip.key]: null })}>
                {chip.label} ×
              </button>
            ))}
          </div>
        ) : null}
      </Card>
      {selectedCount > 0 ? (
        <Card className="tpo-students-bulk-bar">
          <div>
            <strong>{selectedCount}</strong> student{selectedCount === 1 ? "" : "s"} selected
            <p className="muted-text">Use the existing communication flow for reminders or export the current selection for offline follow-up.</p>
          </div>
          <div className="hero-actions">
            <Button onClick={onBulkReminder}>Send reminder</Button>
            <Button variant="secondary" onClick={onExportSelected}>Export selected</Button>
            <Button variant="ghost" onClick={() => setSelectedIds([])}>Clear</Button>
          </div>
        </Card>
      ) : null}

      {isLoading ? <Card className="app-state-card"><p className="muted-text">Loading students...</p></Card> : null}
      {error ? <Card className="app-state-card app-state-card-error"><h2>Unable to load students.</h2></Card> : null}

      {!isLoading && !error ? (
        <Card className="tpo-table-card tpo-students-table-card">
          <div className="tpo-students-table-head">
            <div>
              <p className="muted-text">Showing {items.length} student{items.length === 1 ? "" : "s"}{data?.hasMore ? " from the first page of matches" : ""}.</p>
              <h2>{currentViewMeta.label}</h2>
            </div>
            <div className="hero-actions">
              {currentView === "needs_mock_push" ? (
                <Link to="/tpo/students?mode=ops&view=needs_mock_push">
                  <Button variant="secondary">Open full queue</Button>
                </Link>
              ) : null}
              <Button variant="secondary" onClick={toggleSelectAll}>{selectedCount === items.length && items.length > 0 ? "Clear page" : "Select page"}</Button>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="app-state-card">
              <h2>{hasFilters ? "No students matched the current filters" : "No students found yet"}</h2>
              <p className="muted-text">{hasFilters ? "Try removing a few filters or reset the view to widen the search." : "Upload or seed student records to start using the TPO student workspace."}</p>
            </div>
          ) : (
            <>
              <div className="tpo-student-mobile-list">
                {items.map((student) => {
                  const expanded = expandedStudentId === student.id;
                  return (
                    <article key={student.id} className="tpo-student-mobile-card">
                      <div className="tpo-student-mobile-card-head">
                        <div>
                          <strong>{student.fullName}</strong>
                          <p>{student.branch} • {student.batch}</p>
                        </div>
                        <input type="checkbox" checked={selectedIds.includes(student.id)} onChange={() => toggleSelect(student.id)} />
                      </div>
                      <div className="tpo-student-mobile-metrics">
                        <div><span>Readiness</span><strong>{student.readinessScore.toFixed(1)}%</strong></div>
                        <div><span>Engagement</span><strong>{student.isActive7d ? "Active" : "Inactive"}</strong></div>
                        <div><span>Placement</span><strong>{student.placementStatus.isPlaced ? "Placed" : "Unplaced"}</strong></div>
                        <div><span>Upcoming</span><strong>{student.eligibleUpcomingDriveCount} eligible</strong></div>
                      </div>
                      <div className="tpo-student-status-list">
                        <Badge variant={student.needsIntervention ? "warning" : "success"}>{student.interventionLabel}</Badge>
                        {statusBadges(student).slice(0, 4).map((badge) => (
                          <Badge key={`${student.id}-${badge.label}`} variant={badge.variant}>{badge.label}</Badge>
                        ))}
                      </div>
                      <div className="tpo-student-mobile-sections">
                        <div>
                          <span>Profile gaps</span>
                          <p>{student.primaryBlocker ?? "No major blocker detected"}</p>
                        </div>
                        <div>
                          <span>Intent</span>
                          <p>{student.targetRoles[0] ?? "No target role"} • {student.preferredLocations[0] ?? "No preferred location"}</p>
                        </div>
                      </div>
                      <div className="hero-actions">
                        <button type="button" className="link-button" onClick={() => setExpandedStudentId(expanded ? null : student.id)}>{expanded ? "Close quick view" : "Quick view"}</button>
                        <Link to={`/tpo/students/${student.id}`}>Open student</Link>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="tpo-ranking-table-wrap tpo-student-desktop-table">
              <Table>
                <thead>
                  <tr>
                    <th><input type="checkbox" checked={items.length > 0 && selectedCount === items.length} onChange={toggleSelectAll} /></th>
                    <th>Student</th>
                    <th>Readiness & profile</th>
                    <th>Upcoming drive context</th>
                    <th>Operational status</th>
                    <th>Intent</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((student) => {
                    const expanded = expandedStudentId === student.id;
                    return (
                      <tr key={student.id}>
                        <td><input type="checkbox" checked={selectedIds.includes(student.id)} onChange={() => toggleSelect(student.id)} /></td>
                        <td>
                          <div className="tpo-student-cell-stack">
                            <strong>{student.fullName}</strong>
                            <span>{student.email}</span>
                            <span>{student.prn || student.rollNumber || "No PRN / roll number"}</span>
                          </div>
                        </td>
                        <td>
                          <div className="tpo-student-cell-stack tpo-student-readiness-stack">
                            <strong>{student.readinessScore.toFixed(1)}% readiness</strong>
                            <span>Profile {student.profileCompletenessPct}% • CGPA {student.cgpa.toFixed(2)} • Backlogs {student.backlogs}</span>
                            <span>Risk score {student.riskScore} • {student.mockAttempts30d} mock{student.mockAttempts30d === 1 ? "" : "s"} in 30d</span>
                          </div>
                        </td>
                        <td>
                          <div className="tpo-student-cell-stack">
                            <strong>{student.eligibleUpcomingDriveCount} eligible • {student.blockedUpcomingDriveCount} blocked</strong>
                            <span>{formatShortDate(student.nearestUpcomingDriveDate)}</span>
                            <span>{student.primaryBlocker ?? "No major blocker detected"}</span>
                          </div>
                        </td>
                        <td>
                          <div className="tpo-student-ops-stack">
                            <Badge variant={student.needsIntervention ? "warning" : "success"}>{student.interventionLabel}</Badge>
                            <div className="tpo-student-status-list">
                              {statusBadges(student).map((badge) => (
                                <Badge key={`${student.id}-${badge.label}`} variant={badge.variant}>{badge.label}</Badge>
                              ))}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="tpo-student-cell-stack">
                            <strong>{student.targetRoles[0] ?? "No target role"}</strong>
                            <span>{student.preferredLocations[0] ?? "No preferred location"}</span>
                            <span>{student.willingToRelocate === null ? "Relocation unset" : student.willingToRelocate ? "Open to relocate" : "Prefers fixed location"}</span>
                          </div>
                        </td>
                        <td>
                          <div className="tpo-student-actions">
                            <button type="button" className="link-button" onClick={() => setExpandedStudentId(expanded ? null : student.id)}>{expanded ? "Close quick view" : "Quick view"}</button>
                            <Link to={`/tpo/students/${student.id}`}>Open</Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              </div>
            </>
          )}
        </Card>
      ) : null}
      {expandedStudent ? (
        <>
          <button type="button" className="tpo-student-drawer-backdrop" aria-label="Close quick view" onClick={() => setExpandedStudentId(null)} />
          <aside className="tpo-student-drawer" aria-label="Student quick intervention drawer">
            <div className="tpo-student-drawer-head">
              <div>
                <p className="workspace-eyebrow">Quick Intervention View</p>
                <h2>{expandedStudent.fullName}</h2>
                <p className="muted-text">Fast triage snapshot. Use the full student page for deeper edits and complete drive history.</p>
              </div>
              <Button variant="ghost" onClick={() => setExpandedStudentId(null)}>Close</Button>
            </div>
            <div className="tpo-student-drawer-grid">
              <div>
                <strong>Drive context</strong>
                <p>{expandedStudent.eligibleUpcomingDriveCount} upcoming eligible • {expandedStudent.blockedUpcomingDriveCount} blocked</p>
                <p>{expandedStudent.nearestUpcomingDriveDate ? `Nearest drive: ${formatShortDate(expandedStudent.nearestUpcomingDriveDate)}` : "No upcoming drive context yet"}</p>
              </div>
              <div>
                <strong>Profile blockers</strong>
                <p>{expandedStudent.primaryBlocker ?? "No profile blocker"}</p>
                <p>{expandedStudent.isProfileCertified ? "Certified" : "Needs certification"} • {expandedStudent.hasResumeReady ? "Resume ready" : "Resume missing"}</p>
              </div>
              <div>
                <strong>Recent activity</strong>
                <p>{expandedStudent.isActive7d ? "Active in the last 7 days" : "No activity in the last 7 days"}</p>
                <p>{expandedStudent.lastMockSubmittedAt ? `Last mock: ${formatShortDate(expandedStudent.lastMockSubmittedAt)}` : "No recent mock attempt"}</p>
              </div>
              <div>
                <strong>Next action</strong>
                <p>{expandedStudent.interventionLabel}</p>
                <p>{expandedStudent.appliedRecently ? "Applied to a drive recently" : "No recent drive application"}</p>
              </div>
            </div>
            <div className="tpo-student-drawer-meta">
              <Badge variant={expandedStudent.needsIntervention ? "warning" : "success"}>{expandedStudent.interventionLabel}</Badge>
              <Badge variant={expandedStudent.isActive7d ? "success" : "danger"}>{expandedStudent.isActive7d ? "Active in 7d" : "Inactive in 7d"}</Badge>
              <Badge variant={expandedStudent.hasResumeReady ? "success" : "warning"}>{expandedStudent.hasResumeReady ? "Resume ready" : "Resume missing"}</Badge>
              <Badge variant={expandedStudent.isProfileCertified ? "success" : "warning"}>{expandedStudent.isProfileCertified ? "Certified" : "Uncertified"}</Badge>
            </div>
            <div className="hero-actions">
              <Link to={`/tpo/students/${expandedStudent.id}`}>
                <Button>Open Student</Button>
              </Link>
              <Button variant="secondary" onClick={() => {
                setSelectedIds([expandedStudent.id]);
                setExpandedStudentId(null);
              }}>Select for bulk action</Button>
            </div>
          </aside>
        </>
      ) : null}
    </section>
  );
}

