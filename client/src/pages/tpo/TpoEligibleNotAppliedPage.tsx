import { Link } from "react-router-dom";

import { Badge, Button, Card, Skeleton, Table } from "../../components/ui";
import { useTpoControlCenter } from "../../hooks/use-analytics";

function formatDate(value: string | null | undefined) {
  if (!value) return "Not scheduled";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function EligibleNotAppliedSkeleton() {
  return (
    <section className="tpo-dashboard control-center-page">
      <Card className="career-hero-card control-center-hero-card">
        <div style={{ display: "grid", gap: 12 }}>
          <Skeleton size="lg" />
          <Skeleton size="md" />
        </div>
      </Card>
      {Array.from({ length: 3 }).map((_, index) => (
        <Card key={`eligible-not-applied-skeleton-${index}`} className="tpo-list-card">
          <div style={{ display: "grid", gap: 12 }}>
            <Skeleton size="md" />
            <Skeleton size="sm" />
            <Skeleton size="sm" />
          </div>
        </Card>
      ))}
    </section>
  );
}

export default function TpoEligibleNotAppliedPage() {
  const { data, isLoading, error } = useTpoControlCenter();

  if (isLoading) return <EligibleNotAppliedSkeleton />;
  if (error || !data) return <Card>Unable to load the eligible but not applied queue.</Card>;

  const drives = data.actionCenter.eligibleButNotApplied.filter((drive) => drive.eligibleButNotAppliedCount > 0);
  const totalStudents = drives.reduce((sum, drive) => sum + drive.eligibleButNotAppliedCount, 0);

  return (
    <section className="tpo-dashboard control-center-page">
      <Card className="career-hero-card control-center-hero-card">
        <div className="tpo-ops-hero">
          <div className="tpo-ops-hero-copy">
            <p className="workspace-eyebrow">Intervention Queue</p>
            <h1>Eligible but not applied</h1>
            <p className="muted-text">
              This queue shows students who already meet the current drive criteria but still have not applied. It is the fastest place to
              run reminders before deadlines slip.
            </p>
          </div>
          <div className="hero-actions">
            <Link to="/tpo/dashboard">
              <Button variant="secondary">Back to Dashboard</Button>
            </Link>
            <Link to="/tpo/communication">
              <Button>Open Communication</Button>
            </Link>
          </div>
        </div>
        <div className="control-center-pill-grid">
          <div className="control-center-pill">
            <span>Drive Queues</span>
            <strong>{drives.length}</strong>
          </div>
          <div className="control-center-pill">
            <span>Students Waiting</span>
            <strong>{totalStudents}</strong>
          </div>
          <div className="control-center-pill">
            <span>High Risk Drives</span>
            <strong>{data.drivePreparedness.items.filter((drive) => drive.lowApplyRisk).length}</strong>
          </div>
          <div className="control-center-pill">
            <span>Next 7 Days</span>
            <strong>{drives.filter((drive) => drive.daysRemaining !== null && drive.daysRemaining <= 7).length}</strong>
          </div>
        </div>
      </Card>

      {drives.length === 0 ? (
        <Card className="tpo-list-card">
          <p className="muted-text">No drives currently have eligible-but-not-applied students.</p>
        </Card>
      ) : null}

      {drives.map((drive) => (
        <Card key={drive.driveId} className="tpo-list-card">
          <div className="workspace-panel-header">
            <div>
              <p className="workspace-eyebrow">Drive Queue</p>
              <h2>{drive.company}</h2>
              <p className="muted-text">
                {drive.role ? `${drive.role} · ` : ""}
                {formatDate(drive.driveDate)} · {drive.eligibleButNotAppliedCount} students still waiting
              </p>
            </div>
            <div className="hero-actions">
              <Badge variant={(drive.daysRemaining ?? 99) <= 7 ? "warning" : "default"}>
                {drive.daysRemaining === null ? "No deadline" : `${drive.daysRemaining} day${drive.daysRemaining === 1 ? "" : "s"} left`}
              </Badge>
              <Link to={`/tpo/drives/${drive.driveId}`}>
                <Button variant="secondary">Open Drive</Button>
              </Link>
            </div>
          </div>
          <p className="muted-text">{drive.nextRecommendedAction}</p>
          <div className="tpo-ranking-table-wrap">
            <Table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Branch</th>
                  <th>Batch</th>
                  <th>Readiness</th>
                  <th>Profile</th>
                  <th>Resume</th>
                  <th>Certified</th>
                  <th>Next Action</th>
                </tr>
              </thead>
              <tbody>
                {drive.students.map((student) => (
                  <tr key={`${drive.driveId}-${student.studentId}`}>
                    <td>
                      <Link to={`/tpo/students/${student.studentId}`}>{student.fullName}</Link>
                    </td>
                    <td>{student.branch}</td>
                    <td>{student.batch}</td>
                    <td>{student.readinessScore}</td>
                    <td>{student.profileCompletenessPct}%</td>
                    <td>{student.hasResumeReady ? "Ready" : "Missing"}</td>
                    <td>{student.isProfileCertified ? "Certified" : "Pending"}</td>
                    <td>{student.nextRecommendedAction}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      ))}
    </section>
  );
}
