import { Link, useParams } from "react-router-dom";
import { useState } from "react";

import { Badge, Button, Card, Input, Select, Table } from "../../components/ui";
import { computeDriveEligibility, updateDrive, useDriveById } from "../../hooks/use-drives";

export default function TpoDriveDetailPage() {
  const { driveId } = useParams();

  const { data, isLoading, error, mutate } = useDriveById(driveId ?? null);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [metadata, setMetadata] = useState({
    sectorOrIndustry: "",
    ctcMinLpa: "",
    ctcMaxLpa: "",
    ctcFinalLpa: "",
    visitDate: "",
    roundsConducted: "",
    mouStatus: "" as "" | "not_started" | "in_discussion" | "signed" | "not_applicable",
    reportingNotes: "",
  });

  if (isLoading) {
    return <Card>Loading drive...</Card>;
  }

  if (error || !data || !driveId) {
    return <Card>Unable to load drive details.</Card>;
  }

  const criteria = data.criteria ?? {};
  const snapshots = data.eligibility?.snapshots ?? [];

  const onComputeEligibility = async () => {
    setBusy(true);
    setStatusMessage(null);

    try {
      const result = await computeDriveEligibility(driveId);
      await mutate();
      setStatusMessage(
        `Eligibility snapshot v${result.snapshot.version} saved: ${result.eligibleCount}/${result.totalStudents} eligible.`,
      );
    } catch (computeError) {
      setStatusMessage(computeError instanceof Error ? computeError.message : "Eligibility computation failed");
    } finally {
      setBusy(false);
    }
  };

  const onStatusChange = async (nextStatus: "upcoming" | "active" | "completed" | "cancelled") => {
    setBusy(true);
    setStatusMessage(null);

    try {
      await updateDrive(driveId, { status: nextStatus });
      await mutate();
      setStatusMessage(`Drive status updated to ${nextStatus}.`);
    } catch (updateError) {
      setStatusMessage(updateError instanceof Error ? updateError.message : "Status update failed");
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
      setStatusMessage("Drive reporting metadata saved.");
    } catch (updateError) {
      setStatusMessage(updateError instanceof Error ? updateError.message : "Unable to save metadata");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dashboard-grid">
      <Card>
        <h1>
          {data.company} {data.role ? `- ${data.role}` : ""}
        </h1>
        <p>Drive Date: {data.driveDate}</p>
        <p>
          Status: <Badge>{data.status}</Badge>
        </p>
        <p>Eligible Count: {data.eligibleCount}</p>
        <p>
          Latest eligibility snapshot:{" "}
          {data.eligibility?.latestVersion
            ? `v${data.eligibility.latestVersion} (${data.eligibility.lastComputedAt ?? "-"})`
            : "Not computed yet"}
        </p>
        <div className="hero-actions">
          <Button disabled={busy} onClick={onComputeEligibility}>
            {busy ? "Computing..." : "Compute Eligibility"}
          </Button>
          <a href={`/api/v1/drives/${data.id}/export?format=csv`}>
            <Button variant="secondary" disabled={!data.eligibility?.latestVersion}>
              Export Eligible CSV
            </Button>
          </a>
          <a href={`/api/v1/drives/${data.id}/export?format=pdf`}>
            <Button variant="secondary">
              Download Summary PDF
            </Button>
          </a>
          <Link to={`/tpo/drives/${data.id}/results`}>
            <Button variant="secondary">Manage Results</Button>
          </Link>
          <Link to={`/tpo/reports?group=Drive+Reports&reportType=drive_completion_summary&driveId=${data.id}`}>
            <Button variant="secondary">Open Reports</Button>
          </Link>
        </div>
        {statusMessage ? <p>{statusMessage}</p> : null}
      </Card>

      <Card>
        <h2>Eligibility Criteria</h2>
        <p>Min CGPA: {criteria.minCgpa ?? "-"}</p>
        <p>Max Active Backlogs: {(criteria.maxActiveBacklogs ?? criteria.maxBacklogs) ?? "-"}</p>
        <p>Max Total Backlogs: {criteria.maxTotalBacklogs ?? "-"}</p>
        <p>Branches: {criteria.branches?.join(", ") ?? "-"}</p>
        <p>Min Attendance: {criteria.minAttendance ?? "-"}</p>
        <p>Exclude Already Placed: {criteria.excludePlacedStudents ? "Yes" : "No"}</p>
      </Card>

      <Card className="tpo-form-card">
        <h2>Visit & Reporting Metadata</h2>
        <div className="form-grid">
          <label>
            Sector / Industry
            <Input
              value={metadata.sectorOrIndustry || data.sectorOrIndustry || ""}
              onChange={(event) => setMetadata((current) => ({ ...current, sectorOrIndustry: event.target.value }))}
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
      </Card>

      <Card>
        <h2>Status Controls</h2>
        <div className="hero-actions">
          <Select
            value={data.status}
            onChange={(event) =>
              onStatusChange(event.target.value as "upcoming" | "active" | "completed" | "cancelled")
            }
            disabled={busy}
          >
            <option value="upcoming">upcoming</option>
            <option value="active">active</option>
            <option value="completed">completed</option>
            <option value="cancelled">cancelled</option>
          </Select>
        </div>
      </Card>

      <Card>
        <h2>Eligibility Snapshot History</h2>
        {snapshots.length === 0 ? (
          <p>No eligibility snapshot history yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Computed At</th>
                <th>Eligible</th>
                <th>Ineligible</th>
                <th>Reasons</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snapshot) => (
                <tr key={snapshot.id}>
                  <td>v{snapshot.version}</td>
                  <td>{snapshot.computedAt}</td>
                  <td>
                    {snapshot.eligibleCount}/{snapshot.totalStudents}
                  </td>
                  <td>{snapshot.ineligibleCount}</td>
                  <td>
                    {snapshot.reasons.length > 0
                      ? snapshot.reasons.map((reason) => `${reason.label}: ${reason.count}`).join(" | ")
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <h2>Eligible Students</h2>
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
      </Card>
    </section>
  );
}
