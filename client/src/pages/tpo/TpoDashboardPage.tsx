import { Link } from "react-router-dom";

import { Badge, Button, Card, Skeleton, Table } from "../../components/ui";
import { RiskDashboard } from "../../components/RiskDashboard";
import { usePilotTpoDashboard } from "../../hooks/use-pilot-dashboard";
import { approveSupportRequest, denySupportRequest, useTpoSupportInbox } from "../../hooks/use-support";

function TpoDashboardSkeleton() {
  return (
    <section className="tpo-dashboard control-center-page">
      <Card className="career-hero-card control-center-hero-card">
        <div style={{ display: "grid", gap: 12 }}>
          <Skeleton size="lg" />
          <Skeleton size="md" />
        </div>
        <div className="control-center-pill-grid" style={{ marginTop: 20 }}>
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={`tpo-dashboard-skeleton-pill-${index}`} className="control-center-pill">
              <Skeleton size="sm" />
              <Skeleton size="md" />
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}

export default function TpoDashboardPage() {
  const { data, isLoading, error } = usePilotTpoDashboard();
  const inbox = useTpoSupportInbox(true);
  const pendingSupport = (inbox.data ?? []).filter((item) => item.status === "pending");

  if (isLoading) {
    return <TpoDashboardSkeleton />;
  }

  if (error || !data) {
    return <Card>Unable to load TPO dashboard.</Card>;
  }

  const upcomingDrives = Array.isArray(data.upcomingDrives) ? data.upcomingDrives : [];
  const studentsNeedingAttention = Array.isArray(data.studentsNeedingAttention) ? data.studentsNeedingAttention : [];

  return (
    <section className="tpo-dashboard control-center-page">
      <Card className="career-hero-card control-center-hero-card">
        <h1>Smart Path Dashboard</h1>
        <p className="muted-text">
          The pilot view focuses on what matters most today: active drives, student readiness, and follow-up actions.
        </p>
        <div className="control-center-pill-grid">
          <div className="control-center-pill">
            <span>Total Students</span>
            <strong>{Number(data.summary.totalStudents ?? 0)}</strong>
          </div>
          <div className="control-center-pill">
            <span>Upcoming Drives</span>
            <strong>{Number(data.summary.upcomingDrives ?? 0)}</strong>
          </div>
          <div className="control-center-pill">
            <span>Students Eligible</span>
            <strong>{Number(data.summary.eligibleStudents ?? 0)}</strong>
          </div>
          <div className="control-center-pill">
            <span>Mocks This Week</span>
            <strong>{Number(data.summary.mockTestsTakenThisWeek ?? 0)}</strong>
          </div>
          <div className="control-center-pill">
            <span>High Readiness</span>
            <strong>{Number(data.readiness.high ?? 0)}</strong>
          </div>
          <div className="control-center-pill">
            <span>Medium Readiness</span>
            <strong>{Number(data.readiness.medium ?? 0)}</strong>
          </div>
          <div className="control-center-pill">
            <span>Low Readiness</span>
            <strong>{Number(data.readiness.low ?? 0)}</strong>
          </div>
        </div>
        <div className="hero-actions">
          <Link to="/tpo/drives/create">
            <Button>Create Drive</Button>
          </Link>
          <Link to="/tpo/reports">
            <Button variant="secondary">Open Reports</Button>
          </Link>
          <Link to="/tpo/communication">
            <Button variant="secondary">Send Reminder</Button>
          </Link>
        </div>
      </Card>

      <div className="tpo-insights-grid">
        <Card className="tpo-list-card">
          <h2>Upcoming Drives</h2>
          {upcomingDrives.length === 0 ? (
            <p className="muted-text">No upcoming drives yet.</p>
          ) : (
            <ul className="tpo-list">
              {upcomingDrives.map((item) => (
                <li key={item.driveId}>
                  <Link to={`/tpo/drives/${item.driveId}`}>{item.company}</Link>
                  {item.role ? ` (${item.role})` : ""} - {new Date(item.driveDate).toLocaleDateString()} - {item.eligibleStudents} eligible
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="tpo-list-card">
          <h2>Readiness Mix</h2>
          <ul className="tpo-list">
            <li>High readiness: {Number(data.readiness.high ?? 0)}</li>
            <li>Medium readiness: {Number(data.readiness.medium ?? 0)}</li>
            <li>Low readiness: {Number(data.readiness.low ?? 0)}</li>
          </ul>
        </Card>

        <Card className="tpo-list-card">
          <h2>Support Requests</h2>
          {inbox.isLoading ? (
            <p className="muted-text">Loading requests...</p>
          ) : inbox.error ? (
            <p className="error-text">Unable to load support requests.</p>
          ) : pendingSupport.length === 0 ? (
            <p className="muted-text">No pending requests.</p>
          ) : (
            <ul className="tpo-list">
              {pendingSupport.slice(0, 5).map((req) => (
                <li key={req.id} style={{ display: "grid", gap: 8 }}>
                  <div>
                    <strong>Admin request</strong>{" "}
                    <span className="muted-text">
                      from {req.requested_by_email} ({new Date(req.created_at).toLocaleString()})
                    </span>
                    <div className="muted-text" style={{ marginTop: 6 }}>
                      {req.reason}
                    </div>
                  </div>
                  <div className="hero-actions">
                    <Button
                      onClick={async () => {
                        await approveSupportRequest(req.id, 60);
                      }}
                    >
                      Approve (60m)
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        if (!confirm("Deny this support request?")) return;
                        await denySupportRequest(req.id, "Denied by TPO");
                      }}
                    >
                      Deny
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="muted-text" style={{ marginTop: 10 }}>
            Approvals are time-limited and audited to protect student privacy.
          </p>
        </Card>
      </div>

      <RiskDashboard />

      <Card>
        <h2>Students Needing Attention</h2>
        <div className="tpo-ranking-table-wrap">
          <Table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Branch</th>
                <th>Batch</th>
                <th>CGPA</th>
                <th>Profile</th>
                <th>Mocks</th>
                <th>Active 7d</th>
                <th>Next Action</th>
              </tr>
            </thead>
            <tbody>
              {studentsNeedingAttention.map((student) => (
                <tr key={student.studentId}>
                  <td>
                    <Link to={`/tpo/students/${student.studentId}`}>{student.fullName}</Link>
                  </td>
                  <td>{student.branch}</td>
                  <td>{student.batch}</td>
                  <td>{Number(student.cgpa ?? 0).toFixed(1)}</td>
                  <td>{Number(student.profileCompletenessPct ?? 0).toFixed(0)}%</td>
                  <td>{Number(student.mockAttempts ?? 0)}</td>
                  <td>
                    <Badge variant={student.isActive7d ? "success" : "warning"}>
                      {student.isActive7d ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td>{student.nextRecommendedAction}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </section>
  );
}
