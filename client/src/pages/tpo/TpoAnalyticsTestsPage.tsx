import { Link } from "react-router-dom";

import { BatchReadinessBarChart } from "../../components/charts";
import { Card, Table } from "../../components/ui";
import { useTestAnalytics } from "../../hooks/use-analytics";

export default function TpoAnalyticsTestsPage() {
  const { data, isLoading, error } = useTestAnalytics();

  if (isLoading) {
    return <Card>Loading test analytics...</Card>;
  }

  if (error || !data) {
    return <Card>Unable to load test analytics.</Card>;
  }

  const chartData = data.tests.map((item) => ({
    label: item.title.length > 20 ? `${item.title.slice(0, 20)}...` : item.title,
    completionRate: item.completionRate,
  }));

  return (
    <section className="dashboard-grid">
      <Card>
        <h1>Test Completion Analytics</h1>
        <p>Completion coverage and performance by mock test.</p>
        <div className="hero-actions">
          <Link to="/tpo/analytics">Back to Hub</Link>
        </div>
      </Card>

      <Card>
        <h2>Completion Rate by Test</h2>
        <BatchReadinessBarChart data={chartData} dataKey="completionRate" xKey="label" />
      </Card>

      <Card>
        <h2>Detailed Test Metrics</h2>
        <Table>
          <thead>
            <tr>
              <th>Test</th>
              <th>Difficulty</th>
              <th>Completed Students</th>
              <th>Completion Rate</th>
              <th>Average Score</th>
            </tr>
          </thead>
          <tbody>
            {data.tests.map((item) => (
              <tr key={item.testId}>
                <td>{item.title}</td>
                <td>{item.difficulty}</td>
                <td>{item.completedStudents}</td>
                <td>{item.completionRate.toFixed(2)}%</td>
                <td>{item.averageScore.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </section>
  );
}
