import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

import { Badge, Button, Card, Input, Select, Table, Toggle } from "../../components/ui";
import { useTpoStudents, type TpoStudentRow } from "../../hooks/use-tpo-students";

const ADVANCED_FILTER_KEYS = [
  "prn",
  "attendanceMin",
  "attendanceMax",
  "totalHistoricalBacklogsMin",
  "totalHistoricalBacklogsMax",
  "profileCompletenessMin",
  "profileCompletenessMax",
  "missingResume",
  "waitingOnStudent",
  "canAccessResources",
  "canAccessMockTests",
  "targetRole",
  "preferredLocation",
  "willingToRelocate",
  "readinessMin",
  "readinessMax",
] as const;

const FILTER_KEYS = [
  "q",
  "quick",
  "batch",
  "branch",
  "prn",
  "cgpaMin",
  "cgpaMax",
  "readinessMin",
  "readinessMax",
  "attendanceMin",
  "attendanceMax",
  "backlogsMin",
  "backlogsMax",
  "totalHistoricalBacklogsMin",
  "totalHistoricalBacklogsMax",
  "profileCompletenessMin",
  "profileCompletenessMax",
  "missingResume",
  "waitingOnStudent",
  "canAccessResources",
  "canAccessMockTests",
  "targetRole",
  "preferredLocation",
  "willingToRelocate",
  "sortBy",
  "sortDir",
] as const;

const QUICK_FILTERS = [
  { id: "all", label: "All" },
  { id: "incomplete_profile", label: "Incomplete Profile" },
  { id: "waiting_on_student", label: "Waiting on Student" },
  { id: "missing_resume", label: "Missing Resume" },
  { id: "ready_for_practice", label: "Ready for Practice" },
  { id: "high_readiness", label: "High Readiness" },
  { id: "no_backlogs", label: "No Backlogs" },
] as const;

function getStringParam(searchParams: URLSearchParams, key: string) {
  return searchParams.get(key) ?? "";
}

