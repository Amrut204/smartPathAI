import { Link, useParams } from "react-router-dom";
import { useMemo, useState } from "react";

import { TpoActionMenu } from "../../components/composites/TpoActionMenu";
import { TpoSubviewSwitcher } from "../../components/composites/TpoSubviewSwitcher";
import { TpoWorkspaceHeader } from "../../components/composites/TpoWorkspaceHeader";
import { useAuth } from "../../components/providers/AuthProvider";
import { Button, ConfirmActionModal, Input, Select, Table } from "../../components/ui";
import { getTpoGreeting } from "../../config/tpo-workspace";
import { computeDriveEligibility, updateDrive, useDriveAudit, useDriveById, type DriveSummary } from "../../hooks/use-drives";

const lifecycleOptions: Array<{ value: DriveSummary["status"]; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "registration_closed", label: "Registration Closed" },
  { value: "in_process", label: "In Process" },
  { value: "results_pending", label: "Results Pending" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
  { value: "cancelled", label: "Cancelled" },
];

const sections = [
  { id: "overview", label: "Overview" },
  { id: "criteria", label: "Eligibility" },
  { id: "metadata", label: "Visit & Reporting" },
  { id: "status", label: "Status" },
  { id: "snapshots", label: "Snapshot History" },
  { id: "students", label: "Students" },
  { id: "audit", label: "Audit" },
] as const;

