import { Card } from "../../components/ui";
import { useLeaderboard } from "../../hooks/use-leaderboard";
import { usePointsHistory } from "../../hooks/use-points-history";

export default function PointsPage() {
  const { data, error, isLoading } = useLeaderboard();
  const { data: history } = usePointsHistory(10);
  const topScore = data?.items[0]?.points ?? 0;

  if (isLoading) {
    return (
      <section className="student-workspace-shell">
        <Card className="app-state-card">Loading leaderboard...</Card>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="student-workspace-shell">
        <Card className="app-state-card app-state-card-error">Unable to load leaderboard.</Card>
      </section>
    );
  }

  return (
    <section className="student-workspace-shell points-page-shell">
      <header className="student-workspace-header">
        <div>
          <p className="resources-kicker">Points and progress</p>
          <h1>Track your momentum.</h1>
          <p>See where you stand on the leaderboard and review the activity that earned your points.</p>
        </div>
      </header>

      <section className="student-workspace-hero points-hero-grid">
        <div className="student-workspace-hero-main points-hero-main">
          <span>Your total points</span>
          <strong>{history?.totalPoints ?? 0}</strong>
          <p className="muted-text">Keep your activity steady across mocks and study sessions to move up the leaderboard.</p>
        </div>
        <div className="student-workspace-metrics points-hero-stats">
          <div>
            <span>Leaderboard entries</span>
            <strong>{data.items.length}</strong>
          </div>
          <div>
            <span>Top score</span>
            <strong>{topScore}</strong>
          </div>
        </div>
      </section>

      <div className="points-grid">
        <Card className="student-workspace-panel points-panel">
          <div className="student-workspace-panel-head">
            <div>
              <h2>Leaderboard</h2>
              <p>{data.items.length} ranked student(s)</p>
            </div>
          </div>
          <ol className="points-list">
            {data.items.map((row, index) => (
              <li key={row.id} className="points-list-row">
                <div className="points-list-rank">#{index + 1}</div>
                <div className="points-list-copy">
                  <strong>{row.userId}</strong>
                  <p>Readiness {row.readinessScore.toFixed(1)}%</p>
                </div>
                <strong className="points-list-value">{row.points} pts</strong>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="student-workspace-panel points-panel">
          <div className="student-workspace-panel-head">
            <div>
              <h2>Recent points history</h2>
              <p>{(history?.items ?? []).length} recent activity item(s)</p>
            </div>
          </div>
          {(history?.items ?? []).length > 0 ? (
            <ul className="points-history-list">
              {(history?.items ?? []).map((item) => (
                <li key={`${item.source}_${item.id}`} className="points-history-row">
                  <div>
                    <strong>{item.source === "mock_test" ? "Mock test activity" : "Study activity"}</strong>
                    <p>{new Date(item.at).toLocaleString()}</p>
                  </div>
                  <strong className="points-history-value">+{item.points}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-text">No points activity yet.</p>
          )}
        </Card>
      </div>
    </section>
  );
}
