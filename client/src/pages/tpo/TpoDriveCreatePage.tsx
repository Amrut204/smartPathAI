import { useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";

import { Button, Card, Input } from "../../components/ui";
import { createDrive } from "../../hooks/use-drives";

export default function TpoDriveCreatePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [driveDate, setDriveDate] = useState("");
  const [minCgpa, setMinCgpa] = useState("");
  const [maxBacklogs, setMaxBacklogs] = useState("");
  const [branches, setBranches] = useState("");
  const [minAttendance, setMinAttendance] = useState("");

  const normalizedBranches = useMemo(
    () =>
      branches
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    [branches],
  );

  const onSubmit = async () => {
    setBusy(true);
    setError(null);

    try {
      const created = await createDrive({
        company,
        role: role || undefined,
        driveDate,
        criteria: {
          minCgpa: minCgpa ? Number(minCgpa) : undefined,
          maxBacklogs: maxBacklogs ? Number(maxBacklogs) : undefined,
          branches: normalizedBranches.length ? normalizedBranches : undefined,
          minAttendance: minAttendance ? Number(minAttendance) : undefined,
        },
      });

      navigate(`/tpo/drives/${created.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create drive");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dashboard-grid">
      <Card>
        <h1>Create Drive</h1>
        <p>Step {step} of 3</p>
      </Card>

      {step === 1 ? (
        <Card>
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
              <Input type="date" value={driveDate} onChange={(event) => setDriveDate(event.target.value)} />
            </label>
          </div>
          <div className="hero-actions">
            <Button disabled={!company || !driveDate} onClick={() => setStep(2)}>
              Next
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
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
                onChange={(event) => setMinCgpa(event.target.value)}
              />
            </label>
            <label>
              Max Backlogs
              <Input type="number" min="0" value={maxBacklogs} onChange={(event) => setMaxBacklogs(event.target.value)} />
            </label>
            <label>
              Allowed Branches (comma separated)
              <Input value={branches} onChange={(event) => setBranches(event.target.value)} />
            </label>
            <label>
              Min Attendance %
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={minAttendance}
                onChange={(event) => setMinAttendance(event.target.value)}
              />
            </label>
          </div>
          <div className="hero-actions">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button onClick={() => setStep(3)}>Review</Button>
          </div>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <h2>Step 3: Review</h2>
          <p>Company: {company}</p>
          <p>Role: {role || "-"}</p>
          <p>Date: {driveDate}</p>
          <p>Min CGPA: {minCgpa || "-"}</p>
          <p>Max Backlogs: {maxBacklogs || "-"}</p>
          <p>Branches: {normalizedBranches.join(", ") || "-"}</p>
          <p>Min Attendance: {minAttendance || "-"}</p>

          {error ? <p className="error-text">{error}</p> : null}

          <div className="hero-actions">
            <Button variant="ghost" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button disabled={busy} onClick={onSubmit}>
              {busy ? "Creating..." : "Create Drive"}
            </Button>
          </div>
        </Card>
      ) : null}
    </section>
  );
}
