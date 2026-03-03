import { Link, useParams } from "react-router-dom";
import { useState } from "react";

import { Button, Card, Input, Select, Table } from "../../components/ui";
import { updateDriveResults, useDriveById, useDriveResults } from "../../hooks/use-drives";

type Outcome = "pending" | "shortlisted" | "selected" | "rejected";

interface DraftRow {
  outcome?: Outcome;
  remarks?: string;
}

export default function TpoDriveResultsPage() {
  const { driveId } = useParams();

  const { data: drive, isLoading: driveLoading } = useDriveById(driveId ?? null);
  const { data: results, isLoading: resultsLoading, error, mutate } = useDriveResults(driveId ?? null);
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  if (driveLoading || resultsLoading) {
    return <Card>Loading drive results...</Card>;
  }

  if (error || !driveId || !drive) {
    return <Card>Unable to load drive results.</Card>;
  }

  const rows = results ?? [];

  const getOutcome = (studentId: string, current: Outcome) => {
    return draft[studentId]?.outcome ?? current;
  };

  const getRemarks = (studentId: string, current: string | null) => {
    return draft[studentId]?.remarks ?? (current ?? "");
  };

  const toPayload = () =>
    rows.map((row) => ({
      studentId: row.id,
      outcome: getOutcome(row.id, row.outcome),
      remarks: getRemarks(row.id, row.remarks),
    }));

  const onSave = async (markCompleted = false) => {
    setBusy(true);
    setStatus(null);

    try {
      const payload = toPayload();
      await updateDriveResults({
        driveId,
        updates: payload,
        markCompleted,
      });
      await mutate();
      setStatus(markCompleted ? "Results saved and drive marked completed." : "Results saved.");
    } catch (saveError) {
      setStatus(saveError instanceof Error ? saveError.message : "Unable to save results");
    } finally {
      setBusy(false);
    }
  };

  const onDownloadCsv = () => {
    const header = ["name", "email", "roll_number", "branch", "cgpa", "outcome", "remarks"];
    const body = rows.map((row) =>
      [
        row.fullName,
        row.email,
        row.rollNumber,
        row.branch,
        row.cgpa.toFixed(2),
        getOutcome(row.id, row.outcome),
        getRemarks(row.id, row.remarks),
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(","),
    );

    const csv = [header.join(","), ...body].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${drive.company.replace(/\s+/g, "-").toLowerCase()}-results.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="dashboard-grid">
      <Card>
        <h1>Drive Results: {drive.company}</h1>
        <p>Update outcomes and close the drive lifecycle when final.</p>
        <div className="hero-actions">
          <Link to={`/tpo/drives/${drive.id}`}>
            <Button variant="ghost">Back to Drive</Button>
          </Link>
          <Button variant="secondary" onClick={onDownloadCsv}>
            Download CSV
          </Button>
          <Button disabled={busy} onClick={() => onSave(false)}>
            {busy ? "Saving..." : "Save"}
          </Button>
          <Button disabled={busy} onClick={() => onSave(true)}>
            {busy ? "Saving..." : "Save + Mark Completed"}
          </Button>
        </div>
        {status ? <p>{status}</p> : null}
      </Card>

      <Card>
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Branch</th>
              <th>CGPA</th>
              <th>Outcome</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.fullName}</td>
                <td>{row.email}</td>
                <td>{row.branch}</td>
                <td>{row.cgpa.toFixed(2)}</td>
                <td>
                  <Select
                    value={getOutcome(row.id, row.outcome)}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [row.id]: {
                          ...current[row.id],
                          outcome: event.target.value as Outcome,
                        },
                      }))
                    }
                  >
                    <option value="pending">pending</option>
                    <option value="shortlisted">shortlisted</option>
                    <option value="selected">selected</option>
                    <option value="rejected">rejected</option>
                  </Select>
                </td>
                <td>
                  <Input
                    value={getRemarks(row.id, row.remarks)}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [row.id]: {
                          ...current[row.id],
                          remarks: event.target.value,
                        },
                      }))
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </section>
  );
}
