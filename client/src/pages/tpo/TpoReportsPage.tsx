import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Badge, Button, Input, Select, Table, Tabs } from "../../components/ui";
import { downloadReport, type ReportFilters, type ReportType, useReportPreview, useReportTemplates } from "../../hooks/use-reports";

type ReportGroup = "Must-have Reports" | "Compliance / Evidence" | "Operational Tracking" | "Exports";

const groupTabs: Array<{ id: ReportGroup; label: string }> = [
  { id: "Must-have Reports", label: "Must-have" },
  { id: "Compliance / Evidence", label: "Compliance" },
  { id: "Operational Tracking", label: "Operations" },
  { id: "Exports", label: "Exports" },
];

const defaultReportByGroup: Record<ReportGroup, ReportType> = {
  "Must-have Reports": "final_placement_statistics",
  "Compliance / Evidence": "naac_5_2_progression",
  "Operational Tracking": "branch_wise_placement_analysis",
  "Exports": "placement_brochure_pack",
};

const reportGroupByType: Record<ReportType, ReportGroup> = {
  drive_completion_summary: "Must-have Reports",
  weekly_placement_status: "Must-have Reports",
  monthly_branch_breakdown: "Operational Tracking",
  company_visit_register: "Must-have Reports",
  final_placement_statistics: "Must-have Reports",
  naac_5_2_progression: "Compliance / Evidence",
  branch_wise_placement_analysis: "Operational Tracking",
  placement_brochure_pack: "Exports",
  unplaced_student_action_report: "Operational Tracking",
};

const plannedNextByGroup: Record<ReportGroup, Array<{ title: string; note: string }>> = {
  "Must-have Reports": [],
  "Compliance / Evidence": [
    { title: "Off-Campus Placement Register", note: "Missing now. Needed to track verified off-campus placements for NAAC." },
    { title: "MoU and Recruiter Register", note: "Recommended next. Helpful for NAAC/NBA evidence and recruiter relationship history." },
    { title: "Domain-Relevance Placement Map", note: "NBA-focused addition for engineering colleges. Add later if you target NBA-heavy colleges." },
  ],
  "Operational Tracking": [
    { title: "Offer Letter Collection Status", note: "Recommended next. High-value operational tracker during result season." },
    { title: "Round-wise Attrition Report", note: "Recommended next. Useful for drive funnel analysis and student preparation gaps." },
  ],
  "Exports": [],
};

function isValidGroup(value: string | null): value is ReportGroup {
  return value === "Must-have Reports"
    || value === "Compliance / Evidence"
    || value === "Operational Tracking"
    || value === "Exports";
}

function isValidReportType(value: string | null): value is ReportType {
  return value === "drive_completion_summary"
    || value === "weekly_placement_status"
    || value === "monthly_branch_breakdown"
    || value === "company_visit_register"
    || value === "final_placement_statistics"
    || value === "naac_5_2_progression"
    || value === "branch_wise_placement_analysis"
    || value === "placement_brochure_pack"
    || value === "unplaced_student_action_report";
}

function getFilters(params: URLSearchParams): ReportFilters {
  return {
    preset: (params.get("preset") as ReportFilters["preset"]) ?? "placement_season",
    academicYear: params.get("academicYear") ?? "2025-2026",
    dateFrom: params.get("dateFrom") ?? undefined,
    dateTo: params.get("dateTo") ?? undefined,
    branch: params.get("branch") ?? undefined,
    placementSource: (params.get("placementSource") as ReportFilters["placementSource"]) ?? undefined,
    verificationStatus: (params.get("verificationStatus") as ReportFilters["verificationStatus"]) ?? undefined,
    campusMode: (params.get("campusMode") as ReportFilters["campusMode"]) ?? undefined,
    driveStatus: (params.get("driveStatus") as ReportFilters["driveStatus"]) ?? undefined,
    company: params.get("company") ?? undefined,
    sector: params.get("sector") ?? undefined,
    driveId: params.get("driveId") ?? undefined,
    includeOffCampus: params.get("includeOffCampus") ? params.get("includeOffCampus") === "true" : undefined,
  };
}

