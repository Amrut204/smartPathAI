import { useState } from "react";
import { Link } from "react-router-dom";

import { BatchReadinessBarChart } from "../../components/charts";
import { Badge, Button, Card, Table } from "../../components/ui";
import { usePilotTpoDashboard } from "../../hooks/use-pilot-dashboard";
import { refreshTpoRiskAssessment, useTpoRiskAssessment } from "../../hooks/use-risk-assessment";

function toShortLabel(value: string, fallback: string) {
  return value.length > 14 ? `${value.slice(0, 14)}...` : (value || fallback);
}

export default function TpoAnalyticsPage() {
  const dashboard = usePilotTpoDashboard();
  const risk = useTpoRiskAssessment();
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);

  if (dashboard.isLoading || risk.isLoading) {
    return <Card>Loading analytics...</Card>;
  }

  if (dashboard.error || !dashboard.data) {
    return <Card>Unable to load analytics.</Card>;
  }

  const data = dashboard.data;
  const riskSummary = risk.data?.summary ?? {
    highRisk: 0,
    mediumRisk: 0,
    lowRisk: 0,
    totalStudents: data.summary.totalStudents,
  };
  const weeklyRiskChange = risk.data?.trends.weeklyChange ?? {
    highRisk: 0,
    mediumRisk: 0,
    lowRisk: 0,
  };
  const highRiskStudents = risk.data?.highRiskStudents.slice(0, 8) ?? [];

  const readinessChart = [
    { batch: "High", value: data.readiness.high },
    { batch: "Medium", value: data.readiness.medium },
    { batch: "Low", value: data.readiness.low },
  ];

  const riskChart = [
    { batch: "High Risk", value: riskSummary.highRisk },
    { batch: "Medium Risk", value: riskSummary.mediumRisk },
    { batch: "Low Risk", value: riskSummary.lowRisk },
  ];

  const driveChart = data.upcomingDrives.map((drive) => ({
    batch: toShortLabel(drive.company, "Drive"),
    value: drive.eligibleStudents,
  }));

  return (
    <section className="tpo-dashboard control-center-page">
      <Card className="career-hero-card control-center-hero-card">
        <h1>TPO Analytics</h1>
        <p className="muted-text">
          A working analytics view for the pilot build, focused on readiness, drive eligibility, and student risk.
        </p>
        <div className="hero-actions">
          <Link to="/tpo/reports">
            <Button variant="secondary">Open Reports</Button>
          </Link>
          <Button
            variant="secondary"
            disabled={refreshBusy}
            onClick={async () => {
              setRefreshBusy(true);
              setRefreshStatus(null);
              try {
                await refreshTpoRiskAssessment();
                await risk.mutate();
                setRefreshStatus("Risk signals refreshed.");
              } catch (error) {
                setRefreshStatus(error instanceof Error ? error.message : "Unable to refresh risk signals.");
              } finally {
                setRefreshBusy(false);
              }
            }}
          >
            {refreshBusy ? "Refreshing..." : "Refresh Risk Signals"}
          </Button>
          {refreshStatus ? <span className="muted-text">{refreshStatus}</span> : null}
        </div>
        <div className="control-center-pill-grid">
          <div className="control-center-pill">
            <span>Total Students</span>
            <strong>{data.summary.totalStudents}</strong>
          </div>
          <div className="control-center-pill">
            <span>Eligible Students</span>
            <strong>{data.summary.eligibleStudents}</strong>
          </div>
          <div className="control-center-pill">
            <span>Upcoming Drives</span>
            <strong>{data.summary.upcomingDrives}</strong>
          </div>
          <div className="control-center-pill">
            <span>Mocks This Week</span>
            <strong>{data.summary.mockTestsTakenThisWeek}</strong>
          </div>
          <div className="control-center-pill">
            <span>High Risk</span>
            <strong>{riskSummary.highRisk}</strong>
          </div>
          <div className="control-center-pill">
            <span>Medium Risk</span>
            <strong>{riskSummary.mediumRisk}</strong>
          </div>
          <div className="control-center-pill">
            <span>Low Risk</span>
            <strong>{riskSummary.lowRisk}</strong>
          </div>
        </div>
      </Card>

      <div className="tpo-insights-grid">
        <Card>
          <h2>Readiness Distribution</h2>
          <BatchReadinessBarChart data={readinessChart} dataKey="value" />
        </Card>

        <Card>
          <h2>Risk Distribution</h2>
          <BatchReadinessBarChart data={riskChart} dataKey="value" />
        </Card>
      </div>

      <div className="tpo-insights-grid">
        <Card>
          <h2>Drive Eligibility Snapshot</h2>
          <BatchReadinessBarChart data={driveChart} dataKey="value" />
        </Card>

        <Card className="tpo-list-card">
          <h2>Risk Movement This Week</h2>
          <ul className="tpo-list">
            <li>High risk change: {weeklyRiskChange.highRisk >= 0 ? "+" : ""}{weeklyRiskChange.highRisk}</li>
            <li>Medium risk change: {weeklyRiskChange.mediumRisk >= 0 ? "+" : ""}{weeklyRiskChange.mediumRisk}</li>
            <li>Low risk change: {weeklyRiskChange.lowRisk >= 0 ? "+" : ""}{weeklyRiskChange.lowRisk}</li>
            <li>
              Risk coverage: {riskSummary.totalStudents > 0 ? Math.round(((riskSummary.highRisk + riskSummary.mediumRisk) / riskSummary.totalStudents) * 100) : 0}% students need follow-up
            </li>
          </ul>
        </Card>
      </div>

      <div className="tpo-insights-grid">
        <Card className="tpo-list-card">
          <h2>Priority Signals</h2>
          <ul className="tpo-list">
            <li>{data.summary.eligibleStudents} students are currently eligible for the next drive wave.</li>
            <li>{data.readiness.low} students are in the low-readiness band and need coaching support.</li>
            <li>{riskSummary.highRisk + riskSummary.mediumRisk} students need active follow-up based on current risk signals.</li>
            <li>{data.summary.mockTestsTakenThisWeek} mock tests were completed this week.</li>
          </ul>
        </Card>

        <Card className="tpo-list-card">
          <h2>Drive Watchlist</h2>
          <ul className="tpo-list">
            {data.upcomingDrives.map((drive) => (
              <li key={drive.driveId}>
                <Link to={`/tpo/drives/${drive.driveId}`}>{drive.company}</Link>
                {drive.role ? ` (${drive.role})` : ""} - {drive.eligibleStudents} eligible - risk score {drive.driveRiskScore}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <h2>High-Risk Students</h2>
        {highRiskStudents.length === 0 ? (
          <p className="muted-text">No high-risk students are flagged right now.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Branch</th>
                <th>Batch</th>
                <th>Risk</th>
                <th>Profile</th>
                <th>Mocks</th>
                <th>Recommended Action</th>
              </tr>
            </thead>
            <tbody>
              {highRiskStudents.map((student) => (
                <tr key={student.studentId}>
                  <td>
                    <Link to={`/tpo/students/${student.studentId}`}>{student.fullName}</Link>
                  </td>
                  <td>{student.branch}</td>
                  <td>{student.batch}</td>
                  <td>
                    <Badge variant="danger">Risk {student.riskScore}</Badge>
                  </td>
                  <td>{student.profileCompletenessPct.toFixed(0)}%</td>
                  <td>{student.mockTestsAttempted}</td>
                  <td>{student.recommendedActions[0] ?? "Review student"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </section>
  );
}
