import { Link } from "react-router-dom";

import { BatchReadinessBarChart, LineTrendChart } from "../../components/charts";
import { Card } from "../../components/ui";
import { useReadinessAnalytics } from "../../hooks/use-analytics";

export default function TpoAnalyticsReadinessPage() {
  const { data, isLoading, error } = useReadinessAnalytics();

  if (isLoading) {
    return <Card>Loading readiness analytics...</Card>;
  }

  if (error || !data) {
    return <Card>Unable to load readiness analytics.</Card>;
  }

  return (
    <section className="tpo-page-shell">
      <Card>
        <h1>Readiness Analytics</h1>
        <p>Batch-wise readiness overview and trend over the last 30 days.</p>
        <div className="hero-actions">
          <Link to="/tpo/analytics">Back to Hub</Link>
        </div>
      </Card>

      <Card>
        <h2>Batch Average Readiness</h2>
        <BatchReadinessBarChart data={data.batchAverages} dataKey="avgReadiness" />
      </Card>

      <Card>
        <h2>30-Day Readiness Trend</h2>
        <LineTrendChart data={data.trend} dataKey="avgScore" />
      </Card>
    </section>
  );
}
