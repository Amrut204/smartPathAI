import { Card } from "../../components/ui";
import { useLeaderboard } from "../../hooks/use-leaderboard";
import { usePointsHistory } from "../../hooks/use-points-history";

export default function PointsPage() {
  const { data, error, isLoading } = useLeaderboard();
  const { data: history } = usePointsHistory(10);

  if (isLoading) {
    return <Card>Loading leaderboard...</Card>;
  }

  if (error || !data) {
    return <Card>Unable to load leaderboard.</Card>;
  }

  return (
    <section className="dashboard-grid">
      <Card>
        <h1>Points Leaderboard</h1>
        <ol>
          {data.items.map((row) => (
            <li key={row.id}>
              {row.userId} - {row.points} points (readiness {row.readinessScore.toFixed(1)}%)
            </li>
          ))}
        </ol>
      </Card>
      <Card>
        <h2>My Points History</h2>
        <p>Total Points: {history?.totalPoints ?? 0}</p>
        <ul>
          {(history?.items ?? []).map((item) => (
            <li key={`${item.source}_${item.id}`}>
              {item.source} +{item.points} ({item.at})
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
