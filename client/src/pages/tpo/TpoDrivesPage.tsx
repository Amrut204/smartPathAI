import { Link } from "react-router-dom";
import { useMemo, useState } from "react";

import { Badge, Button, Card, Table } from "../../components/ui";
import { deleteDrive, useDrives, type DriveSummary } from "../../hooks/use-drives";

const statusTabs: Array<DriveSummary["status"]> = ["upcoming", "active", "completed", "cancelled"];

export default function TpoDrivesPage() {
  const [status, setStatus] = useState<DriveSummary["status"]>("upcoming");
  const [busyDriveId, setBusyDriveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading, mutate } = useDrives({ status });

  const drives = useMemo(() => data?.items ?? [], [data]);

  const onDelete = async (driveId: string) => {
    setError(null);
    setBusyDriveId(driveId);

    try {
      await deleteDrive(driveId);
      await mutate();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete drive");
    } finally {
      setBusyDriveId(null);
    }
  };

  return (
    <section className="dashboard-grid">
      <Card>
        <h1>Drive Management</h1>
        <p>Manage placement drives, compute eligibility, and publish outcomes.</p>
        <div className="hero-actions">
          {statusTabs.map((item) => (
            <Button
              key={item}
              variant={status === item ? "primary" : "ghost"}
              onClick={() => setStatus(item)}
            >
              {item}
            </Button>
          ))}
          <Link to="/tpo/drives/create">
            <Button>Create Drive</Button>
          </Link>
        </div>
      </Card>

      {error ? <Card>{error}</Card> : null}
      {isLoading ? <Card>Loading drives...</Card> : null}

      {drives.length > 0 ? (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Role</th>
                <th>Date</th>
                <th>Status</th>
                <th>Eligible</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {drives.map((drive) => (
                <tr key={drive.id}>
                  <td>{drive.company}</td>
                  <td>{drive.role ?? "-"}</td>
                  <td>{drive.driveDate}</td>
                  <td>
                    <Badge>{drive.status}</Badge>
                  </td>
                  <td>{drive.eligibleCount}</td>
                  <td>
                    <div className="hero-actions">
                      <Link to={`/tpo/drives/${drive.id}`}>Open</Link>
                      <Link to={`/tpo/drives/${drive.id}/results`}>Results</Link>
                      {drive.status !== "cancelled" ? (
                        <Button
                          variant="ghost"
                          disabled={busyDriveId === drive.id}
                          onClick={() => onDelete(drive.id)}
                        >
                          {busyDriveId === drive.id ? "Cancelling..." : "Cancel"}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <Card>No drives found for this status.</Card>
      )}
    </section>
  );
}