export default function TpoReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const templates = useReportTemplates();
  const rawReportType = searchParams.get("reportType");
  const rawGroup = searchParams.get("group");
  const requestedReport: ReportType | null = isValidReportType(rawReportType) ? rawReportType : null;
  const requestedGroup: ReportGroup | null = isValidGroup(rawGroup) ? rawGroup : null;
  const reportOwnedGroup = requestedReport ? reportGroupByType[requestedReport] : null;
  const group = reportOwnedGroup ?? requestedGroup ?? "Must-have Reports";
  const activeReport = requestedReport || defaultReportByGroup[group];
  const filters = getFilters(searchParams);
  const preview = useReportPreview(activeReport, filters);
  const previewData = preview.data;
  const previewError = preview.error instanceof Error ? preview.error.message : null;
  const isPreviewPending = !previewData && !previewError;

  const groupedTemplates = useMemo(
    () => (templates.data ?? []).filter((template) => template.group === group),
    [group, templates.data],
  );

  const updateParam = (key: string, value?: string | boolean) => {
    const next = new URLSearchParams(searchParams);
    if (value === undefined || value === "") next.delete(key);
    else next.set(key, String(value));
    setSearchParams(next);
  };

  return (
    <section className="tpo-reports-shell">
      <header className="tpo-reports-header">
        <div>
          <h1>Reports</h1>
          <p>Choose one report, adjust the time period if needed, then export it.</p>
        </div>
        <div className="hero-actions">
          {previewData ? (
            <>
              <Button onClick={() => downloadReport(activeReport, filters, "xlsx")}>Export Excel</Button>
              <Button variant="secondary" onClick={() => downloadReport(activeReport, filters, "pdf")}>Export PDF</Button>
            </>
          ) : null}
        </div>
      </header>

      <section className="tpo-reports-flow">
        <div className="tpo-reports-block">
          <Tabs
            tabs={groupTabs}
            activeId={group}
            onChange={(id) => {
              const nextGroup = id as ReportGroup;
              const next = new URLSearchParams(searchParams);
              next.set("group", nextGroup);
              next.set("reportType", defaultReportByGroup[nextGroup]);
              setSearchParams(next);
            }}
          />
        </div>

        <div className="tpo-reports-block">
          <div className="tpo-reports-chooser">
            {groupedTemplates.map((template) => {
              const isActive = template.type === activeReport;
              return (
                <button
                  key={template.type}
                  type="button"
                  className={`tpo-report-row ${isActive ? "active" : ""}`.trim()}
                  onClick={() => updateParam("reportType", template.type)}
                >
                  <div>
                    <strong>{template.title}</strong>
                    <span>{template.description}</span>
                  </div>
                  <Badge variant={isActive ? "success" : "default"}>{template.audience}</Badge>
                </button>
              );
            })}
          </div>
        </div>

        {plannedNextByGroup[group].length > 0 ? (
          <div className="tpo-reports-block">
            <div className="tpo-reports-chooser">
              {plannedNextByGroup[group].map((item: { title: string; note: string }) => (
                <div key={item.title} className="tpo-report-row tpo-report-row-muted">
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.note}</span>
                  </div>
                  <Badge variant="warning">Planned next</Badge>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="tpo-reports-block">
          <div className="tpo-reports-filter-bar">
            <label>
              Period
              <Select value={filters.preset ?? "placement_season"} onChange={(event) => updateParam("preset", event.target.value)}>
                <option value="this_week">This Week</option>
                <option value="this_month">This Month</option>
                <option value="placement_season">Placement Season</option>
                <option value="academic_year">Academic Year</option>
                <option value="custom">Custom</option>
              </Select>
            </label>
            <label>
              Academic year
              <Input value={filters.academicYear ?? ""} onChange={(event) => updateParam("academicYear", event.target.value)} />
            </label>
            <label>
              Branch
              <Input value={filters.branch ?? ""} onChange={(event) => updateParam("branch", event.target.value)} placeholder="All" />
            </label>
            <label>
              Company
              <Input value={filters.company ?? ""} onChange={(event) => updateParam("company", event.target.value)} placeholder="All" />
            </label>
            <div className="hero-actions">
              <Button variant="ghost" onClick={() => setShowMoreFilters((current) => !current)}>
                {showMoreFilters ? "Less Filters" : "More Filters"}
              </Button>
              <Button variant="ghost" onClick={() => setSearchParams(new URLSearchParams({ group, reportType: activeReport, preset: "placement_season", academicYear: "2025-2026" }))}>
                Reset
              </Button>
            </div>
          </div>

          {showMoreFilters ? (
            <div className="tpo-reports-filter-bar tpo-reports-filter-bar-more">
              <label>
                Date from
                <Input type="date" value={filters.dateFrom ?? ""} onChange={(event) => updateParam("dateFrom", event.target.value)} />
              </label>
              <label>
                Date to
                <Input type="date" value={filters.dateTo ?? ""} onChange={(event) => updateParam("dateTo", event.target.value)} />
              </label>
              <label>
                Sector
                <Input value={filters.sector ?? ""} onChange={(event) => updateParam("sector", event.target.value)} />
              </label>
              <label>
                Drive status
                <Select value={filters.driveStatus ?? ""} onChange={(event) => updateParam("driveStatus", event.target.value)}>
                  <option value="">All</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
              </label>
              <label>
                Placement source
                <Select value={filters.placementSource ?? ""} onChange={(event) => updateParam("placementSource", event.target.value)}>
                  <option value="">All</option>
                  <option value="on_campus">On campus</option>
                  <option value="off_campus">Off campus</option>
                  <option value="self_reported">Self reported</option>
                </Select>
              </label>
              <label>
                Verification
                <Select value={filters.verificationStatus ?? ""} onChange={(event) => updateParam("verificationStatus", event.target.value)}>
                  <option value="">All</option>
                  <option value="pending">Pending</option>
                  <option value="verified">Verified</option>
                  <option value="rejected">Rejected</option>
                </Select>
              </label>
            </div>
          ) : null}
        </div>

        <div className="tpo-reports-block">
          {isPreviewPending ? (
            <p className="muted-text">Loading report preview...</p>
          ) : preview.error || !previewData ? (
            <div>
              <p className="error-text">Unable to load this report right now.</p>
              {previewError ? <p className="muted-text">{previewError}</p> : null}
            </div>
          ) : (
            <div className="tpo-reports-preview">
              <div className="tpo-reports-preview-head">
                <div>
                  <h2>{previewData.title}</h2>
                  <p>{previewData.reportingPeriod}</p>
                </div>
                <div className="tpo-active-filters">
                  <Badge variant={previewData.ready ? "success" : "warning"}>
                    {previewData.ready ? "Ready to export" : "Needs follow-up"}
                  </Badge>
                </div>
              </div>

              {previewData.summaryMetrics.length > 0 ? (
                <div className="tpo-reports-metric-strip">
                  {previewData.summaryMetrics.map((metric) => (
                    <div key={metric.label}>
                      <span>{metric.label}</span>
                      <strong>{String(metric.value ?? "-")}</strong>
                    </div>
                  ))}
                </div>
              ) : null}

              {previewData.blockers.length > 0 ? (
                <div className="tpo-report-blockers">
                  {previewData.blockers.map((blocker) => (
                    <Badge key={blocker} variant="warning">{blocker}</Badge>
                  ))}
                </div>
              ) : null}

              {previewData.missingData.length > 0 ? (
                <div className="tpo-report-blockers">
                  {previewData.missingData.map((item) => (
                    <Badge key={item.key} variant="danger">{item.label}: {item.count}</Badge>
                  ))}
                </div>
              ) : null}

              <div className="tpo-ranking-table-wrap">
                <Table>
                  <thead>
                    <tr>
                      {previewData.columns.map((column) => (
                        <th key={column}>{column.replace(/_/g, " ")}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.rows.slice(0, 20).map((row, index) => (
                      <tr key={`${previewData.type}_${index}`}>
                        {previewData.columns.map((column) => (
                          <td key={`${index}_${column}`}>{String(row[column] ?? "-")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