function getNumberParam(searchParams: URLSearchParams, key: string) {
  const raw = searchParams.get(key);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getBooleanParam(searchParams: URLSearchParams, key: string) {
  const raw = searchParams.get(key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

function statusBadges(student: TpoStudentRow) {
  const badges: Array<{ label: string; variant: "default" | "success" | "warning" | "danger" }> = [];
  if (student.waitingOnStudent) badges.push({ label: "Waiting on student", variant: "warning" });
  if (student.missingResume) badges.push({ label: "Resume missing", variant: "warning" });
  if (student.canAccessResources && student.canAccessMockTests) badges.push({ label: "Practice unlocked", variant: "success" });
  if (badges.length === 0) badges.push({ label: "Stable", variant: "default" });
  return badges;
}

export default function TpoStudentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (ADVANCED_FILTER_KEYS.some((key) => searchParams.has(key))) {
      setAdvancedOpen(true);
    }
  }, [searchParams]);

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
    sortBy: (getStringParam(searchParams, "sortBy") || "created_at") as "cgpa" | "created_at" | "readiness_score" | "profile_completeness",
    sortDir: (getStringParam(searchParams, "sortDir") || "desc") as "asc" | "desc",
    limit: 200,
  }), [searchParams]);

  const { data, error, isLoading } = useTpoStudents(query);

  const updateParams = (updates: Record<string, string | number | boolean | null | undefined>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
    });
    setSearchParams(next, { replace: true });
  };

  const setQuickFilter = (quickId: string) => {
    const next = new URLSearchParams(searchParams);
    const presetKeys = [
      "quick",
      "profileCompletenessMax",
      "waitingOnStudent",
      "missingResume",
      "canAccessResources",
      "canAccessMockTests",
      "readinessMin",
      "backlogsMax",
    ];
    presetKeys.forEach((key) => next.delete(key));

    if (quickId !== "all") {
      next.set("quick", quickId);
    }

    if (quickId === "incomplete_profile") next.set("profileCompletenessMax", "99");
    if (quickId === "waiting_on_student") next.set("waitingOnStudent", "true");
    if (quickId === "missing_resume") next.set("missingResume", "true");
    if (quickId === "ready_for_practice") {
      next.set("canAccessResources", "true");
      next.set("canAccessMockTests", "true");
    }
    if (quickId === "high_readiness") next.set("readinessMin", "70");
    if (quickId === "no_backlogs") next.set("backlogsMax", "0");

    setSearchParams(next, { replace: true });
  };

  const resetFilters = () => {
    const next = new URLSearchParams(searchParams);
    FILTER_KEYS.forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  };

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string }> = [];
    if (query.q) chips.push({ key: "q", label: `Search: ${query.q}` });
    if (query.batch) chips.push({ key: "batch", label: `Batch: ${query.batch}` });
    if (query.branch) chips.push({ key: "branch", label: `Branch: ${query.branch}` });
    if (query.prn) chips.push({ key: "prn", label: `PRN: ${query.prn}` });
    if (query.cgpaMin !== undefined) chips.push({ key: "cgpaMin", label: `CGPA >= ${query.cgpaMin}` });
    if (query.cgpaMax !== undefined) chips.push({ key: "cgpaMax", label: `CGPA <= ${query.cgpaMax}` });
    if (query.readinessMin !== undefined) chips.push({ key: "readinessMin", label: `Readiness >= ${query.readinessMin}` });
    if (query.readinessMax !== undefined) chips.push({ key: "readinessMax", label: `Readiness <= ${query.readinessMax}` });
    if (query.attendanceMin !== undefined) chips.push({ key: "attendanceMin", label: `Attendance >= ${query.attendanceMin}` });
    if (query.attendanceMax !== undefined) chips.push({ key: "attendanceMax", label: `Attendance <= ${query.attendanceMax}` });
    if (query.backlogsMin !== undefined) chips.push({ key: "backlogsMin", label: `Backlogs >= ${query.backlogsMin}` });
    if (query.backlogsMax !== undefined) chips.push({ key: "backlogsMax", label: `Backlogs <= ${query.backlogsMax}` });
    if (query.totalHistoricalBacklogsMin !== undefined) chips.push({ key: "totalHistoricalBacklogsMin", label: `Total backlogs >= ${query.totalHistoricalBacklogsMin}` });
    if (query.totalHistoricalBacklogsMax !== undefined) chips.push({ key: "totalHistoricalBacklogsMax", label: `Total backlogs <= ${query.totalHistoricalBacklogsMax}` });
    if (query.profileCompletenessMin !== undefined) chips.push({ key: "profileCompletenessMin", label: `Profile >= ${query.profileCompletenessMin}%` });
    if (query.profileCompletenessMax !== undefined) chips.push({ key: "profileCompletenessMax", label: `Profile <= ${query.profileCompletenessMax}%` });
    if (query.missingResume !== undefined) chips.push({ key: "missingResume", label: query.missingResume ? "Resume missing" : "Resume present" });
    if (query.waitingOnStudent !== undefined) chips.push({ key: "waitingOnStudent", label: query.waitingOnStudent ? "Waiting on student" : "Not waiting on student" });
    if (query.canAccessResources !== undefined) chips.push({ key: "canAccessResources", label: query.canAccessResources ? "Resources unlocked" : "Resources locked" });
    if (query.canAccessMockTests !== undefined) chips.push({ key: "canAccessMockTests", label: query.canAccessMockTests ? "Mocks unlocked" : "Mocks locked" });
    if (query.targetRole) chips.push({ key: "targetRole", label: `Target role: ${query.targetRole}` });
    if (query.preferredLocation) chips.push({ key: "preferredLocation", label: `Preferred location: ${query.preferredLocation}` });
    if (query.willingToRelocate !== undefined) chips.push({ key: "willingToRelocate", label: query.willingToRelocate ? "Willing to relocate" : "Not willing to relocate" });
    return chips;
  }, [query]);

  const currentQuick = getStringParam(searchParams, "quick") || "all";
  const items = data?.items ?? [];
  const hasFilters = activeFilterChips.length > 0;

  return (
    <section className="dashboard-grid tpo-students-page">
      <Card className="tpo-form-card">
        <div className="tpo-students-header">
          <div>
            <h1>Student Database</h1>
            <p className="muted-text">Search the full list, identify blocked students fast, and focus interventions using real backend filters.</p>
          </div>
          <div className="hero-actions">
            <Link to="/tpo/students/upload">
              <Button>Bulk Upload Students</Button>
            </Link>
            <Button variant="secondary" onClick={resetFilters}>Reset Filters</Button>
          </div>
        </div>

        <div className="form-grid">
          <label>
            Search
            <Input
              value={getStringParam(searchParams, "q")}
              onChange={(event) => updateParams({ q: event.target.value || null })}
              placeholder="Name, email, roll number, or PRN"
            />
          </label>
          <label>
            Batch
            <Input value={getStringParam(searchParams, "batch")} onChange={(event) => updateParams({ batch: event.target.value || null })} />
          </label>
          <label>
            Branch
            <Input value={getStringParam(searchParams, "branch")} onChange={(event) => updateParams({ branch: event.target.value || null })} />
          </label>
          <label>
            CGPA Min
            <Input type="number" min="0" max="10" step="0.1" value={getStringParam(searchParams, "cgpaMin")} onChange={(event) => updateParams({ cgpaMin: event.target.value || null })} />
          </label>
          <label>
            CGPA Max
            <Input type="number" min="0" max="10" step="0.1" value={getStringParam(searchParams, "cgpaMax")} onChange={(event) => updateParams({ cgpaMax: event.target.value || null })} />
          </label>
          <label>
            Backlogs Max
            <Input type="number" min="0" value={getStringParam(searchParams, "backlogsMax")} onChange={(event) => updateParams({ backlogsMax: event.target.value || null })} />
          </label>
          <label>
            Sort By
            <Select value={query.sortBy} onChange={(event) => updateParams({ sortBy: event.target.value })}>
              <option value="created_at">Created At</option>
              <option value="cgpa">CGPA</option>
              <option value="readiness_score">Readiness</option>
              <option value="profile_completeness">Profile Completeness</option>
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

        <div className="tpo-students-quick-row">
          {QUICK_FILTERS.map((filter) => (
            <Button
              key={filter.id}
              variant={currentQuick === filter.id ? "primary" : "secondary"}
              onClick={() => setQuickFilter(filter.id)}
            >
              {filter.label}
            </Button>
          ))}
        </div>

        <div className="tpo-students-advanced-head">
          <div>
            <h2>Advanced Filters</h2>
            <p className="muted-text">Use deeper operational filters when you need profile completion, practice access, or intent-based targeting.</p>
          </div>
          <Button variant="ghost" onClick={() => setAdvancedOpen((current) => !current)}>
            {advancedOpen ? "Hide Advanced" : "Show Advanced"}
          </Button>
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
              Target Role
              <Input value={getStringParam(searchParams, "targetRole")} onChange={(event) => updateParams({ targetRole: event.target.value || null })} placeholder="Analyst, GET, developer" />
            </label>
            <label>
              Preferred Location
              <Input value={getStringParam(searchParams, "preferredLocation")} onChange={(event) => updateParams({ preferredLocation: event.target.value || null })} placeholder="Pune, Mumbai, Bengaluru" />
            </label>
            <div className="tpo-toggle-grid">
              <div className="tpo-toggle-row">
                <span>Missing Resume</span>
                <Toggle checked={query.missingResume === true} onChange={(checked) => updateParams({ missingResume: checked ? true : null })} />
              </div>
              <div className="tpo-toggle-row">
                <span>Waiting on Student</span>
                <Toggle checked={query.waitingOnStudent === true} onChange={(checked) => updateParams({ waitingOnStudent: checked ? true : null })} />
              </div>
              <div className="tpo-toggle-row">
                <span>Resources Unlocked</span>
                <Toggle checked={query.canAccessResources === true} onChange={(checked) => updateParams({ canAccessResources: checked ? true : null })} />
              </div>
              <div className="tpo-toggle-row">
                <span>Mock Tests Unlocked</span>
                <Toggle checked={query.canAccessMockTests === true} onChange={(checked) => updateParams({ canAccessMockTests: checked ? true : null })} />
              </div>
              <div className="tpo-toggle-row">
                <span>Willing to Relocate</span>
                <Toggle checked={query.willingToRelocate === true} onChange={(checked) => updateParams({ willingToRelocate: checked ? true : null })} />
              </div>
            </div>
          </div>
        ) : null}

        {activeFilterChips.length > 0 ? (
          <div className="tpo-active-filters">
            {activeFilterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="resources-filter-chip active"
                onClick={() => updateParams({ [chip.key]: null })}
              >
                {chip.label} ×
              </button>
            ))}
          </div>
        ) : null}
      </Card>

      {isLoading ? <Card className="app-state-card"><p className="muted-text">Loading students...</p></Card> : null}
      {error ? <Card className="app-state-card app-state-card-error"><h2>Unable to load students.</h2></Card> : null}

      {!isLoading && !error ? (
        <Card className="tpo-table-card">
          <div className="tpo-students-table-head">
            <p className="muted-text">
              Showing {items.length} student{items.length === 1 ? "" : "s"}{data?.hasMore ? " from the first page of matches" : ""}.
            </p>
          </div>

          {items.length === 0 ? (
            <div className="app-state-card">
              <h2>{hasFilters ? "No students matched the current filters" : "No students found yet"}</h2>
              <p className="muted-text">
                {hasFilters
                  ? "Try removing a few filters or reset the view to widen the search."
                  : "Upload or seed student records to start using the TPO database."}
              </p>
            </div>
          ) : (
            <div className="tpo-ranking-table-wrap">
              <Table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>PRN / Roll</th>
                    <th>Branch</th>
                    <th>Readiness</th>
                    <th>Profile</th>
                    <th>Status</th>
                    <th>Intent</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((student) => (
                    <tr key={student.id}>
                      <td>
                        <div className="tpo-student-cell-stack">
                          <strong>{student.fullName}</strong>
                          <span>{student.email}</span>
                        </div>
                      </td>
                      <td>
                        <div className="tpo-student-cell-stack">
                          <strong>{student.prn || "No PRN"}</strong>
                          <span>{student.rollNumber || "No roll number"}</span>
                        </div>
                      </td>
                      <td>
                        <div className="tpo-student-cell-stack">
                          <strong>{student.branch}</strong>
                          <span>Batch {student.batch}</span>
                        </div>
                      </td>
                      <td>
                        <div className="tpo-student-cell-stack">
                          <strong>{student.readinessScore.toFixed(1)}%</strong>
                          <span>CGPA {student.cgpa.toFixed(2)} • Backlogs {student.backlogs}</span>
                        </div>
                      </td>
                      <td>
                        <div className="tpo-student-cell-stack">
                          <strong>{student.profileCompletenessPct}%</strong>
                          <span>{student.missingRequiredCount} required field(s) pending</span>
                        </div>
                      </td>
                      <td>
                        <div className="tpo-student-status-list">
                          {statusBadges(student).map((badge) => (
                            <Badge key={`${student.id}-${badge.label}`} variant={badge.variant}>{badge.label}</Badge>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="tpo-student-cell-stack">
                          <strong>{student.targetRoles[0] ?? "No target role"}</strong>
                          <span>{student.preferredLocations[0] ?? "No preferred location"}</span>
                        </div>
                      </td>
                      <td>
                        <Link to={`/tpo/students/${student.id}`}>Open</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>
      ) : null}
    </section>
  );
}
