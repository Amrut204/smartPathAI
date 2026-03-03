import { Link } from "react-router-dom";
import { useState } from "react";

import { LineTrendChart } from "../../components/charts";
import { Button, Card, Select } from "../../components/ui";
import { useStudentRankings, useTpoDashboardAnalytics } from "../../hooks/use-analytics";

export default function TpoDashboardPage() {
  const [rankingLimit, setRankingLimit] = useState(10);
  const [windowDays, setWindowDays] = useState(30);

  const { data, isLoading, error } = useTpoDashboardAnalytics();
  const { data: rankingData, isLoading: rankingLoading } = useStudentRankings(rankingLimit, windowDays);

  const exportRankingsCsv = () => {
    if (!rankingData || rankingData.items.length === 0) {
      return;
    }

    const escapeCsv = (value: string | number) => `"${String(value).replace(/"/g, "\"\"")}"`;
    const headers = [
      "Overall Rank",
      "Student",
      "Roll Number",
      "Branch",
      "Batch",
      "Readiness Score",
      "Readiness Rank",
      "Mock Performance Score",
      "Mock Rank",
      "Study Consistency Score",
      "Consistency Rank",
      "Composite Score",
      "Window Days",
    ];

    const rows = rankingData.items.map((item) => ([
      item.ranks.overall,
      item.fullName,
      item.rollNumber,
      item.branch,
      item.batch,
      item.metrics.readinessScore.toFixed(2),
      item.ranks.readiness,
      item.metrics.mockPerformanceScore.toFixed(2),
      item.ranks.mockPerformance,
      item.metrics.studyConsistencyScore.toFixed(2),
      item.ranks.studyConsistency,
      item.metrics.overallScore.toFixed(2),
      rankingData.windowDays,
    ]));

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => escapeCsv(cell)).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `student-rankings-${rankingData.windowDays}d.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return <Card>Loading dashboard...</Card>;
  }

  if (error || !data) {
    return <Card>Unable to load dashboard analytics.</Card>;
  }

  return (
    <section className="tpo-dashboard">
      <div className="tpo-kpi-grid">
        <Card className="tpo-kpi-card">
          <h2>Total Students</h2>
          <p className="tpo-kpi-value">{data.totalStudents}</p>
        </Card>
        <Card className="tpo-kpi-card">
          <h2>Active Drives</h2>
          <p className="tpo-kpi-value">{data.activeDrives}</p>
        </Card>
        <Card className="tpo-kpi-card">
          <h2>Average Readiness</h2>
          <p className="tpo-kpi-value">{data.avgReadiness.toFixed(2)}%</p>
        </Card>
      </div>

      <div className="tpo-insights-grid">
        <Card className="tpo-trend-card">
          <h2>Readiness Trend</h2>
          <LineTrendChart data={data.readinessTrend} dataKey="avgScore" />
        </Card>
        <Card className="tpo-list-card">
          <h2>Upcoming Drives</h2>
          <ul className="tpo-list">
            {data.upcomingDrives.map((drive) => (
              <li key={drive.id}>
                <Link to={`/tpo/drives/${drive.id}`}>
                  {drive.company} {drive.role ? `(${drive.role})` : ""} - {drive.driveDate}
                </Link>
              </li>
            ))}
            {data.upcomingDrives.length === 0 ? <li>No upcoming drives.</li> : null}
          </ul>
        </Card>
        <Card className="tpo-list-card">
          <h2>Action Items</h2>
          <ul className="tpo-list">
            {data.actionItems.length ? data.actionItems.map((item) => <li key={item}>{item}</li>) : <li>No pending actions.</li>}
          </ul>
        </Card>
      </div>

      <Card className="tpo-ranking-card">
        <h2>Student Rankings (Composite)</h2>
        <p className="muted-text">
          Based on: Readiness (45%), Mock Performance (35%), Study Consistency (20%).
        </p>
        <div className="hero-actions ranking-controls">
          <label>
            Window
            <Select value={String(windowDays)} onChange={(event) => setWindowDays(Number(event.target.value))}>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </Select>
          </label>
          <label>
            Top
            <Select value={String(rankingLimit)} onChange={(event) => setRankingLimit(Number(event.target.value))}>
              <option value="10">Top 10</option>
              <option value="25">Top 25</option>
              <option value="50">Top 50</option>
              <option value="100">Top 100</option>
            </Select>
          </label>
          <Button variant="secondary" onClick={exportRankingsCsv} disabled={!rankingData || rankingData.items.length === 0}>
            Export CSV
          </Button>
        </div>
        {rankingData ? (
          <p className="muted-text">
            Window: {rankingData.windowDays} days | Generated: {new Date(rankingData.generatedAt).toLocaleString()}
          </p>
        ) : null}
        {rankingLoading ? <p>Loading rankings...</p> : null}
        {!rankingLoading && (!rankingData || rankingData.items.length === 0) ? <p>No ranking data available.</p> : null}
        {rankingData && rankingData.items.length > 0 ? (
          <div className="tpo-ranking-table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Overall</th>
                  <th>Student</th>
                  <th>Readiness</th>
                  <th>Mock</th>
                  <th>Consistency</th>
                  <th>Composite</th>
                </tr>
              </thead>
              <tbody>
                {rankingData.items.map((item) => (
                  <tr key={item.studentId}>
                    <td>#{item.ranks.overall}</td>
                    <td>
                      <Link to={`/tpo/students/${item.studentId}`}>
                        {item.fullName}
                      </Link>
                    </td>
                    <td>
                      {item.metrics.readinessScore.toFixed(1)} (R{item.ranks.readiness})
                    </td>
                    <td>
                      {item.metrics.mockPerformanceScore.toFixed(1)} (R{item.ranks.mockPerformance})
                    </td>
                    <td>
                      {item.metrics.studyConsistencyScore.toFixed(1)} (R{item.ranks.studyConsistency})
                    </td>
                    <td>{item.metrics.overallScore.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
