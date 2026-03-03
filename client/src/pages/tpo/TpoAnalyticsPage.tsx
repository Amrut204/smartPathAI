import { Link } from "react-router-dom";

import { Card } from "../../components/ui";
import { useTpoDashboardAnalytics } from "../../hooks/use-analytics";

export default function TpoAnalyticsPage() {
  const { data, isLoading, error } = useTpoDashboardAnalytics();

  return (
    <section className="dashboard-grid">
      <Card>
        <h1>Analytics Hub</h1>
        <p>Access readiness trends, topic heatmaps, test completion, and placement funnel.</p>
        <div className="hero-actions">
          <Link to="/tpo/analytics/readiness">Readiness</Link>
          <Link to="/tpo/analytics/topics">Topics Heatmap</Link>
          <Link to="/tpo/analytics/tests">Tests</Link>
          <Link to="/tpo/analytics/placement">Placement Funnel</Link>
        </div>
      </Card>

      {isLoading ? <Card>Loading analytics summary...</Card> : null}
      {error ? <Card>Unable to load analytics summary.</Card> : null}

      {data ? (
        <>
          <Card>
            <h2>Total Students</h2>
            <p>{data.totalStudents}</p>
          </Card>
          <Card>
            <h2>Active Drives</h2>
            <p>{data.activeDrives}</p>
          </Card>
          <Card>
            <h2>Average Readiness</h2>
            <p>{data.avgReadiness.toFixed(2)}%</p>
          </Card>
        </>
      ) : null}
    </section>
  );
}
