import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { TpoActionMenu } from "../../components/composites/TpoActionMenu";
import { TpoSubviewSwitcher } from "../../components/composites/TpoSubviewSwitcher";
import { TpoWorkspaceHeader } from "../../components/composites/TpoWorkspaceHeader";
import { useAuth } from "../../components/providers/AuthProvider";
import { Badge, Button, Input, Select, Table, Tabs } from "../../components/ui";
import { getTpoGreeting } from "../../config/tpo-workspace";
import { useTpoControlCenter } from "../../hooks/use-analytics";
import { extractReportPayload, regenerateScheduledReportRun, useScheduledReportPacks } from "../../hooks/use-tpo-automation";
import {
  createAnnualReportRegisterEntry,
  deleteAnnualReportRegisterEntry,
  downloadReport,
  type AnnualRegisterType,
  type AnnualReportRegisterEntry,
  type ReportFilters,
  type ReportType,
  updateAnnualReportRegisterEntry,
  useAnnualReportRegisterEntries,
  useReportPreview,
  useReportTemplates,
} from "../../hooks/use-reports";

type ReportGroup = "Must-have Reports" | "Compliance / Evidence" | "Operational Tracking" | "Exports";
type ReportsView = "report-browser" | "scheduled-pack" | "export-library";
type AnnualRegisterDraft = {
  branch: string;
  programName: string;
  date: string;
  conductedBy: string;
  studentName: string;
  companyName: string;
  mode: "online" | "offline";
  fromDate: string;
  toDate: string;
  programme: string;
  coursePursuing: string;
  instituteName: string;
  country: string;
  studentCount: string;
  visitDate: string;
};

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
  employer_data_register: "Compliance / Evidence",
  tp_annual_report_workbook: "Compliance / Evidence",
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

const annualRegisterTabs: Array<{ id: AnnualRegisterType; label: string }> = [
  { id: "training_activities", label: "Training Activities" },
  { id: "industrial_inplant_training", label: "Industrial In-Plant Training" },
  { id: "higher_education_abroad", label: "Higher Education Abroad" },
  { id: "industrial_visit", label: "Industrial Visit" },
];

const emptyAnnualRegisterDraft: AnnualRegisterDraft = {
  branch: "",
  programName: "",
  date: "",
  conductedBy: "",
  studentName: "",
  companyName: "",
  mode: "offline",
  fromDate: "",
  toDate: "",
  programme: "B.Tech",
  coursePursuing: "",
  instituteName: "",
  country: "",
  studentCount: "",
  visitDate: "",
};

function annualRegisterTitle(registerType: AnnualRegisterType) {
  return annualRegisterTabs.find((item) => item.id === registerType)?.label ?? registerType;
}

