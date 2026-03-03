import { Link } from "react-router-dom";

import { OutcomeDoughnutChart, PlacementFunnelChart } from "../../components/charts";
import { Card, Table } from "../../components/ui";
import { usePlacementAnalytics } from "../../hooks/use-analytics";

export default function TpoAnalyticsPlacementPage() {
  const { data, isLoading, error } = usePlacementAnalytics();

  if (isLoading) {
    return <Card>Loading placement analytics...</Card>;
  }

  if (error || !data) {
    return <Card>Unable to load placement analytics.</Card>;
  }

  const doughnutData = [
    { name: "pending", count: data.outcomes.pending },
    { name: "shortlisted", count: data.outcomes.shortlisted },
    { name: "selected", count: data.outcomes.selected },
    { name: "rejected", count: data.outcomes.rejected },
  ];

  return (
    <section className="dashboard-grid">
      <Card>
        <h1>Placement Funnel</h1>
        <p>Track conversion from eligible students to final selections.</p>
        <div className="hero-actions">
          <Link to="/tpo/analytics">Back to Hub</Link>
        </div>
      </Card>

      <Card>
        <h2>Funnel View</h2>
        <PlacementFunnelChart data={data.funnel} />
      </Card>

      <Card>
        <h2>Outcome Distribution</h2>
        <OutcomeDoughnutChart data={doughnutData} />
      </Card>

      <Card>
        <h2>Outcome Counts</h2>
        <Table>
          <thead>
            <tr>
              <th>Outcome</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {doughnutData.map((item) => (
              <tr key={item.name}>
                <td>{item.name}</td>
                <td>{item.count}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </section>
  );
}
