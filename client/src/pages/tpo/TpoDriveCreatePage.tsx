import { useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";

import { TpoActionMenu } from "../../components/composites/TpoActionMenu";
import { TpoSubviewSwitcher } from "../../components/composites/TpoSubviewSwitcher";
import { TpoWorkspaceHeader } from "../../components/composites/TpoWorkspaceHeader";
import { useAuth } from "../../components/providers/AuthProvider";
import { Button, Card, Input, Select } from "../../components/ui";
import { getTpoGreeting } from "../../config/tpo-workspace";
import {
  createDrive,
  previewDriveEligibility,
  type DriveEligibilityPreview,
} from "../../hooks/use-drives";

export default function TpoDriveCreatePage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [eligibilityPreview, setEligibilityPreview] = useState<DriveEligibilityPreview | null>(null);
  const [targetStatus, setTargetStatus] = useState<"draft" | "published">("published");

  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [driveDate, setDriveDate] = useState("");
  const [sectorOrIndustry, setSectorOrIndustry] = useState("");
  const [ctcMinLpa, setCtcMinLpa] = useState("");
  const [ctcMaxLpa, setCtcMaxLpa] = useState("");
  const [ctcFinalLpa, setCtcFinalLpa] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [roundsConducted, setRoundsConducted] = useState("");
  const [mouStatus, setMouStatus] = useState<"not_started" | "in_discussion" | "signed" | "not_applicable">("not_started");
  const [reportingNotes, setReportingNotes] = useState("");
  const [minCgpa, setMinCgpa] = useState("");
  const [maxActiveBacklogs, setMaxActiveBacklogs] = useState("");
  const [maxTotalBacklogs, setMaxTotalBacklogs] = useState("");
  const [branches, setBranches] = useState("");
  const [minAttendance, setMinAttendance] = useState("");
  const [excludePlacedStudents, setExcludePlacedStudents] = useState(false);

  const normalizedBranches = useMemo(
    () =>
      branches
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    [branches],
  );

  const todayIso = new Date().toISOString().slice(0, 10);

  const criteria = useMemo(
    () => ({
      minCgpa: minCgpa ? Number(minCgpa) : undefined,
      maxActiveBacklogs: maxActiveBacklogs ? Number(maxActiveBacklogs) : undefined,
      maxTotalBacklogs: maxTotalBacklogs ? Number(maxTotalBacklogs) : undefined,
      branches: normalizedBranches.length ? normalizedBranches : undefined,
      minAttendance: minAttendance ? Number(minAttendance) : undefined,
      excludePlacedStudents: excludePlacedStudents ? true : undefined,
    }),
    [excludePlacedStudents, maxActiveBacklogs, maxTotalBacklogs, minAttendance, minCgpa, normalizedBranches],
  );

  const invalidatePreview = () => {
    setEligibilityPreview(null);
    setReviewConfirmed(false);
  };

  const validateStepOne = () => {
    const trimmedCompany = company.trim();
    if (!trimmedCompany) {
      setError("Company is required.");
      return false;
    }

    if (!driveDate) {
      setError("Drive date is required.");
      return false;
    }

    if (driveDate < todayIso) {
      setError("Drive date cannot be in the past.");
      return false;
    }

    setError(null);
    return true;
  };

  const onStepOneNext = () => {
    if (!validateStepOne()) {
      return;
    }
    setStep(2);
  };

  const onPreviewEligibility = async () => {
    if (!validateStepOne()) {
      setStep(1);
      return;
    }

    setPreviewBusy(true);
    setError(null);

    try {
      const preview = await previewDriveEligibility({ criteria });
      setEligibilityPreview(preview);
      setReviewConfirmed(false);
      setStep(3);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Unable to preview eligibility");
    } finally {
      setPreviewBusy(false);
    }
  };

  const onSubmit = async () => {
    if (!eligibilityPreview) {
      setError("Preview eligibility before creating the drive.");
      return;
    }

    if (!reviewConfirmed) {
      setError("Confirm that you reviewed the eligibility preview.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const created = await createDrive({
        company: company.trim(),
        role: role || undefined,
        driveDate,
        sectorOrIndustry: sectorOrIndustry.trim() || undefined,
        ctcMinLpa: ctcMinLpa ? Number(ctcMinLpa) : undefined,
        ctcMaxLpa: ctcMaxLpa ? Number(ctcMaxLpa) : undefined,
        ctcFinalLpa: ctcFinalLpa ? Number(ctcFinalLpa) : undefined,
        visitDate: visitDate || undefined,
        roundsConducted: roundsConducted
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        mouStatus,
        reportingNotes: reportingNotes.trim() || undefined,
        criteria,
        status: targetStatus,
        previewDigest: eligibilityPreview.previewDigest,
      });

      navigate(`/tpo/drives/${created.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create drive");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tpo-page-shell tpo-drive-create-page">
      <TpoWorkspaceHeader
        eyebrow="Create Drive"
        greeting={getTpoGreeting(profile?.full_name ?? "Placement team")}
        title="Set up one drive carefully before publishing it."
        description="This flow keeps company details, eligibility, and review separate so the page stays calm while you build the drive."
        primaryAction={(
          <Button variant="secondary" onClick={() => setStep(1)}>Start from Step 1</Button>
        )}
        actionMenu={(
          <TpoActionMenu
            items={[
              { label: "Open drives", href: "/tpo/drives" },
              { label: "Open reports", href: "/tpo/reports" },
            ]}
          />
        )}
      />

      <TpoSubviewSwitcher
        label="Drive creation steps"
        items={[
          { id: "1", label: "Company & Date" },
          { id: "2", label: "Eligibility" },
          { id: "3", label: "Review & Publish" },
        ]}
        activeId={String(step)}
        onChange={(next) => setStep(Number(next))}
      />

      {step === 1 ? (
        <Card className="tpo-form-card">
          <h2>Step 1: Company & Date</h2>
          <div className="form-grid">
            <label>
              Company
              <Input value={company} onChange={(event) => setCompany(event.target.value)} />
            </label>
            <label>
              Role
              <Input value={role} onChange={(event) => setRole(event.target.value)} />
            </label>
            <label>
              Drive Date
              <Input
                type="date"
                min={todayIso}
                value={driveDate}
                onChange={(event) => setDriveDate(event.target.value)}
              />
            </label>
            <label>
              Sector / Industry
              <Input value={sectorOrIndustry} onChange={(event) => setSectorOrIndustry(event.target.value)} />
            </label>
            <label>
              Visit Date
              <Input type="date" value={visitDate} onChange={(event) => setVisitDate(event.target.value)} />
            </label>
            <label>
              CTC Min (LPA)
              <Input type="number" min="0" step="0.1" value={ctcMinLpa} onChange={(event) => setCtcMinLpa(event.target.value)} />
            </label>
            <label>
              CTC Max (LPA)
              <Input type="number" min="0" step="0.1" value={ctcMaxLpa} onChange={(event) => setCtcMaxLpa(event.target.value)} />
            </label>
            <label>
              Final CTC (LPA)
              <Input type="number" min="0" step="0.1" value={ctcFinalLpa} onChange={(event) => setCtcFinalLpa(event.target.value)} />
            </label>
            <label>
              Rounds Conducted (comma separated)
              <Input value={roundsConducted} onChange={(event) => setRoundsConducted(event.target.value)} />
            </label>
            <label>
              MoU Status
              <Select value={mouStatus} onChange={(event) => setMouStatus(event.target.value as typeof mouStatus)}>
                <option value="not_started">Not started</option>
                <option value="in_discussion">In discussion</option>
                <option value="signed">Signed</option>
                <option value="not_applicable">Not applicable</option>
              </Select>
            </label>
            <label>
              Reporting Notes
              <Input value={reportingNotes} onChange={(event) => setReportingNotes(event.target.value)} />
            </label>
          </div>
          <div className="hero-actions">
            <Button disabled={!company || !driveDate} onClick={onStepOneNext}>
              Next
            </Button>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
        </Card>
      ) : null}

      {step === 2 ? (
        <Card className="tpo-form-card">
          <h2>Step 2: Eligibility Criteria</h2>
          <div className="form-grid">
            <label>
              Min CGPA
              <Input
                type="number"
                min="0"
                max="10"
                step="0.1"
                value={minCgpa}
                onChange={(event) => {
                  setMinCgpa(event.target.value);
                  invalidatePreview();
                }}
              />
            </label>
            <label>
              Max Active Backlogs
              <Input
                type="number"
                min="0"
                value={maxActiveBacklogs}
                onChange={(event) => {
                  setMaxActiveBacklogs(event.target.value);
                  invalidatePreview();
                }}
              />
            </label>
            <label>
              Max Total Backlogs (History)
              <Input
                type="number"
                min="0"
                value={maxTotalBacklogs}
                onChange={(event) => {
                  setMaxTotalBacklogs(event.target.value);
                  invalidatePreview();
                }}
              />
            </label>
            <label>
              Allowed Branches (comma separated)
              <Input
                value={branches}
                onChange={(event) => {
                  setBranches(event.target.value);
                  invalidatePreview();
                }}
              />
            </label>
            <label>
              Min Attendance %
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={minAttendance}
                onChange={(event) => {
                  setMinAttendance(event.target.value);
                  invalidatePreview();
                }}
              />
            </label>
            <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={excludePlacedStudents}
                onChange={(event) => {
                  setExcludePlacedStudents(event.target.checked);
                  invalidatePreview();
                }}
              />
              Exclude students already placed (selected)
            </label>
          </div>
          <div className="hero-actions">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button disabled={previewBusy} onClick={onPreviewEligibility}>
              {previewBusy ? "Previewing..." : "Preview & Review"}
            </Button>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
        </Card>
      ) : null}

      {step === 3 ? (
        <Card className="tpo-form-card tpo-review-card">
          <h2>Step 3: Review & Publish</h2>
          <p>Company: {company}</p>
          <p>Role: {role || "-"}</p>
          <p>Date: {driveDate}</p>
          <p>Sector / Industry: {sectorOrIndustry || "-"}</p>
          <p>Visit Date: {visitDate || "-"}</p>
          <p>CTC Range: {(ctcMinLpa || "-")}{ctcMaxLpa ? ` - ${ctcMaxLpa}` : ""}</p>
          <p>Final CTC: {ctcFinalLpa || "-"}</p>
          <p>Rounds Conducted: {roundsConducted || "-"}</p>
          <p>MoU Status: {mouStatus.replace(/_/g, " ")}</p>
          <p>Reporting Notes: {reportingNotes || "-"}</p>
          <p>Min CGPA: {minCgpa || "-"}</p>
          <p>Max Active Backlogs: {maxActiveBacklogs || "-"}</p>
          <p>Max Total Backlogs: {maxTotalBacklogs || "-"}</p>
          <p>Branches: {normalizedBranches.join(", ") || "-"}</p>
          <p>Min Attendance: {minAttendance || "-"}</p>
          <p>Exclude Already Placed: {excludePlacedStudents ? "Yes" : "No"}</p>
          <label>
            Publish mode
            <Select
              value={targetStatus}
              onChange={(event) => setTargetStatus(event.target.value as typeof targetStatus)}
            >
              <option value="published">Publish now after review</option>
              <option value="draft">Save as draft</option>
            </Select>
          </label>
          <hr />
          <h3>Eligibility Preview</h3>
          {eligibilityPreview ? (
            <>
              <p>Total students evaluated: {eligibilityPreview.totalStudents}</p>
              <p>Eligible: {eligibilityPreview.eligibleCount}</p>
              <p>Ineligible: {eligibilityPreview.ineligibleCount}</p>
              <p>Eligibility rate: {eligibilityPreview.eligibleRate}%</p>
              {eligibilityPreview.branchBreakdown && eligibilityPreview.branchBreakdown.length > 0 ? (
                <>
                  <p><strong>Branch-wise split</strong></p>
                  <ul>
                    {eligibilityPreview.branchBreakdown.map((item) => (
                      <li key={item.branch}>
                        {item.branch}: {item.eligibleCount} eligible / {item.totalStudents} evaluated
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {eligibilityPreview.reasons.length > 0 ? (
                <ul>
                  {eligibilityPreview.reasons.map((reason) => (
                    <li key={reason.code}>
                      {reason.label}: {reason.count}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No ineligibility reasons detected for current criteria.</p>
              )}
              {eligibilityPreview.sampleExcludedStudents && eligibilityPreview.sampleExcludedStudents.length > 0 ? (
                <>
                  <p><strong>Sample exclusions</strong></p>
                  <ul>
                    {eligibilityPreview.sampleExcludedStudents.slice(0, 5).map((student) => (
                      <li key={student.studentId}>
                        {student.fullName} ({student.branch}) - {student.reasons.join(", ")}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          ) : (
            <p>No preview available. Go back and run preview.</p>
          )}
          <label>
            <input
              type="checkbox"
              checked={reviewConfirmed}
              onChange={(event) => setReviewConfirmed(event.target.checked)}
            />{" "}
            I have reviewed eligibility impact and want to create this drive.
          </label>

          {error ? <p className="error-text">{error}</p> : null}

          <div className="hero-actions">
            <Button variant="ghost" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button disabled={busy || !eligibilityPreview || !reviewConfirmed} onClick={onSubmit}>
              {busy ? "Saving..." : targetStatus === "draft" ? "Create Draft" : "Create & Publish"}
            </Button>
          </div>
        </Card>
      ) : null}
    </section>
  );
}