type SectionId = (typeof sections)[number]["id"];

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatEventLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function renderAuditSummary(metadata: Record<string, unknown>) {
  const parts = [
    typeof metadata.exportType === "string" ? `Export: ${metadata.exportType}` : null,
    typeof metadata.filename === "string" ? `File: ${metadata.filename}` : null,
    typeof metadata.recipientCount === "number" ? `Recipients: ${metadata.recipientCount}` : null,
    typeof metadata.driveId === "string" ? `Drive: ${metadata.driveId}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" | ") : "No additional metadata captured.";
}

export default function TpoDriveDetailPage() {
  const { profile } = useAuth();
  const { driveId } = useParams();
  const { data, isLoading, error, mutate } = useDriveById(driveId ?? null);
  const { data: auditEntries } = useDriveAudit(driveId ?? null, 12);
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"success" | "error">("success");
  const [pendingExport, setPendingExport] = useState<null | {
    title: string;
    href: string;
    message: string;
  }>(null);
  const [metadata, setMetadata] = useState({
    sectorOrIndustry: "",
    employerFirstName: "",
    employerLastName: "",
    employerDesignation: "",
    employerDepartment: "",
    employerOfficialEmail: "",
    employerPersonalEmail: "",
    employerMobile: "",
    employerOfficeAddress: "",
    ctcMinLpa: "",
    ctcMaxLpa: "",
    ctcFinalLpa: "",
    visitDate: "",
    roundsConducted: "",
    mouStatus: "" as "" | "not_started" | "in_discussion" | "signed" | "not_applicable",
    reportingNotes: "",
  });

  if (isLoading) {
    return <section className="workspace-shell"><div className="workspace-panel"><p className="muted-text">Loading drive...</p></div></section>;
  }

  if (error || !data || !driveId) {
    return <section className="workspace-shell"><div className="workspace-panel workspace-panel-error"><p>Unable to load drive details.</p></div></section>;
  }

  const criteria = data.criteria ?? {};
  const snapshots = data.eligibility?.snapshots ?? [];
  const topMetrics = useMemo(() => [
    { label: "Drive Date", value: data.driveDate || "-" },
    { label: "Status", value: data.status },
    { label: "Eligible Count", value: String(data.eligibleCount ?? 0) },
    {
      label: "Latest Snapshot",
      value: data.eligibility?.latestVersion
        ? `v${data.eligibility.latestVersion}`
        : "Not computed",
    },
    {
      label: "Preview Digest",
      value: data.previewDigest ? "Attached" : "Missing",
    },
  ], [data]);

  const reportSections = [
    { label: "Sector / Industry", value: data.sectorOrIndustry || "-" },
    { label: "Employer First Name", value: data.employerFirstName || "-" },
    { label: "Employer Last Name", value: data.employerLastName || "-" },
    { label: "Employer Designation", value: data.employerDesignation || data.role || "-" },
    { label: "Employer Department", value: data.employerDepartment || "-" },
    { label: "Official E-mail ID", value: data.employerOfficialEmail || "-" },
    { label: "Personal Email ID", value: data.employerPersonalEmail || "-" },
    { label: "Mobile No.", value: data.employerMobile || "-" },
    { label: "Office Address", value: data.employerOfficeAddress || data.reportingNotes || "-" },
    { label: "Visit Date", value: data.visitDate || "-" },
    { label: "CTC Min (LPA)", value: data.ctcMinLpa ?? "-" },
    { label: "CTC Max (LPA)", value: data.ctcMaxLpa ?? "-" },
    { label: "Final CTC (LPA)", value: data.ctcFinalLpa ?? "-" },
    { label: "Rounds Conducted", value: data.roundsConducted.length ? data.roundsConducted.join(", ") : "-" },
    { label: "MoU Status", value: data.mouStatus || "-" },
    { label: "Reporting Notes", value: data.reportingNotes || "-" },
  ];

  const showMessage = (message: string, tone: "success" | "error" = "success") => {
    setStatusTone(tone);
    setStatusMessage(message);
  };

  const onComputeEligibility = async () => {
    setBusy(true);
    setStatusMessage(null);

    try {
      const result = await computeDriveEligibility(driveId);
      await mutate();
      showMessage(`Eligibility snapshot v${result.snapshot.version} saved: ${result.eligibleCount}/${result.totalStudents} eligible.`);
    } catch (computeError) {
      showMessage(computeError instanceof Error ? computeError.message : "Eligibility computation failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const onStatusChange = async (nextStatus: DriveSummary["status"]) => {
    setBusy(true);
    setStatusMessage(null);

    try {
      await updateDrive(driveId, { status: nextStatus });
      await mutate();
      showMessage(`Drive status updated to ${nextStatus}.`);
    } catch (updateError) {
      showMessage(updateError instanceof Error ? updateError.message : "Status update failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const onSaveMetadata = async () => {
    setBusy(true);
    setStatusMessage(null);

    try {
      await updateDrive(driveId, {
        sectorOrIndustry: (metadata.sectorOrIndustry || data.sectorOrIndustry || "").trim() || undefined,
        employerFirstName: (metadata.employerFirstName || data.employerFirstName || "").trim() || undefined,
        employerLastName: (metadata.employerLastName || data.employerLastName || "").trim() || undefined,
        employerDesignation: (metadata.employerDesignation || data.employerDesignation || "").trim() || undefined,
        employerDepartment: (metadata.employerDepartment || data.employerDepartment || "").trim() || undefined,
        employerOfficialEmail: (metadata.employerOfficialEmail || data.employerOfficialEmail || "").trim() || undefined,
        employerPersonalEmail: (metadata.employerPersonalEmail || data.employerPersonalEmail || "").trim() || undefined,
        employerMobile: (metadata.employerMobile || data.employerMobile || "").trim() || undefined,
        employerOfficeAddress: (metadata.employerOfficeAddress || data.employerOfficeAddress || "").trim() || undefined,
        ctcMinLpa: (metadata.ctcMinLpa || (data.ctcMinLpa ?? "").toString()).trim() ? Number(metadata.ctcMinLpa || data.ctcMinLpa) : undefined,
        ctcMaxLpa: (metadata.ctcMaxLpa || (data.ctcMaxLpa ?? "").toString()).trim() ? Number(metadata.ctcMaxLpa || data.ctcMaxLpa) : undefined,
        ctcFinalLpa: (metadata.ctcFinalLpa || (data.ctcFinalLpa ?? "").toString()).trim() ? Number(metadata.ctcFinalLpa || data.ctcFinalLpa) : undefined,
        visitDate: metadata.visitDate || data.visitDate || undefined,
        roundsConducted: (metadata.roundsConducted || data.roundsConducted.join(", "))
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        mouStatus: metadata.mouStatus || data.mouStatus,
        reportingNotes: (metadata.reportingNotes || data.reportingNotes || "").trim() || undefined,
      });
      await mutate();
      showMessage("Drive reporting metadata saved.");
    } catch (updateError) {
      showMessage(updateError instanceof Error ? updateError.message : "Unable to save metadata", "error");
    } finally {
      setBusy(false);
    }
  };

  const confirmExport = () => {
    if (!pendingExport) return;
    window.location.assign(pendingExport.href);
    showMessage(`${pendingExport.title} started for ${data.company}.`);
    setPendingExport(null);
  };

  return (
    <section className="workspace-shell tpo-drive-detail-page">
      <TpoWorkspaceHeader
        eyebrow="Drive Operations"
        greeting={getTpoGreeting(profile?.full_name ?? "Placement team")}
        title={`${data.company}${data.role ? ` - ${data.role}` : ""}`}
        description="Keep this drive explainable and operational without burying core actions inside oversized cards."
        primaryAction={(
          <Button disabled={busy} onClick={onComputeEligibility}>
            {busy ? "Computing..." : "Compute Eligibility"}
          </Button>
        )}
        secondaryAction={(
          <Link to={`/tpo/drives/${data.id}/results`}>
            <Button variant="secondary">Manage Results</Button>
          </Link>
        )}
        actionMenu={(
          <TpoActionMenu
            items={[
              {
                label: "Export eligible CSV",
                onSelect: () =>
                  setPendingExport({
                    title: "Eligible CSV export",
                    href: `/api/v1/drives/${data.id}/export?format=csv`,
                    message: `This will export the latest eligible-student list for ${data.company}.`,
                  }),
              },
              {
                label: "Download summary PDF",
                onSelect: () =>
                  setPendingExport({
                    title: "Drive summary PDF",
                    href: `/api/v1/drives/${data.id}/export?format=pdf`,
                    message: `This will generate the current drive summary PDF for ${data.company}.`,
                  }),
              },
              {
                label: "Export resumes",
                onSelect: () =>
                  setPendingExport({
                    title: "Resume export",
                    href: `/api/v1/drives/${data.id}/export/resumes`,
                    message: `This will download the current resume bundle for applicants in ${data.company}.`,
                  }),
              },
              { label: "Open reports", href: `/tpo/reports?group=Must-have+Reports&reportType=drive_completion_summary&driveId=${data.id}` },
            ]}
          />
        )}
      />

      <div className="workspace-context-strip">
        <strong>{data.company}{data.role ? ` - ${data.role}` : ""}</strong>
        <span>Drive date {data.driveDate}</span>
        <span>Eligible {data.eligibleCount}</span>
        <span>
          Snapshot {data.eligibility?.latestVersion ? `v${data.eligibility.latestVersion}` : "Not computed"}
        </span>
      </div>

      <TpoSubviewSwitcher
        label="Drive sections"
        items={sections.map((section) => ({ id: section.id, label: section.label }))}
        activeId={activeSection}
        onChange={(next) => setActiveSection(next as SectionId)}
      />

      {statusMessage ? (
        <p className={statusTone === "success" ? "success-text" : "error-text"}>{statusMessage}</p>
      ) : null}

      {activeSection === "overview" ? (
        <div className="workspace-panel">
          <div className="workspace-metrics-grid">
            {topMetrics.map((metric) => (
              <div key={metric.label} className="workspace-metric">
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>

          <div className="workspace-split-grid">
            <div className="workspace-block">
              <h2>Drive Snapshot</h2>
              <dl className="workspace-definition-grid">
                <div><dt>Latest eligibility snapshot</dt><dd>{data.eligibility?.latestVersion ? `v${data.eligibility.latestVersion} (${formatDate(data.eligibility.lastComputedAt)})` : "Not computed yet"}</dd></div>
                <div><dt>Preview digest</dt><dd>{data.previewDigest ? `${data.previewDigest.slice(0, 12)}...` : "No reviewed preview attached yet"}</dd></div>
                <div><dt>Status</dt><dd>{data.status}</dd></div>
                <div><dt>Eligible students</dt><dd>{data.eligibleCount}</dd></div>
              </dl>
            </div>

            <div className="workspace-block">
              <h2>Operational Note</h2>
              <p className="muted-text">
                Export resumes now falls back to a student's current managed resume when an older application does not have a stored snapshot yet.
              </p>
              <p className="muted-text">
                New applications will still save a true snapshot copy at apply time, which remains the long-term source of truth.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {activeSection === "criteria" ? (
        <div className="workspace-panel">
          <div className="workspace-panel-header">
            <div>
              <h2>Eligibility Criteria</h2>
              <p className="muted-text">These are the active rules currently shaping eligibility decisions for this drive.</p>
            </div>
          </div>
          <dl className="workspace-definition-grid">
            <div><dt>Min CGPA</dt><dd>{criteria.minCgpa ?? "-"}</dd></div>
            <div><dt>Max Active Backlogs</dt><dd>{(criteria.maxActiveBacklogs ?? criteria.maxBacklogs) ?? "-"}</dd></div>
            <div><dt>Max Total Backlogs</dt><dd>{criteria.maxTotalBacklogs ?? "-"}</dd></div>
            <div><dt>Branches</dt><dd>{criteria.branches?.join(", ") ?? "-"}</dd></div>
            <div><dt>Academic Years</dt><dd>{criteria.academicYears && criteria.academicYears.length > 0 ? criteria.academicYears.map((value) => value.replace(/_/g, " ")).join(", ") : "All years"}</dd></div>
            <div><dt>10th Marks Min</dt><dd>{criteria.tenthMarksMin ?? "-"}</dd></div>
            <div><dt>10th Marks Max</dt><dd>{criteria.tenthMarksMax ?? "-"}</dd></div>
            <div><dt>12th Marks Min</dt><dd>{criteria.twelfthMarksMin ?? "-"}</dd></div>
            <div><dt>12th Marks Max</dt><dd>{criteria.twelfthMarksMax ?? "-"}</dd></div>
            <div><dt>Diploma Marks Min</dt><dd>{criteria.diplomaMarksMin ?? "-"}</dd></div>
            <div><dt>Diploma Marks Max</dt><dd>{criteria.diplomaMarksMax ?? "-"}</dd></div>
            <div><dt>Min Attendance</dt><dd>{criteria.minAttendance ?? "-"}</dd></div>
            <div><dt>Min Readiness Score</dt><dd>{criteria.readinessMin ?? "-"}</dd></div>
            <div><dt>Min Profile Completeness</dt><dd>{criteria.profileCompletenessMin ?? "-"}</dd></div>
            <div><dt>Resume Required</dt><dd>{criteria.hasResume === undefined ? "-" : criteria.hasResume ? "Yes" : "No"}</dd></div>
            <div><dt>Profile Certified Required</dt><dd>{criteria.isCertified === undefined ? "-" : criteria.isCertified ? "Yes" : "No"}</dd></div>
            <div><dt>Resource Access Required</dt><dd>{criteria.canAccessResources === undefined ? "-" : criteria.canAccessResources ? "Yes" : "No"}</dd></div>
            <div><dt>Mock Test Access Required</dt><dd>{criteria.canAccessMockTests === undefined ? "-" : criteria.canAccessMockTests ? "Yes" : "No"}</dd></div>
            <div><dt>Exclude Already Placed</dt><dd>{criteria.excludePlacedStudents ? "Yes" : "No"}</dd></div>
          </dl>
        </div>
      ) : null}

      {activeSection === "metadata" ? (
        <div className="workspace-panel">
          <div className="workspace-panel-header">
            <div>
              <h2>Visit & Reporting Metadata</h2>
              <p className="muted-text">Capture the operational data TPOs usually end up chasing in spreadsheets after the visit.</p>
            </div>
          </div>

          <div className="workspace-split-grid">
            <div className="workspace-block">
              <h3>Current Metadata</h3>
              <dl className="workspace-definition-grid">
                {reportSections.map((item) => (
                  <div key={item.label}>
                    <dt>{item.label}</dt>
                    <dd>{String(item.value)}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="workspace-block tpo-form-card">
              <h3>Edit Metadata</h3>
              <div className="form-grid">
                <label>
                  Sector / Industry
                  <Input
                    value={metadata.sectorOrIndustry || data.sectorOrIndustry || ""}
                    onChange={(event) => setMetadata((current) => ({ ...current, sectorOrIndustry: event.target.value }))}
                  />
                </label>
                <label>
                  Employer First Name
                  <Input
                    value={metadata.employerFirstName || data.employerFirstName || ""}
                    onChange={(event) => setMetadata((current) => ({ ...current, employerFirstName: event.target.value }))}
                  />
                </label>
                <label>
                  Employer Last Name
                  <Input
                    value={metadata.employerLastName || data.employerLastName || ""}
                    onChange={(event) => setMetadata((current) => ({ ...current, employerLastName: event.target.value }))}
                  />
                </label>
                <label>
                  Employer Designation
                  <Input
                    value={metadata.employerDesignation || data.employerDesignation || ""}
                    onChange={(event) => setMetadata((current) => ({ ...current, employerDesignation: event.target.value }))}
                  />
                </label>
                <label>
                  Employer Department
                  <Input
                    value={metadata.employerDepartment || data.employerDepartment || ""}
                    onChange={(event) => setMetadata((current) => ({ ...current, employerDepartment: event.target.value }))}
                  />
                </label>
                <label>
                  Official E-mail ID
                  <Input
                    type="email"
                    value={metadata.employerOfficialEmail || data.employerOfficialEmail || ""}
                    onChange={(event) => setMetadata((current) => ({ ...current, employerOfficialEmail: event.target.value }))}
                  />
                </label>
                <label>
                  Personal Email ID
                  <Input
                    type="email"
                    value={metadata.employerPersonalEmail || data.employerPersonalEmail || ""}
                    onChange={(event) => setMetadata((current) => ({ ...current, employerPersonalEmail: event.target.value }))}
                  />
                </label>
                <label>
                  Mobile No.
                  <Input
                    value={metadata.employerMobile || data.employerMobile || ""}
                    onChange={(event) => setMetadata((current) => ({ ...current, employerMobile: event.target.value }))}
                  />
                </label>
                <label>
                  Office Address
                  <Input
                    value={metadata.employerOfficeAddress || data.employerOfficeAddress || ""}
                    onChange={(event) => setMetadata((current) => ({ ...current, employerOfficeAddress: event.target.value }))}
                  />
                </label>
                <label>
                  Visit Date
                  <Input
                    type="date"
                    value={metadata.visitDate || data.visitDate || ""}
                    onChange={(event) => setMetadata((current) => ({ ...current, visitDate: event.target.value }))}
                  />
                </label>
                <label>
                  CTC Min (LPA)
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={metadata.ctcMinLpa || (data.ctcMinLpa ?? "").toString()}
                    onChange={(event) => setMetadata((current) => ({ ...current, ctcMinLpa: event.target.value }))}
                  />
                </label>
                <label>
                  CTC Max (LPA)
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={metadata.ctcMaxLpa || (data.ctcMaxLpa ?? "").toString()}
                    onChange={(event) => setMetadata((current) => ({ ...current, ctcMaxLpa: event.target.value }))}
                  />
                </label>
                <label>
                  Final CTC (LPA)
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={metadata.ctcFinalLpa || (data.ctcFinalLpa ?? "").toString()}
                    onChange={(event) => setMetadata((current) => ({ ...current, ctcFinalLpa: event.target.value }))}
                  />
                </label>
                <label>
                  Rounds Conducted
                  <Input
                    value={metadata.roundsConducted || data.roundsConducted.join(", ")}
                    onChange={(event) => setMetadata((current) => ({ ...current, roundsConducted: event.target.value }))}
                  />
                </label>
                <label>
                  MoU Status
                  <Select
                    value={metadata.mouStatus || data.mouStatus}
                    onChange={(event) => setMetadata((current) => ({ ...current, mouStatus: event.target.value as typeof current.mouStatus }))}
                  >
                    <option value="not_started">Not started</option>
                    <option value="in_discussion">In discussion</option>
                    <option value="signed">Signed</option>
                    <option value="not_applicable">Not applicable</option>
                  </Select>
                </label>
                <label>
                  Reporting Notes
                  <Input
                    value={metadata.reportingNotes || data.reportingNotes || ""}
                    onChange={(event) => setMetadata((current) => ({ ...current, reportingNotes: event.target.value }))}
                  />
                </label>
              </div>
              <div className="hero-actions">
                <Button onClick={onSaveMetadata} disabled={busy}>
                  {busy ? "Saving..." : "Save Metadata"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeSection === "status" ? (
        <div className="workspace-panel">
          <div className="workspace-panel-header">
            <div>
              <h2>Status Controls</h2>
              <p className="muted-text">Changing criteria after review sends the drive back to draft until preview is recomputed.</p>
            </div>
          </div>
          <div className="workspace-block tpo-drive-status-block">
            <Select
              value={data.status}
              onChange={(event) => onStatusChange(event.target.value as DriveSummary["status"])}
              disabled={busy}
            >
              {lifecycleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : null}

      {activeSection === "snapshots" ? (
        <div className="workspace-panel">
          <div className="workspace-panel-header">
            <div>
              <h2>Eligibility Snapshot History</h2>
              <p className="muted-text">Each recompute should leave a defensible history, not just overwrite the last answer.</p>
            </div>
          </div>
          {snapshots.length === 0 ? (
            <p className="muted-text">No eligibility snapshot history yet.</p>
          ) : (
            <div className="workspace-table-wrap">
              <Table>
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Computed At</th>
                    <th>Eligible</th>
                    <th>Ineligible</th>
                    <th>Branch Split</th>
                    <th>Reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((snapshot) => (
                    <tr key={snapshot.id}>
                      <td>v{snapshot.version}</td>
                      <td>{snapshot.computedAt}</td>
                      <td>{snapshot.eligibleCount}/{snapshot.totalStudents}</td>
                      <td>{snapshot.ineligibleCount}</td>
                      <td>
                        {snapshot.branchBreakdown && snapshot.branchBreakdown.length > 0
                          ? snapshot.branchBreakdown.map((item) => `${item.branch}: ${item.eligibleCount}/${item.totalStudents}`).join(" | ")
                          : "-"}
                      </td>
                      <td>
                        {snapshot.reasons.length > 0
                          ? snapshot.reasons.map((reason) => `${reason.label}: ${reason.count}`).join(" | ")
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </div>
      ) : null}

      {activeSection === "students" ? (
        <div className="workspace-panel">
          <div className="workspace-panel-header">
            <div>
              <h2>Tracked Students</h2>
              <p className="muted-text">This table stays flat and readable so TPOs can work from it directly without scanning stacked cards first.</p>
            </div>
          </div>
          <div className="workspace-table-wrap">
            <Table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Branch</th>
                  <th>CGPA</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((student) => (
                  <tr key={student.id}>
                    <td>{student.fullName}</td>
                    <td>{student.email}</td>
                    <td>{student.branch}</td>
                    <td>{student.cgpa.toFixed(2)}</td>
                    <td>{student.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      ) : null}

      {activeSection === "audit" ? (
        <div className="workspace-panel">
          <div className="workspace-panel-header">
            <div>
              <h2>Audit Trail</h2>
              <p className="muted-text">Trace eligibility, exports, releases, and other sensitive drive actions in one place.</p>
            </div>
          </div>
          <div className="tpo-action-list">
            {(auditEntries ?? []).length === 0 ? (
              <p className="muted-text">No audit events are available for this drive yet.</p>
            ) : (
              auditEntries!.map((entry) => (
                <div key={entry.id} className="tpo-action-row">
                  <div>
                    <div className="tpo-action-row-head">
                      <strong>{formatEventLabel(entry.eventType)}</strong>
                      <span className="muted-text">{formatDate(entry.createdAt)}</span>
                    </div>
                    <p className="muted-text">
                      Actor: {entry.actorRole ?? "unknown"}
                      {entry.path ? ` | ${entry.path}` : ""}
                    </p>
                    <p className="muted-text">{renderAuditSummary(entry.metadata)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      <ConfirmActionModal
        open={Boolean(pendingExport)}
        onClose={() => setPendingExport(null)}
        onConfirm={confirmExport}
        title={pendingExport?.title ?? "Confirm export"}
        message={pendingExport?.message ?? "Confirm this export action."}
        confirmLabel="Start export"
        details={[
          `Drive: ${data.company}${data.role ? ` - ${data.role}` : ""}`,
          `Eligible count: ${data.eligibleCount}`,
        ]}
      />
    </section>
  );
}
