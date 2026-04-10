import { Link } from "react-router-dom";
import { useMemo, useState } from "react";

import { TpoActionMenu } from "../../components/composites/TpoActionMenu";
import { TpoWorkspaceHeader } from "../../components/composites/TpoWorkspaceHeader";
import { useAuth } from "../../components/providers/AuthProvider";
import { Badge, Button, Select } from "../../components/ui";
import { getTpoGreeting } from "../../config/tpo-workspace";
import { deleteDrive, useDrives, type DriveSummary } from "../../hooks/use-drives";

const statusTabs: Array<{ id: DriveSummary["status"]; label: string }> = [
  { id: "draft", label: "Draft" },
  { id: "published", label: "Published" },
  { id: "registration_closed", label: "Closed" },
  { id: "in_process", label: "In Process" },
  { id: "results_pending", label: "Results Pending" },
  { id: "completed", label: "Completed" },
  { id: "archived", label: "Archived" },
  { id: "cancelled", label: "Cancelled" },
];

export default function TpoDrivesPage() {
  const { profile } = useAuth();
  const [status, setStatus] = useState<DriveSummary["status"]>("published");
  const [filtersOpen, setFiltersOpen] = useState(false);
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

  const statusLabel = statusTabs.find((item) => item.id === status)?.label ?? status;

  return (
    <section className="tpo-drives-shell">
      <TpoWorkspaceHeader
        eyebrow="Drives"
        greeting={getTpoGreeting(profile?.full_name ?? "Placement team")}
        title="Manage one drive queue at a time."
        description="Choose a drive state below, review that list in full, and keep lower-priority actions tucked away instead of crowding the page."
        primaryAction={(
          <Link to="/tpo/drives/create">
            <Button>Create Drive</Button>
          </Link>
        )}
        secondaryAction={(
          <Button
            variant="secondary"
            onClick={() => setFiltersOpen((current) => !current)}
          >
            Filters
          </Button>
        )}
        actionMenu={(
          <TpoActionMenu
            items={[
              { label: "Open Reports", href: "/tpo/reports" },
              { label: "Open Communication", href: "/tpo/communication" },
            ]}
          />
        )}
      />

      {filtersOpen ? (
        <section className="tpo-drives-panel">
          <div className="workspace-panel-header">
            <div>
              <p className="workspace-eyebrow">Filters</p>
              <h2>Choose which drive queue to review</h2>
              <p className="muted-text">Use one status at a time so the drive list stays focused.</p>
            </div>
            <div className="hero-actions">
              <Button
                variant="ghost"
                onClick={() => {
                  setStatus("published");
                  setFiltersOpen(false);
                }}
              >
                Reset Filters
              </Button>
            </div>
          </div>
          <div className="tpo-compact-select-grid">
            <label>
              Drive status
              <Select value={status} onChange={(event) => setStatus(event.target.value as DriveSummary["status"])}>
                {statusTabs.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </Select>
            </label>
          </div>
        </section>
      ) : null}

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
                      <TpoActionMenu
                        items={[
                          { label: "Open Results", href: `/tpo/drives/${drive.id}/results` },
                          ...(drive.status !== "cancelled"
                            ? [{
                              label: busyDriveId === drive.id ? "Cancelling..." : "Cancel Drive",
                              onSelect: () => {
                                if (busyDriveId === drive.id) return;
                                void onDelete(drive.id);
                              },
                              tone: "danger" as const,
                            }]
                            : []),
                        ]}
                      />
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
