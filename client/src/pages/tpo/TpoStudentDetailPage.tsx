import { Link, useParams } from "react-router-dom";
import { useState } from "react";

import { Button, Input, Select } from "../../components/ui";
import { updateDriveResults } from "../../hooks/use-drives";
import { reviewStudentPlacementStatus, reviewStudentUnlockRequest, useTpoStudentAudit, useTpoStudentById } from "../../hooks/use-tpo-students";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "academic-details", label: "Academic Details" },
  { id: "offers", label: "Offers" },
  { id: "declarations", label: "Declarations & Gaps" },
  { id: "activity", label: "Activity" },
  { id: "audit", label: "Audit" },
] as const;

type SectionId = (typeof sections)[number]["id"];

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Pending";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function renderList(items: string[]) {
  if (items.length === 0) return <p className="muted-text">Nothing to review here.</p>;
  return (
    <ul className="dashboard-bullet-list">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}

function formatEventLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function renderAuditSummary(metadata: Record<string, unknown>) {
  const parts = [
    typeof metadata.decision === "string" ? `Decision: ${metadata.decision}` : null,
    typeof metadata.requestId === "string" ? `Request: ${metadata.requestId}` : null,
    typeof metadata.driveId === "string" ? `Drive: ${metadata.driveId}` : null,
    typeof metadata.exportType === "string" ? `Export: ${metadata.exportType}` : null,
    typeof metadata.recipientCount === "number" ? `Recipients: ${metadata.recipientCount}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" | ") : "No additional metadata captured.";
}

export default function TpoStudentDetailPage() {
  const { studentId } = useParams();
  const { data, error, isLoading, mutate } = useTpoStudentById(studentId ?? null);
  const { data: auditEntries } = useTpoStudentAudit(studentId ?? null, 12);
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const [selectedDriveId, setSelectedDriveId] = useState("");
  const [proofStatus, setProofStatus] = useState<string | null>(null);
  const [unlockReviewNote, setUnlockReviewNote] = useState("");
  const [unlockReviewBusy, setUnlockReviewBusy] = useState(false);
  const [placementReviewBusy, setPlacementReviewBusy] = useState(false);
  const [placementReviewDraft, setPlacementReviewDraft] = useState({
    isPlaced: false,
    placedCompany: "",
    placedRole: "",
    placedPackageLpa: "",
    sourceDriveId: "",
    reason: "",
  });
  const [proofDraft, setProofDraft] = useState({
    offerLetterReference: "",
    offerLetterUrl: "",
    designationOffered: "",
    offerDate: "",
    finalCtcLpa: "",
    verificationStatus: "pending",
    joiningStatus: "pending",
    nonPlacementReason: "",
    actionPlan: "",
  });

  if (isLoading) {
    return (
      <section className="workspace-shell">
        <div className="workspace-panel">
          <p className="muted-text">Loading student profile...</p>
        </div>
      </section>
    );
  }

  if (error || !data || !studentId) {
    return (
      <section className="workspace-shell">
        <div className="workspace-panel workspace-panel-error">
          <h1>Unable to load student profile</h1>
        </div>
      </section>
    );
  }

  const selectedDrive = data.driveParticipation.find((entry) => entry.driveId === selectedDriveId) ?? null;
  const unlockRequest = data.unlockRequest;
  const placementStatus = data.placementStatus;
  const engagementSummary = data.engagementSummary;

  const onSaveProof = async () => {
    if (!selectedDrive) {
      setProofStatus("Select a drive first.");
      return;
    }

    setProofStatus(null);
    try {
      await updateDriveResults({
        driveId: selectedDrive.driveId,
        updates: [{
          studentId,
          outcome: selectedDrive.outcome as "pending" | "shortlisted" | "selected" | "rejected",
          registered: selectedDrive.registered ?? undefined,
          appeared: selectedDrive.appeared ?? undefined,
          designationOffered: (proofDraft.designationOffered || selectedDrive.designationOffered || "").trim() || undefined,
          offerDate: proofDraft.offerDate || selectedDrive.offerDate || undefined,
          finalCtcLpa: (proofDraft.finalCtcLpa || (selectedDrive.finalCtcLpa ?? "").toString()).trim()
            ? Number(proofDraft.finalCtcLpa || selectedDrive.finalCtcLpa)
            : undefined,
          offerLetterReference: (proofDraft.offerLetterReference || selectedDrive.offerLetterReference || "").trim() || undefined,
          offerLetterUrl: (proofDraft.offerLetterUrl || selectedDrive.offerLetterUrl || "").trim() || undefined,
          verificationStatus: (proofDraft.verificationStatus || selectedDrive.verificationStatus || "pending") as "pending" | "verified" | "rejected",
          joiningStatus: (proofDraft.joiningStatus || selectedDrive.joiningStatus || "pending") as "pending" | "joined" | "not_joined" | "deferred",
          nonPlacementReason: (proofDraft.nonPlacementReason || selectedDrive.nonPlacementReason || "").trim() || undefined,
          actionPlan: (proofDraft.actionPlan || selectedDrive.actionPlan || "").trim() || undefined,
        }],
      });
      await mutate();
      setProofStatus("Offer details updated.");
    } catch (saveError) {
      setProofStatus(saveError instanceof Error ? saveError.message : "Unable to update offer details");
    }
  };

  const onReviewUnlock = async (decision: "approved" | "denied") => {
    if (!unlockRequest) return;
    setProofStatus(null);
    setUnlockReviewBusy(true);
    try {
      await reviewStudentUnlockRequest({
        studentId,
        requestId: unlockRequest.id,
        decision,
        responseNote: unlockReviewNote.trim() || undefined,
      });
      await mutate();
      setUnlockReviewNote("");
      setProofStatus(`Unlock request ${decision}.`);
    } catch (reviewError) {
      setProofStatus(reviewError instanceof Error ? reviewError.message : "Unable to review unlock request");
    } finally {
      setUnlockReviewBusy(false);
    }
  };

  const onSavePlacementStatus = async (nextPlaced: boolean) => {
    setPlacementReviewBusy(true);
    setProofStatus(null);
    try {
      await reviewStudentPlacementStatus({
        studentId,
        isPlaced: nextPlaced,
        placedCompany: nextPlaced ? (placementReviewDraft.placedCompany || placementStatus.placedCompany || selectedDrive?.company || "").trim() : undefined,
        placedRole: nextPlaced ? (placementReviewDraft.placedRole || placementStatus.placedRole || selectedDrive?.role || "").trim() : undefined,
        placedPackageLpa: nextPlaced
          ? (() => {
              const raw = placementReviewDraft.placedPackageLpa || (placementStatus.placedPackageLpa ?? "").toString();
              return raw ? Number(raw) : undefined;
            })()
          : undefined,
        sourceDriveId: placementReviewDraft.sourceDriveId || placementStatus.sourceDriveId || selectedDrive?.driveId || undefined,
        reason: placementReviewDraft.reason.trim(),
      });
      await mutate();
      setPlacementReviewDraft((current) => ({
        ...current,
        reason: "",
        isPlaced: nextPlaced,
      }));
      setProofStatus(nextPlaced ? "Placement summary updated." : "Placement summary cleared.");
    } catch (placementError) {
      setProofStatus(placementError instanceof Error ? placementError.message : "Unable to review placement summary");
    } finally {
      setPlacementReviewBusy(false);
    }
  };

  const overviewMetrics = [
    { label: "Profile completeness", value: `${Number(data.profileCompletenessPct ?? 0).toFixed(0)}%` },
    { label: "Readiness", value: `${Number(data.readinessScore ?? 0).toFixed(1)}%` },
    { label: "Engagement", value: `${Number(engagementSummary.resourceActiveDays7d ?? 0)} active day(s)` },
    { label: "Resources access", value: data.missingStudentFields.length === 0 ? "Open" : "Blocked until complete" },
    { label: "Mock tests access", value: data.missingStudentFields.length === 0 ? "Open" : "Blocked until complete" },
  ];

  return (
    <section className="workspace-shell">
      <header className="workspace-header">
        <div>
          <p className="workspace-eyebrow">TPO Student Review</p>
          <h1>{String(data.fullName)}</h1>
          <p className="muted-text">
            Students complete their own academic and placement profiles in Smart Path. Use this page to review completion, monitor readiness, and track outcomes.
          </p>
        </div>
        <div className="hero-actions">
          <Link to="/tpo/students">
            <Button variant="secondary">Back to Students</Button>
          </Link>
          <Link to="/tpo/reports">
            <Button variant="ghost">Open Reports</Button>
          </Link>
        </div>
      </header>

      <div className="workspace-context-strip">
        <strong>{data.email}</strong>
        <span>Roll number {data.rollNumber}</span>
        <span>Branch {data.branch}</span>
        <span>Batch {data.batch}</span>
      </div>

      {proofStatus ? <p className={proofStatus.includes("updated") ? "success-text" : "error-text"}>{proofStatus}</p> : null}

      <nav className="workspace-subnav" aria-label="TPO student sections">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={section.id === activeSection ? "workspace-subnav-link is-active" : "workspace-subnav-link"}
            onClick={() => setActiveSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      {activeSection === "overview" ? (
        <div className="workspace-panel">
          <div className="workspace-metrics-grid">
            {overviewMetrics.map((metric) => (
              <div key={metric.label} className="workspace-metric">
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>

          <div className="workspace-split-grid">
            <div className="workspace-block">
              <h2>Engagement Snapshot</h2>
              <p className="muted-text">Use this to judge follow-through inside Smart Path. It supports intervention decisions and does not replace readiness or student capability.</p>
              <dl className="workspace-definition-grid">
                <div><dt>Mock attempts (30d)</dt><dd>{Number(engagementSummary.mockAttempts30d ?? 0)}</dd></div>
                <div><dt>Resource opens (30d)</dt><dd>{Number(engagementSummary.resourceOpens30d ?? 0)}</dd></div>
                <div><dt>Active prep days (7d)</dt><dd>{Number(engagementSummary.resourceActiveDays7d ?? 0)}</dd></div>
                <div><dt>Last mock activity</dt><dd>{formatDateTime(engagementSummary.lastMockSubmittedAt)}</dd></div>
                <div><dt>Last resource activity</dt><dd>{formatDateTime(engagementSummary.lastResourceViewedAt)}</dd></div>
                <div><dt>Last platform activity</dt><dd>{formatDateTime(engagementSummary.lastPlatformActivityAt)}</dd></div>
              </dl>
            </div>

            <div className="workspace-block">
              <h2>Profile details still pending</h2>
              <p className="muted-text">These are the fields the student still needs to complete in their own profile.</p>
              {renderList((Array.isArray(data.missingRequiredFields) ? data.missingRequiredFields : []).map((field) => field.label))}
            </div>
          </div>
        </div>
      ) : null}

      {activeSection === "academic-details" ? (
        <div className="workspace-panel">
          <div className="workspace-panel-header">
            <div>
              <h2>Academic Details</h2>
              <p className="muted-text">This is the academic and eligibility information the student is responsible for keeping current.</p>
            </div>
          </div>

          <dl className="workspace-definition-grid">
            <div><dt>Roll Number</dt><dd>{String(data.rollNumber || "Pending")}</dd></div>
            <div><dt>PRN</dt><dd>{String(data.profileData.prn ?? "Pending")}</dd></div>
            <div><dt>Degree</dt><dd>{String(data.profileData.degree ?? "Pending")}</dd></div>
            <div><dt>Current Semester</dt><dd>{String(data.profileData.currentSemester ?? "Pending")}</dd></div>
            <div><dt>CGPA</dt><dd>{Number(data.cgpa ?? 0).toFixed(2)}</dd></div>
            <div><dt>Backlogs</dt><dd>{Number(data.backlogs ?? 0)}</dd></div>
            <div><dt>Total Historical Backlogs</dt><dd>{Number(data.totalHistoricalBacklogs ?? 0)}</dd></div>
            <div><dt>Attendance %</dt><dd>{Number(data.attendancePct ?? 0).toFixed(1)}</dd></div>
          </dl>
        </div>
      ) : null}

      {activeSection === "offers" ? (
        <div className="workspace-panel">
          <div className="workspace-panel-header">
            <div>
              <h2>Offer Proof Tracker</h2>
              <p className="muted-text">Track placement outcomes and supporting proof without mixing this into student-owned profile fields.</p>
            </div>
          </div>
          <div className="workspace-block" style={{ marginBottom: 16 }}>
            <h3>Placement Summary</h3>
            <p className="muted-text">
              Current student-level placement state used for placed badges and future eligibility checks.
            </p>
            <dl className="workspace-definition-grid">
              <div><dt>Placed</dt><dd>{placementStatus.isPlaced ? "Yes" : "No"}</dd></div>
              <div><dt>Company</dt><dd>{placementStatus.placedCompany ?? "Not set"}</dd></div>
              <div><dt>Role</dt><dd>{placementStatus.placedRole ?? "Not set"}</dd></div>
              <div><dt>Package</dt><dd>{placementStatus.placedPackageLpa != null ? `${placementStatus.placedPackageLpa} LPA` : "Not set"}</dd></div>
              <div><dt>Placed At</dt><dd>{formatDateTime(placementStatus.placedAt)}</dd></div>
              <div><dt>Source Drive</dt><dd>{placementStatus.sourceDriveId ?? "Not set"}</dd></div>
            </dl>
            <div className="form-grid">
              <label>
                <span className="muted-text">Placed Company</span>
                <Input value={placementReviewDraft.placedCompany || placementStatus.placedCompany || ""} onChange={(event) => setPlacementReviewDraft((current) => ({ ...current, placedCompany: event.target.value }))} />
              </label>
              <label>
                <span className="muted-text">Placed Role</span>
                <Input value={placementReviewDraft.placedRole || placementStatus.placedRole || ""} onChange={(event) => setPlacementReviewDraft((current) => ({ ...current, placedRole: event.target.value }))} />
              </label>
              <label>
                <span className="muted-text">Placed Package (LPA)</span>
                <Input type="number" min="0" step="0.1" value={placementReviewDraft.placedPackageLpa || (placementStatus.placedPackageLpa ?? "").toString()} onChange={(event) => setPlacementReviewDraft((current) => ({ ...current, placedPackageLpa: event.target.value }))} />
              </label>
              <label>
                <span className="muted-text">Source Drive</span>
                <Select value={placementReviewDraft.sourceDriveId || placementStatus.sourceDriveId || ""} onChange={(event) => setPlacementReviewDraft((current) => ({ ...current, sourceDriveId: event.target.value }))}>
                  <option value="">Select source drive</option>
                  {data.driveParticipation.map((entry) => (
                    <option key={entry.driveId} value={entry.driveId}>
                      {entry.company} {entry.role ? `(${entry.role})` : ""}
                    </option>
                  ))}
                </Select>
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                <span className="muted-text">Correction reason</span>
                <Input value={placementReviewDraft.reason} onChange={(event) => setPlacementReviewDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Explain why this placement summary is being corrected." />
              </label>
            </div>
            <div className="hero-actions">
              <Button disabled={placementReviewBusy || placementReviewDraft.reason.trim().length < 5} onClick={() => onSavePlacementStatus(true)}>
                Save placement summary
              </Button>
              <Button variant="secondary" disabled={placementReviewBusy || placementReviewDraft.reason.trim().length < 5} onClick={() => onSavePlacementStatus(false)}>
                Clear placement summary
              </Button>
            </div>
          </div>
          <div className="form-grid">
            <label>
              <span className="muted-text">Drive</span>
              <Select value={selectedDriveId} onChange={(event) => setSelectedDriveId(event.target.value)}>
                <option value="">Select drive</option>
                {data.driveParticipation.map((entry) => (
                  <option key={entry.driveId} value={entry.driveId}>
                    {entry.company} {entry.role ? `(${entry.role})` : ""}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              <span className="muted-text">Designation</span>
              <Input value={proofDraft.designationOffered || selectedDrive?.designationOffered || ""} onChange={(event) => setProofDraft((current) => ({ ...current, designationOffered: event.target.value }))} />
            </label>
            <label>
              <span className="muted-text">Offer Date</span>
              <Input type="date" value={proofDraft.offerDate || selectedDrive?.offerDate || ""} onChange={(event) => setProofDraft((current) => ({ ...current, offerDate: event.target.value }))} />
            </label>
            <label>
              <span className="muted-text">Final CTC</span>
              <Input type="number" min="0" step="0.1" value={proofDraft.finalCtcLpa || (selectedDrive?.finalCtcLpa ?? "").toString()} onChange={(event) => setProofDraft((current) => ({ ...current, finalCtcLpa: event.target.value }))} />
            </label>
            <label>
              <span className="muted-text">Offer Letter Reference</span>
              <Input value={proofDraft.offerLetterReference || selectedDrive?.offerLetterReference || ""} onChange={(event) => setProofDraft((current) => ({ ...current, offerLetterReference: event.target.value }))} />
            </label>
            <label>
              <span className="muted-text">Offer Letter URL</span>
              <Input value={proofDraft.offerLetterUrl || selectedDrive?.offerLetterUrl || ""} onChange={(event) => setProofDraft((current) => ({ ...current, offerLetterUrl: event.target.value }))} />
            </label>
            <label>
              <span className="muted-text">Verification</span>
              <Select value={proofDraft.verificationStatus || selectedDrive?.verificationStatus || "pending"} onChange={(event) => setProofDraft((current) => ({ ...current, verificationStatus: event.target.value }))}>
                <option value="pending">pending</option>
                <option value="verified">verified</option>
                <option value="rejected">rejected</option>
              </Select>
            </label>
            <label>
              <span className="muted-text">Joining Status</span>
              <Select value={proofDraft.joiningStatus || selectedDrive?.joiningStatus || "pending"} onChange={(event) => setProofDraft((current) => ({ ...current, joiningStatus: event.target.value }))}>
                <option value="pending">pending</option>
                <option value="joined">joined</option>
                <option value="not_joined">not joined</option>
                <option value="deferred">deferred</option>
              </Select>
            </label>
            <label>
              <span className="muted-text">Non-placement Reason</span>
              <Input value={proofDraft.nonPlacementReason || selectedDrive?.nonPlacementReason || ""} onChange={(event) => setProofDraft((current) => ({ ...current, nonPlacementReason: event.target.value }))} />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              <span className="muted-text">Action Plan</span>
              <Input value={proofDraft.actionPlan || selectedDrive?.actionPlan || ""} onChange={(event) => setProofDraft((current) => ({ ...current, actionPlan: event.target.value }))} />
            </label>
          </div>
          <div className="hero-actions">
            <Button onClick={onSaveProof}>Save Offer Details</Button>
          </div>
        </div>
      ) : null}

      {activeSection === "declarations" ? (
        <div className="workspace-panel">
          <div className="workspace-split-grid">
            <div className="workspace-block">
              <h2>Declaration Status</h2>
              <ul className="dashboard-bullet-list">
                <li>Onboarding declaration: {data.declarationStatus.onboarding.acceptedAt ? formatDateTime(data.declarationStatus.onboarding.acceptedAt) : "Pending"}</li>
                <li>
                  Profile certification: {data.declarationStatus.profileCertification.isCertified
                    ? formatDateTime(data.declarationStatus.profileCertification.acceptedAt)
                    : data.declarationStatus.profileCertification.requiresRecertification
                      ? "Recertification required"
                      : "Pending"}
                </li>
                {data.declarationStatus.profileCertification.invalidationReason ? (
                  <li>{data.declarationStatus.profileCertification.invalidationReason}</li>
                ) : null}
              </ul>
            </div>

            <div className="workspace-block">
              <h2>Waiting on student</h2>
              <p className="muted-text">These are self-service items the student must complete before their profile is fully usable.</p>
              {renderList((Array.isArray(data.missingRequiredFields) ? data.missingRequiredFields : []).map((field) => field.label))}
            </div>
          </div>

          <div className="workspace-block">
            <h2>Profile Unlock Workflow</h2>
            {!unlockRequest ? (
              <p className="muted-text">No profile unlock requests have been submitted by this student yet.</p>
            ) : (
              <div className="workspace-split-grid">
                <div className="workspace-block">
                  <dl className="workspace-definition-grid">
                    <div><dt>Status</dt><dd>{unlockRequest.status}</dd></div>
                    <div><dt>Reason category</dt><dd>{unlockRequest.reasonCategory}</dd></div>
                    <div><dt>Submitted</dt><dd>{formatDateTime(unlockRequest.createdAt)}</dd></div>
                    <div><dt>Requested fields</dt><dd>{unlockRequest.requestedFields.length > 0 ? unlockRequest.requestedFields.join(", ") : "Not specified"}</dd></div>
                    <div><dt>Explanation</dt><dd>{unlockRequest.explanation || "Not provided"}</dd></div>
                    <div><dt>Response note</dt><dd>{unlockRequest.responseNote || "Not provided"}</dd></div>
                  </dl>
                </div>

                <div className="workspace-block">
                  <h3>Review request</h3>
                  {unlockRequest.status === "pending" ? (
                    <>
                      <label>
                        <span className="muted-text">Decision note</span>
                        <Input
                          value={unlockReviewNote}
                          onChange={(event) => setUnlockReviewNote(event.target.value)}
                          placeholder="Optional note for the student"
                        />
                      </label>
                      <div className="hero-actions" style={{ marginTop: "1rem" }}>
                        <Button type="button" disabled={unlockReviewBusy} onClick={() => onReviewUnlock("approved")}>
                          {unlockReviewBusy ? "Saving..." : "Approve unlock"}
                        </Button>
                        <Button type="button" variant="secondary" disabled={unlockReviewBusy} onClick={() => onReviewUnlock("denied")}>
                          Deny request
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="muted-text">
                      This request has already been reviewed.
                      {unlockRequest.decidedAt ? ` Decision recorded on ${formatDateTime(unlockRequest.decidedAt)}.` : ""}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {activeSection === "activity" ? (
        <div className="workspace-panel">
          <div className="workspace-split-grid">
            <div className="workspace-block">
              <h2>Recent Attempts</h2>
              {(Array.isArray(data.attempts) ? data.attempts : []).length === 0 ? (
                <p className="muted-text">No mock test attempts recorded yet.</p>
              ) : (
                <ul className="dashboard-bullet-list">
                  {data.attempts.map((attempt) => (
                    <li key={attempt.id}>
                      {attempt.testTitle}
                      {attempt.testDifficulty ? ` (${attempt.testDifficulty})` : ""}: {attempt.score.toFixed(1)}%
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="workspace-block">
              <h2>Skills snapshot</h2>
              {renderList(Array.isArray(data.skills) ? data.skills : [])}
            </div>
          </div>

          <div className="workspace-block">
            <h2>Drive History</h2>
            {(Array.isArray(data.driveParticipation) ? data.driveParticipation : []).length === 0 ? (
              <p className="muted-text">No drive participation history recorded yet.</p>
            ) : (
              <div className="workspace-table-wrap">
                <table className="workspace-table">
                  <thead>
                    <tr>
                      <th>Drive</th>
                      <th>Date</th>
                      <th>Outcome</th>
                      <th>Declaration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.driveParticipation.map((entry) => (
                      <tr key={entry.driveId}>
                        <td>{entry.company}{entry.role ? ` (${entry.role})` : ""}</td>
                        <td>{entry.driveDate ?? "N/A"}</td>
                        <td>{entry.outcome}</td>
                        <td>{entry.declarationAcceptedAt ? new Date(entry.declarationAcceptedAt).toLocaleDateString() : "Pending"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {activeSection === "audit" ? (
        <div className="workspace-panel">
          <div className="workspace-panel-header">
            <div>
              <h2>Audit Trail</h2>
              <p className="muted-text">Review who changed student-related state, when it happened, and which workflow was affected.</p>
            </div>
          </div>
          <div className="tpo-action-list">
            {(auditEntries ?? []).length === 0 ? (
              <p className="muted-text">No audit events are available for this student yet.</p>
            ) : (
              auditEntries!.map((entry) => (
                <div key={entry.id} className="tpo-action-row">
                  <div>
                    <div className="tpo-action-row-head">
                      <strong>{formatEventLabel(entry.eventType)}</strong>
                      <span className="muted-text">{formatDateTime(entry.createdAt)}</span>
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
    </section>
  );
}
