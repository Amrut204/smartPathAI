import { Link } from "react-router-dom";

import { TopicHeatmapGrid } from "../../components/charts";
import { Card, Table } from "../../components/ui";
import { useTopicAnalytics } from "../../hooks/use-analytics";

export default function TpoAnalyticsTopicsPage() {
  const { data, isLoading, error } = useTopicAnalytics();

  if (isLoading) {
    return <Card>Loading topic analytics...</Card>;
  }

  if (error || !data) {
    return <Card>Unable to load topic analytics.</Card>;
  }

  const topTopics = data.summary.slice(0, 8).map((item) => ({
    topicId: item.topicId,
    topicName: item.topicName,
  }));

  return (
    <section className="tpo-page-shell">
      <Card>
        <h1>Topic Heatmap</h1>
        <p>Mastery distribution by student and topic.</p>
        <div className="hero-actions">
          <Link to="/tpo/analytics">Back to Hub</Link>
        </div>
      </Card>

      <Card>
        <h2>Summary</h2>
        <Table>
          <thead>
            <tr>
              <th>Topic</th>
              <th>Avg Mastery</th>
              <th>Students Covered</th>
            </tr>
          </thead>
          <tbody>
            {data.summary.map((item) => (
              <tr key={item.topicId}>
                <td>{item.topicName}</td>
                <td>{item.avgMastery.toFixed(2)}%</td>
                <td>{item.studentsCovered}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <h2>Student x Topic Grid</h2>
        <TopicHeatmapGrid students={data.students} topics={topTopics} cells={data.cells} />
      </Card>
    </section>
  );
}
