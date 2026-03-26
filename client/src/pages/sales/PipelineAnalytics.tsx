import { Link } from "react-router-dom";

import { Button, Card, Table } from "../../components/ui";
import { useSalesPipelineAnalytics } from "../../hooks/use-sales-pipeline";

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatCurrency(value: number) {
  return `₹${value.toLocaleString("en-IN")}`;
}

export default function PipelineAnalytics() {
  const { data, isLoading } = useSalesPipelineAnalytics();

  if (isLoading || !data) {
    return (
      <section className="dashboard-grid">
        <Card><p className="muted-text">Loading pipeline analytics...</p></Card>
      </section>
    );
  }

  return (
    <section className="dashboard-grid">
      <Card>
        <div className="hero-actions" style={{ justifyContent: "space-between" }}>
          <div>
            <h1>Pipeline Analytics</h1>
            <p>Track conversion efficiency and expected revenue by stage.</p>
          </div>
          <Link to="/tpo/sales/pipeline">
            <Button variant="secondary">Back to Pipeline</Button>
          </Link>
        </div>
      </Card>

      <Card>
        <h2>Overview</h2>
        <div className="stats-grid">
          <div className="stat-card"><strong>Total Contacts</strong><p>{data.totalContacts}</p></div>
          <div className="stat-card"><strong>Expected Revenue</strong><p>{formatCurrency(data.expectedRevenue.total)}</p></div>
          <div className="stat-card"><strong>Overall Conversion</strong><p>{formatPercent(data.conversionRates.overallConversion)}</p></div>
          <div className="stat-card"><strong>Demo to Pilot</strong><p>{formatPercent(data.conversionRates.demoToPilot)}</p></div>
        </div>
      </Card>

      <Card className="tpo-table-card">
        <h2>Stage Breakdown</h2>
        <div className="tpo-ranking-table-wrap">
          <Table>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Count</th>
                <th>Expected Revenue</th>
                <th>Avg Time (days)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.byStage).map(([stage, count]) => (
                <tr key={stage}>
                  <td>{stage.replace(/_/g, " ")}</td>
                  <td>{count}</td>
                  <td>{formatCurrency(data.expectedRevenue.byStage[stage as keyof typeof data.byStage])}</td>
                  <td>{data.avgTimeInStage[stage as keyof typeof data.byStage]}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card className="tpo-table-card">
        <h2>Conversion Rates</h2>
        <div className="tpo-ranking-table-wrap">
          <Table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Rate</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Contact to Demo</td><td>{formatPercent(data.conversionRates.contactToDemo)}</td></tr>
              <tr><td>Demo to Pilot</td><td>{formatPercent(data.conversionRates.demoToPilot)}</td></tr>
              <tr><td>Pilot to Conversion</td><td>{formatPercent(data.conversionRates.pilotToConversion)}</td></tr>
              <tr><td>Overall Conversion</td><td>{formatPercent(data.conversionRates.overallConversion)}</td></tr>
            </tbody>
          </Table>
        </div>
      </Card>
    </section>
  );
}
