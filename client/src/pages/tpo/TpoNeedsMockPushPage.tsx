import { Link } from "react-router-dom";

import { Badge, Button, Card, Skeleton, Table } from "../../components/ui";
import { useTpoControlCenter } from "../../hooks/use-analytics";

function NeedsMockPushSkeleton() {
  return (
    <section className="tpo-dashboard control-center-page">
      <Card className="career-hero-card control-center-hero-card">
        <div style={{ display: "grid", gap: 12 }}>
          <Skeleton size="lg" />
          <Skeleton size="md" />
        </div>
      </Card>
      {Array.from({ length: 2 }).map((_, index) => (
        <Card key={`needs-mock-push-skeleton-${index}`} className="tpo-list-card">
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

export default function TpoNeedsMockPushPage() {
  const { data, isLoading, error } = useTpoControlCenter();

  if (isLoading) return <NeedsMockPushSkeleton />;
  if (error || !data) return <Card>Unable to load the needs mock push queue.</Card>;

  const students = data.actionCenter.lowReadinessNearDriveImpact;

  return (
    <section className="tpo-dashboard control-center-page">
      <Card className="career-hero-card control-center-hero-card">
        <div className="tpo-ops-hero">
          <div className="tpo-ops-hero-copy">
            <p className="workspace-eyebrow">Intervention Queue</p>
            <h1>Needs mock push</h1>
            <p className="muted-text">
              This queue highlights students with live drive impact who still need focused mock practice, activity nudges, or a readiness reset before deadlines get too close.
            </p>
          </div>
          <div className="hero-actions">
            <Link to="/tpo/dashboard">
              <Button variant="secondary">Back to Dashboard</Button>
            </Link>
            <Link to="/tpo/students?mode=ops&view=needs_mock_push">
              <Button variant="secondary">Open Students View</Button>
            </Link>
            <Link to="/tpo/communication">
              <Button>Open Communication</Button>
            </Link>
          </div>
        </div>
        <div className="control-center-pill-grid">
          <div className="control-center-pill">
            <span>Students in Queue</span>
            <strong>{students.length}</strong>
          </div>
          <div className="control-center-pill">
            <span>Low Engagement</span>
            <strong>{data.blockerSegments.lowEngagement}</strong>
          </div>
          <div className="control-center-pill">
            <span>Eligible Upcoming</span>
            <strong>{data.readinessFunnel.eligibleForUpcomingDrives}</strong>
          </div>
          <div className="control-center-pill">
            <span>Ready But Inactive</span>
            <strong>{data.actionCenter.readyButInactive.length}</strong>
          </div>
        </div>
      </Card>

      <Card className="tpo-list-card">
        <div className="workspace-panel-header">
          <div>
            <p className="workspace-eyebrow">Mock Push Queue</p>
            <h2>Students needing an immediate practice nudge</h2>
          </div>
        </div>
        {students.length === 0 ? (
          <p className="muted-text">No students currently need a mock-test push for near-term drive impact.</p>
        ) : (
          <div className="tpo-ranking-table-wrap">
            <Table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Risk</th>
                  <th>Next action</th>
                  <th>Quick links</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.studentId}>
                    <td>
                      <Link to={`/tpo/students/${student.studentId}`}>{student.fullName}</Link>
                    </td>
                    <td>
                      <Badge variant={student.riskLevel === "Critical" || student.riskLevel === "High" ? "warning" : "default"}>
                        {student.riskLevel}
                      </Badge>
                    </td>
                    <td>{student.nextRecommendedAction}</td>
                    <td>
                      <div className="hero-actions">
                        <Link to={`/tpo/students/${student.studentId}`}>
                          <Button variant="secondary">Open Student</Button>
                        </Link>
                        <Link to={`/tpo/communication?mode=email&preset=mock-test&studentIds=${encodeURIComponent(student.studentId)}`}>
                          <Button variant="secondary">Send reminder</Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </section>
  );
}
