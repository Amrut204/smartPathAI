import { Link, useParams } from "react-router-dom";
import { useState } from "react";

import { Badge, Button, Card, Select, Table } from "../../components/ui";
import { computeDriveEligibility, updateDrive, useDriveById } from "../../hooks/use-drives";

export default function TpoDriveDetailPage() {
  const { driveId } = useParams();

  const { data, isLoading, error, mutate } = useDriveById(driveId ?? null);
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  if (isLoading) {
    return <Card>Loading drive...</Card>;
  }

  if (error || !data || !driveId) {
    return <Card>Unable to load drive details.</Card>;
  }

  const criteria = data.criteria ?? {};

  const onComputeEligibility = async () => {
    setBusy(true);
    setStatusError(null);

    try {
      await computeDriveEligibility(driveId);
      await mutate();
    } catch (computeError) {
      setStatusError(computeError instanceof Error ? computeError.message : "Eligibility computation failed");
    } finally {
      setBusy(false);
    }
  };

  const onStatusChange = async (nextStatus: "upcoming" | "active" | "completed" | "cancelled") => {
    setBusy(true);
    setStatusError(null);

    try {
      await updateDrive(driveId, { status: nextStatus });
      await mutate();
    } catch (updateError) {
      setStatusError(updateError instanceof Error ? updateError.message : "Status update failed");
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
        <div className="hero-actions">
          <Button disabled={busy} onClick={onComputeEligibility}>
            {busy ? "Computing..." : "Compute Eligibility"}
          </Button>
          <Link to={`/tpo/drives/${data.id}/results`}>
            <Button variant="secondary">Manage Results</Button>
          </Link>
        </div>
      </Card>

      <Card>
        <h2>Eligibility Criteria</h2>
        <p>Min CGPA: {criteria.minCgpa ?? "-"}</p>
        <p>Max Backlogs: {criteria.maxBacklogs ?? "-"}</p>
        <p>Branches: {criteria.branches?.join(", ") ?? "-"}</p>
        <p>Min Attendance: {criteria.minAttendance ?? "-"}</p>
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
        {statusError ? <p className="error-text">{statusError}</p> : null}
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
