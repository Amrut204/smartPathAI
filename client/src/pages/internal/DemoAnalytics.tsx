import { Link } from "react-router-dom";

import { Button, Card, Table } from "../../components/ui";
import { useDemoAnalytics } from "../../hooks/use-demo-feedback";

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

export default function DemoAnalytics() {
  const { data, isLoading } = useDemoAnalytics();

  if (isLoading || !data) {
    return (
      <section className="dashboard-grid">
        <Card><p className="muted-text">Loading demo analytics...</p></Card>
      </section>
    );
  }

  return (
    <section className="dashboard-grid">
      <Card>
        <div className="hero-actions" style={{ justifyContent: "space-between" }}>
          <div>
            <h1>Demo Analytics</h1>
            <p>Track product fit, objections, and conversion movement across demos.</p>
          </div>
          <Link to="/tpo/internal/demo-feedback">
            <Button variant="secondary">Add Feedback</Button>
          </Link>
        </div>
      </Card>

      <Card>
        <h2>Overview</h2>
        <div className="stats-grid">
          <div className="stat-card"><strong>Total Demos</strong><p>{data.totalDemos}</p></div>
          <div className="stat-card"><strong>Avg Demo Rating</strong><p>{data.avgDemoRating}</p></div>
          <div className="stat-card"><strong>Avg Product Fit</strong><p>{data.avgProductFit}</p></div>
          <div className="stat-card"><strong>Avg Conversion Likelihood</strong><p>{data.avgConversionLikelihood}</p></div>
        </div>
      </Card>

      <Card className="tpo-table-card">
        <h2>Status Breakdown</h2>
        <div className="tpo-ranking-table-wrap">
          <Table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.statusBreakdown).map(([status, count]) => (
                <tr key={status}>
                  <td>{status.replace(/_/g, " ")}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card className="tpo-table-card">
        <h2>Conversion Funnel</h2>
        <div className="tpo-ranking-table-wrap">
          <Table>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Demos</td><td>{data.conversionFunnel.demos}</td></tr>
              <tr><td>Follow-ups</td><td>{data.conversionFunnel.followUps}</td></tr>
              <tr><td>Pilots</td><td>{data.conversionFunnel.pilots}</td></tr>
              <tr><td>Conversions</td><td>{data.conversionFunnel.conversions}</td></tr>
              <tr><td>Conversion Rate</td><td>{formatPercent(data.conversionFunnel.conversionRate)}</td></tr>
            </tbody>
          </Table>
        </div>
      </Card>

      <Card className="tpo-table-card">
        <h2>Common Pain Points</h2>
        <div className="tpo-ranking-table-wrap">
          <Table>
            <thead>
              <tr>
                <th>Pain Point</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {data.commonPainPoints.map((item) => (
                <tr key={item.painPoint}>
                  <td>{item.painPoint}</td>
                  <td>{item.count}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card className="tpo-table-card">
        <h2>Top Feature Requests</h2>
        <div className="tpo-ranking-table-wrap">
          <Table>
            <thead>
              <tr>
                <th>Feature</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {data.topFeatureRequests.map((item) => (
                <tr key={item.feature}>
                  <td>{item.feature}</td>
                  <td>{item.count}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </section>
  );
}