function annualRegisterReason(registerType: AnnualRegisterType) {
  switch (registerType) {
    case "training_activities":
      return "These rows feed the Training Activities sheet in the annual workbook.";
    case "industrial_inplant_training":
      return "These rows feed the Industrial In-Plant Training sheet in the annual workbook.";
    case "higher_education_abroad":
      return "These rows feed the Higher Education Abroad sheet in the annual workbook.";
    case "industrial_visit":
      return "These rows feed the Industrial Visit sheet in the annual workbook.";
  }
}

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
    || value === "unplaced_student_action_report"
    || value === "employer_data_register"
    || value === "tp_annual_report_workbook";
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
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [activeAnnualRegister, setActiveAnnualRegister] = useState<AnnualRegisterType>("training_activities");
  const [annualRegisterDraft, setAnnualRegisterDraft] = useState<AnnualRegisterDraft>(emptyAnnualRegisterDraft);
  const [editingAnnualRegisterId, setEditingAnnualRegisterId] = useState<string | null>(null);
  const [annualRegisterBusy, setAnnualRegisterBusy] = useState(false);
  const scheduledReportsRef = useRef<HTMLDivElement | null>(null);
  const filterPanelRef = useRef<HTMLDivElement | null>(null);
  const previewPanelRef = useRef<HTMLDivElement | null>(null);
  const templates = useReportTemplates();
  const { data: controlCenter } = useTpoControlCenter();
  const scheduledReports = useScheduledReportPacks();
  const rawReportType = searchParams.get("reportType");
  const rawGroup = searchParams.get("group");
  const requestedReport: ReportType | null = isValidReportType(rawReportType) ? rawReportType : null;
  const requestedGroup: ReportGroup | null = isValidGroup(rawGroup) ? rawGroup : null;
  const requestedView = searchParams.get("view");
  const activeView: ReportsView = requestedView === "scheduled-pack" || requestedView === "export-library" || requestedView === "report-browser"
    ? requestedView
    : "report-browser";
  const reportOwnedGroup = requestedReport ? reportGroupByType[requestedReport] : null;
  const group = reportOwnedGroup ?? requestedGroup ?? "Must-have Reports";
  const activeReport = requestedReport || defaultReportByGroup[group];
  const filters = getFilters(searchParams);
  const preview = useReportPreview(activeReport, filters);
  const annualRegisterEntries = useAnnualReportRegisterEntries({
    academicYear: activeReport === "tp_annual_report_workbook" ? (filters.academicYear ?? "2025-2026") : undefined,
    branch: activeReport === "tp_annual_report_workbook" ? filters.branch : undefined,
  });
  const previewData = preview.data;
  const previewError = preview.error instanceof Error ? preview.error.message : null;
  const isPreviewPending = !previewData && !previewError;
  const pilotProof = controlCenter?.pilotProof;
  const pilotProofStrip = controlCenter && pilotProof ? [
    {
      label: "Activation 7d",
      value: `${pilotProof.metrics.activatedStudents7d.pct}%`,
      note: `${pilotProof.metrics.activatedStudents7d.count} students active`,
    },
    {
      label: "Profiles complete",
      value: `${pilotProof.metrics.profileComplete.pct}%`,
      note: `${pilotProof.metrics.profileComplete.count} students complete`,
    },
    {
      label: "Resume ready",
      value: `${pilotProof.metrics.resumeReady.pct}%`,
      note: `${pilotProof.metrics.resumeReady.count} students ready`,
    },
    {
      label: "Drive eligible",
      value: `${pilotProof.metrics.eligibleForUpcoming.pct}%`,
      note: `${pilotProof.metrics.eligibleForUpcoming.count} students eligible`,
    },
    {
      label: "Announcement read rate",
      value: `${pilotProof.metrics.announcementReadRate.pct}%`,
      note: `${pilotProof.metrics.announcementReadRate.readCount}/${pilotProof.metrics.announcementReadRate.recipientCount || 0} reads`,
    },
  ] : [];

  const groupedTemplates = useMemo(
    () => (templates.data ?? []).filter((template) => template.group === group),
    [group, templates.data],
  );
  const activeTemplate = useMemo(
    () => (templates.data ?? []).find((template) => template.type === activeReport) ?? null,
    [activeReport, templates.data],
  );
  const annualEntriesForActiveTab = useMemo(
    () => (annualRegisterEntries.data ?? []).filter((entry) => entry.registerType === activeAnnualRegister),
    [activeAnnualRegister, annualRegisterEntries.data],
  );

  useEffect(() => {
    if (searchParams.get("focus") !== "scheduled-reports") return;
    if (!scheduledReports.data || scheduledReports.data.length === 0) return;
    window.setTimeout(() => {
      scheduledReportsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  }, [scheduledReports.data, searchParams]);

  useEffect(() => {
    const hasActiveFilters = Boolean(
      filters.preset !== "placement_season"
      || filters.academicYear !== "2025-2026"
      || filters.dateFrom
      || filters.dateTo
      || filters.branch
      || filters.company
      || filters.sector
      || filters.driveStatus
      || filters.placementSource
      || filters.verificationStatus
      || filters.campusMode
      || filters.driveId
      || filters.includeOffCampus !== undefined,
    );

    if (hasActiveFilters) {
      setFiltersOpen(true);
    }
  }, [filters]);

  useEffect(() => {
    setAnnualRegisterDraft(emptyAnnualRegisterDraft);
    setEditingAnnualRegisterId(null);
  }, [activeAnnualRegister, filters.academicYear, filters.branch]);

  const updateAnnualDraft = <K extends keyof AnnualRegisterDraft>(key: K, value: AnnualRegisterDraft[K]) => {
    setAnnualRegisterDraft((current) => ({ ...current, [key]: value }));
  };

  const resetAnnualDraft = () => {
    setAnnualRegisterDraft(emptyAnnualRegisterDraft);
    setEditingAnnualRegisterId(null);
  };

  const buildAnnualPayload = (): Record<string, unknown> => {
    const academicYear = filters.academicYear ?? "2025-2026";
    const branch = annualRegisterDraft.branch.trim() || filters.branch || undefined;

    switch (activeAnnualRegister) {
      case "training_activities":
        return {
          registerType: activeAnnualRegister,
          academicYear,
          branch,
          payload: {
            programName: annualRegisterDraft.programName,
            date: annualRegisterDraft.date,
            conductedBy: annualRegisterDraft.conductedBy,
          },
        };
      case "industrial_inplant_training":
        return {
          registerType: activeAnnualRegister,
          academicYear,
          branch,
          payload: {
            studentName: annualRegisterDraft.studentName,
            companyName: annualRegisterDraft.companyName,
            mode: annualRegisterDraft.mode,
            fromDate: annualRegisterDraft.fromDate,
            toDate: annualRegisterDraft.toDate,
            programme: annualRegisterDraft.programme,
          },
        };
      case "higher_education_abroad":
        return {
          registerType: activeAnnualRegister,
          academicYear,
          branch,
          payload: {
            studentName: annualRegisterDraft.studentName,
            programme: annualRegisterDraft.programme,
            coursePursuing: annualRegisterDraft.coursePursuing,
            instituteName: annualRegisterDraft.instituteName,
            country: annualRegisterDraft.country,
          },
        };
      case "industrial_visit":
        return {
          registerType: activeAnnualRegister,
          academicYear,
          branch,
          payload: {
            companyName: annualRegisterDraft.companyName,
            studentCount: Number(annualRegisterDraft.studentCount || 0),
            visitDate: annualRegisterDraft.visitDate,
          },
        };
    }
  };

  const startAnnualRegisterEdit = (entry: AnnualReportRegisterEntry) => {
    const payload = entry.payload as Record<string, string | number>;
    setEditingAnnualRegisterId(entry.id);
    setActiveAnnualRegister(entry.registerType);
    setAnnualRegisterDraft({
      ...emptyAnnualRegisterDraft,
      branch: entry.branch ?? "",
      programName: String(payload.programName ?? ""),
      date: String(payload.date ?? ""),
      conductedBy: String(payload.conductedBy ?? ""),
      studentName: String(payload.studentName ?? ""),
      companyName: String(payload.companyName ?? ""),
      mode: payload.mode === "online" ? "online" : "offline",
      fromDate: String(payload.fromDate ?? ""),
      toDate: String(payload.toDate ?? ""),
      programme: String(payload.programme ?? "B.Tech"),
      coursePursuing: String(payload.coursePursuing ?? ""),
      instituteName: String(payload.instituteName ?? ""),
      country: String(payload.country ?? ""),
      studentCount: payload.studentCount === undefined ? "" : String(payload.studentCount),
      visitDate: String(payload.visitDate ?? ""),
    });
  };

  const saveAnnualRegisterEntry = async () => {
    setAnnualRegisterBusy(true);
    try {
      const payload = buildAnnualPayload();
      if (editingAnnualRegisterId) {
        await updateAnnualReportRegisterEntry(editingAnnualRegisterId, payload);
      } else {
        await createAnnualReportRegisterEntry(payload);
      }
      await preview.mutate();
      resetAnnualDraft();
    } catch (actionError) {
      window.alert(actionError instanceof Error ? actionError.message : "Unable to save the annual report entry.");
    } finally {
      setAnnualRegisterBusy(false);
    }
  };

  const removeAnnualRegisterEntry = async (entryId: string) => {
    if (!window.confirm("Delete this annual report register entry?")) return;
    setAnnualRegisterBusy(true);
    try {
      await deleteAnnualReportRegisterEntry(entryId);
      await preview.mutate();
      if (editingAnnualRegisterId === entryId) {
        resetAnnualDraft();
      }
    } catch (actionError) {
      window.alert(actionError instanceof Error ? actionError.message : "Unable to delete the annual report entry.");
    } finally {
      setAnnualRegisterBusy(false);
    }
  };

  const updateParam = (key: string, value?: string | boolean) => {
    const next = new URLSearchParams(searchParams);
    if (value === undefined || value === "") next.delete(key);
    else next.set(key, String(value));
    setSearchParams(next);
  };

  const scrollToSection = (target: "filters" | "preview" | "scheduled") => {
    const targetRef = target === "filters"
      ? filterPanelRef
      : target === "scheduled"
        ? scheduledReportsRef
        : previewPanelRef;

    window.setTimeout(() => {
      targetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  const openEvidencePack = () => {
    setSearchParams(new URLSearchParams({
      group: "Compliance / Evidence",
      reportType: "naac_5_2_progression",
      preset: "academic_year",
      academicYear: filters.academicYear ?? "2025-2026",
    }));
    scrollToSection("preview");
  };

  return (
    <section className="tpo-reports-shell">
      <TpoWorkspaceHeader
        eyebrow="Reports"
        greeting={getTpoGreeting(profile?.full_name ?? "Placement team")}
        title="Open one report workspace at a time."
        description="Use reports to prove readiness, intervention progress, and placement operations to principals, review committees, and the placement team. The selected report or pack should stay central on screen."
        primaryAction={(
          <Button variant="secondary" onClick={openEvidencePack}>Open NAAC Evidence Pack</Button>
        )}
        secondaryAction={activeView === "report-browser" ? (
          <Button
            onClick={() => {
              if (filtersOpen) {
                setFiltersOpen(false);
                setShowMoreFilters(false);
              } else {
                setFiltersOpen(true);
              }
            }}
          >
            Filters
          </Button>
        ) : undefined}
        actionMenu={(
          <TpoActionMenu
            items={[
              {
                label: "Open report browser",
                onSelect: () => setSearchParams(new URLSearchParams({ ...Object.fromEntries(searchParams.entries()), view: "report-browser" })),
              },
              {
                label: "Open scheduled pack",
                onSelect: () => {
                  const next = new URLSearchParams(searchParams);
                  next.set("view", "scheduled-pack");
                  setSearchParams(next, { replace: true });
                  scrollToSection("scheduled");
                },
              },
              {
                label: "Open export library",
                onSelect: () => {
                  const next = new URLSearchParams(searchParams);
                  next.set("view", "export-library");
                  setSearchParams(next, { replace: true });
                },
              },
              ...(previewData && activeTemplate
                ? activeTemplate.exportFormats.map((format) => ({
                    label: `Export ${format.toUpperCase()}`,
                    onSelect: () => downloadReport(activeReport, filters, format as "xlsx" | "csv" | "pdf"),
                  }))
                : []),
            ]}
          />
        )}
      />

      <TpoSubviewSwitcher
        label="Reports workspace views"
        items={[
          { id: "report-browser", label: "Report Browser" },
          { id: "scheduled-pack", label: "Scheduled Report Pack" },
          { id: "export-library", label: "Export Library" },
        ]}
        activeId={activeView}
        onChange={(next) => {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.set("view", String(next));
          setSearchParams(nextParams, { replace: true });
        }}
      />

      {activeView === "report-browser" && pilotProofStrip.length > 0 ? (
        <section className="tpo-reports-block">
          <div className="workspace-panel-header">
            <div>
              <p className="workspace-eyebrow">Adoption Snapshot</p>
              <h2>Metrics worth carrying into leadership reviews</h2>
            </div>
            <p className="muted-text">These adoption signals explain whether students are activating, becoming ready, and acting on drives. Treat Smart Path activity as engagement evidence, not as a complete measure of capability.</p>
          </div>
          <div className="tpo-reports-metric-strip">
            {pilotProofStrip.map((metric) => (
              <div key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <p className="muted-text">{metric.note}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="tpo-reports-flow">
        {activeView === "scheduled-pack" && scheduledReports.data && scheduledReports.data.length > 0 ? (
          <div ref={scheduledReportsRef} className="tpo-reports-block">
            <div className="workspace-panel-header">
              <div>
                <p className="workspace-eyebrow">Scheduled Report Pack</p>
                <h2>Auto-prepared reports for the placement office</h2>
              </div>
              <p className="muted-text">Download the automatically prepared report pack or export individual reports. These reports are prepared automatically so the placement office can export them quickly.</p>
            </div>
            <div className="tpo-reports-chooser">
              {scheduledReports.data.map((run) => (
                <div key={run.id} className="tpo-report-row">
                  <div>
                    <strong>{String((run.preview as { title?: string }).title ?? "Scheduled Report Pack")}</strong>
                    <span>{run.explanation}</span>
                    <span className="muted-text">
                      Generated {new Date(run.createdAt).toLocaleString()} | {run.items.length} included report{run.items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="tpo-report-row-actions">
                    {run.items.map((item) => {
                      const report = extractReportPayload(item);
                      return (
                        <div key={`${run.id}-${item.id}`} className="tpo-report-download-item">
                          <div>
                            <strong>{report.title}</strong>
                            <span className="muted-text">Ready in Excel, CSV, or PDF</span>
                          </div>
                          <TpoActionMenu
                            label="Download"
                            items={[
                              ...(((templates.data ?? []).find((template) => template.type === report.reportType)?.exportFormats ?? ["xlsx", "csv", "pdf"]).map((format) => ({
                                label: `Download ${format.toUpperCase()}`,
                                onSelect: () => downloadReport(report.reportType, report.filters, format as "xlsx" | "csv" | "pdf"),
                              }))),
                              {
                                label: "Open in report browser",
                                onSelect: () => {
                                  const next = new URLSearchParams(searchParams);
                                  next.set("view", "report-browser");
                                  next.set("group", reportGroupByType[report.reportType]);
                                  next.set("reportType", report.reportType);
                                  setSearchParams(next, { replace: true });
                                  scrollToSection("preview");
                                },
                              },
                            ]}
                          />
                        </div>
                      );
                    })}
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await regenerateScheduledReportRun(run.id);
                        } catch (actionError) {
                          window.alert(actionError instanceof Error ? actionError.message : "Unable to regenerate the scheduled report pack.");
                        }
                      }}
                    >
                      Regenerate pack
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {activeView === "export-library" ? (
          <div className="tpo-reports-block">
            <div className="workspace-panel-header">
              <div>
                <p className="workspace-eyebrow">Export Library</p>
                <h2>Download any report directly</h2>
              </div>
              <p className="muted-text">
                Use this list when you want to jump straight to a specific report. The download buttons use the current filters shown on this page.
              </p>
            </div>
            <div className="tpo-reports-chooser">
              {(templates.data ?? []).map((template) => (
                <div key={template.type} className="tpo-report-row">
                  <div>
                    <strong>{template.title}</strong>
                    <span>{template.description}</span>
                  </div>
                  <div className="tpo-report-row-actions">
                    <Button
                      onClick={() => {
                        const next = new URLSearchParams(searchParams);
                        next.set("group", template.group);
                        next.set("reportType", template.type);
                        setSearchParams(next);
                        scrollToSection("preview");
                      }}
                    >
                      View Report
                    </Button>
                    <TpoActionMenu
                      label="Download"
                      items={template.exportFormats.map((format) => ({
                        label: `Download ${format.toUpperCase()}`,
                        onSelect: () => downloadReport(template.type, filters, format as "xlsx" | "csv" | "pdf"),
                      }))}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {activeView === "report-browser" ? (
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
              scrollToSection("preview");
            }}
          />
        </div>
        ) : null}

        {activeView === "report-browser" ? (
        <div className="tpo-reports-block">
          <div className="tpo-reports-chooser">
            {groupedTemplates.map((template) => {
              const isActive = template.type === activeReport;
              return (
                <button
                  key={template.type}
                  type="button"
                  className={`tpo-report-row ${isActive ? "active" : ""}`.trim()}
                  onClick={() => {
                    updateParam("reportType", template.type);
                    scrollToSection("preview");
                  }}
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
        ) : null}

        {activeView === "report-browser" && plannedNextByGroup[group].length > 0 ? (
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

        {activeView === "report-browser" && filtersOpen ? (
        <div ref={filterPanelRef} className="tpo-reports-block">
          <div className="workspace-panel-header">
            <div>
              <p className="workspace-eyebrow">Filters</p>
              <h2>Adjust the current report view</h2>
              <p className="muted-text">Use the main filters first. Open more filters only when the selected report still needs tighter targeting.</p>
            </div>
            <div className="hero-actions tpo-reports-filter-actions-row">
              <Button
                variant="ghost"
                onClick={() => {
                  setSearchParams(new URLSearchParams({ group, reportType: activeReport, preset: "placement_season", academicYear: "2025-2026" }));
                  setFiltersOpen(false);
                  setShowMoreFilters(false);
                  scrollToSection("preview");
                }}
              >
                Reset Filters
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowMoreFilters((current) => {
                    const next = !current;
                    if (next) {
                      scrollToSection("filters");
                    }
                    return next;
                  });
                }}
              >
                More Filters
              </Button>
            </div>
          </div>

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
        ) : null}

        {activeView === "report-browser" ? (
        <div ref={previewPanelRef} className="tpo-reports-block">
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
        ) : null}

        {activeView === "report-browser" && activeReport === "tp_annual_report_workbook" ? (
          <div className="tpo-reports-block">
            <div className="workspace-panel-header">
              <div>
                <p className="workspace-eyebrow">Annual Workbook Data Capture</p>
                <h2>Keep the college workbook auto-filled</h2>
              </div>
              <p className="muted-text">
                Add or update the structured rows below. These entries directly feed the annual workbook sheets for the selected academic year.
              </p>
            </div>

            <Tabs
              tabs={annualRegisterTabs.map((item) => ({ id: item.id, label: item.label }))}
              activeId={activeAnnualRegister}
              onChange={(id) => setActiveAnnualRegister(id as AnnualRegisterType)}
            />

            <div className="tpo-reports-annual-register-grid">
              <div className="tpo-reports-annual-form">
                <div className="workspace-panel-header">
                  <div>
                    <p className="workspace-eyebrow">{annualRegisterTitle(activeAnnualRegister)}</p>
                    <h2>{editingAnnualRegisterId ? "Edit selected row" : "Add a new row"}</h2>
                  </div>
                  <p className="muted-text">{annualRegisterReason(activeAnnualRegister)}</p>
                </div>

                <div className="tpo-reports-filter-bar">
                  <label>
                    Academic year
                    <Input value={filters.academicYear ?? "2025-2026"} readOnly />
                  </label>
                  <label>
                    Branch
                    <Input value={annualRegisterDraft.branch} onChange={(event) => updateAnnualDraft("branch", event.target.value)} placeholder={filters.branch ?? "Optional"} />
                  </label>
                </div>

                {activeAnnualRegister === "training_activities" ? (
                  <div className="tpo-reports-filter-bar">
                    <label>
                      Program name
                      <Input value={annualRegisterDraft.programName} onChange={(event) => updateAnnualDraft("programName", event.target.value)} />
                    </label>
                    <label>
                      Date
                      <Input type="date" value={annualRegisterDraft.date} onChange={(event) => updateAnnualDraft("date", event.target.value)} />
                    </label>
                    <label>
                      Conducted by
                      <Input value={annualRegisterDraft.conductedBy} onChange={(event) => updateAnnualDraft("conductedBy", event.target.value)} />
                    </label>
                  </div>
                ) : null}

                {activeAnnualRegister === "industrial_inplant_training" ? (
                  <div className="tpo-reports-filter-bar">
                    <label>
                      Student name
                      <Input value={annualRegisterDraft.studentName} onChange={(event) => updateAnnualDraft("studentName", event.target.value)} />
                    </label>
                    <label>
                      Company name
                      <Input value={annualRegisterDraft.companyName} onChange={(event) => updateAnnualDraft("companyName", event.target.value)} />
                    </label>
                    <label>
                      Mode
                      <Select value={annualRegisterDraft.mode} onChange={(event) => updateAnnualDraft("mode", event.target.value as "online" | "offline")}>
                        <option value="offline">Offline</option>
                        <option value="online">Online</option>
                      </Select>
                    </label>
                    <label>
                      From
                      <Input type="date" value={annualRegisterDraft.fromDate} onChange={(event) => updateAnnualDraft("fromDate", event.target.value)} />
                    </label>
                    <label>
                      To
                      <Input type="date" value={annualRegisterDraft.toDate} onChange={(event) => updateAnnualDraft("toDate", event.target.value)} />
                    </label>
                    <label>
                      Programme
                      <Input value={annualRegisterDraft.programme} onChange={(event) => updateAnnualDraft("programme", event.target.value)} />
                    </label>
                  </div>
                ) : null}

                {activeAnnualRegister === "higher_education_abroad" ? (
                  <div className="tpo-reports-filter-bar">
                    <label>
                      Student name
                      <Input value={annualRegisterDraft.studentName} onChange={(event) => updateAnnualDraft("studentName", event.target.value)} />
                    </label>
                    <label>
                      Programme
                      <Input value={annualRegisterDraft.programme} onChange={(event) => updateAnnualDraft("programme", event.target.value)} />
                    </label>
                    <label>
                      Course pursuing
                      <Input value={annualRegisterDraft.coursePursuing} onChange={(event) => updateAnnualDraft("coursePursuing", event.target.value)} />
                    </label>
                    <label>
                      Institute
                      <Input value={annualRegisterDraft.instituteName} onChange={(event) => updateAnnualDraft("instituteName", event.target.value)} />
                    </label>
                    <label>
                      Country
                      <Input value={annualRegisterDraft.country} onChange={(event) => updateAnnualDraft("country", event.target.value)} />
                    </label>
                  </div>
                ) : null}

                {activeAnnualRegister === "industrial_visit" ? (
                  <div className="tpo-reports-filter-bar">
                    <label>
                      Company name
                      <Input value={annualRegisterDraft.companyName} onChange={(event) => updateAnnualDraft("companyName", event.target.value)} />
                    </label>
                    <label>
                      Student count
                      <Input type="number" value={annualRegisterDraft.studentCount} onChange={(event) => updateAnnualDraft("studentCount", event.target.value)} />
                    </label>
                    <label>
                      Visit date
                      <Input type="date" value={annualRegisterDraft.visitDate} onChange={(event) => updateAnnualDraft("visitDate", event.target.value)} />
                    </label>
                  </div>
                ) : null}

                <div className="hero-actions tpo-reports-filter-actions-row">
                  <Button onClick={saveAnnualRegisterEntry} disabled={annualRegisterBusy}>
                    {editingAnnualRegisterId ? "Update entry" : "Save entry"}
                  </Button>
                  <Button variant="ghost" onClick={resetAnnualDraft} disabled={annualRegisterBusy}>
                    Clear form
                  </Button>
                </div>
              </div>

              <div className="tpo-reports-annual-list">
                <div className="workspace-panel-header">
                  <div>
                    <p className="workspace-eyebrow">Current Rows</p>
                    <h2>{annualEntriesForActiveTab.length} row{annualEntriesForActiveTab.length === 1 ? "" : "s"} in this register</h2>
                  </div>
                  <p className="muted-text">
                    These are the saved rows currently feeding the {annualRegisterTitle(activeAnnualRegister)} sheet.
                  </p>
                </div>

                {annualRegisterEntries.error ? (
                  <p className="error-text">Unable to load annual register entries right now.</p>
                ) : annualRegisterEntries.data === undefined ? (
                  <p className="muted-text">Loading annual register entries...</p>
                ) : annualEntriesForActiveTab.length === 0 ? (
                  <p className="muted-text">No saved rows yet for this register. Add the first row from the form.</p>
                ) : (
                  <div className="tpo-ranking-table-wrap">
                    <Table>
                      <thead>
                        <tr>
                          <th>Details</th>
                          <th>Branch</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {annualEntriesForActiveTab.map((entry) => {
                          const payload = entry.payload as Record<string, string | number>;
                          const details = activeAnnualRegister === "training_activities"
                            ? `${String(payload.programName ?? "")} | ${String(payload.date ?? "")} | ${String(payload.conductedBy ?? "")}`
                            : activeAnnualRegister === "industrial_inplant_training"
                              ? `${String(payload.studentName ?? "")} | ${String(payload.companyName ?? "")} | ${String(payload.fromDate ?? "")} to ${String(payload.toDate ?? "")}`
                              : activeAnnualRegister === "higher_education_abroad"
                                ? `${String(payload.studentName ?? "")} | ${String(payload.instituteName ?? "")} | ${String(payload.country ?? "")}`
                                : `${String(payload.companyName ?? "")} | ${String(payload.studentCount ?? "")} students | ${String(payload.visitDate ?? "")}`;

                          return (
                            <tr key={entry.id}>
                              <td>{details}</td>
                              <td>{entry.branch ?? "All Branches"}</td>
                              <td className="tpo-report-row-actions">
                                <Button variant="secondary" onClick={() => startAnnualRegisterEdit(entry)}>Edit</Button>
                                <Button variant="ghost" onClick={() => removeAnnualRegisterEntry(entry.id)}>Delete</Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </section>
  );
}

