import { Link } from "react-router-dom";
import { useMemo, useState } from "react";

import { Badge, Button } from "../../components/ui";
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

  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <section className="tpo-drives-shell">
      <header className="tpo-drives-header">
        <div>
          <h1>Drive Management</h1>
          <p className="muted-text">Switch between drive states from one compact control bar and review the selected list full-width.</p>
        </div>
        <Link to="/tpo/drives/create">
          <Button>Create Drive</Button>
        </Link>
      </header>

      <nav className="tpo-drives-subnav" aria-label="Drive status filters">
        <div className="tpo-drives-subnav-links">
          {statusTabs.map((item) => (
            <button
              key={item}
              type="button"
              className={status === item ? "tpo-drives-subnav-link is-active" : "tpo-drives-subnav-link"}
              onClick={() => setStatus(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </nav>

      <section className="tpo-drives-panel">
        <div className="tpo-drives-panel-head">
          <div>
            <h2>{statusLabel} Drives</h2>
            <p className="muted-text">
              {isLoading ? "Loading the selected drive list..." : `${drives.length} drive${drives.length === 1 ? "" : "s"} in this section.`}
            </p>
          </div>
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        {isLoading ? <p className="muted-text">Loading drives...</p> : null}

        {!isLoading && drives.length > 0 ? (
          <div className="tpo-drives-table-wrap">
            <table className="tpo-drives-table">
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
                    <div className="tpo-drives-actions">
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
            </table>
          </div>
        ) : null}

        {!isLoading && drives.length === 0 ? <p className="muted-text">No drives found for this status.</p> : null}
      </section>
    </section>
  );
}
