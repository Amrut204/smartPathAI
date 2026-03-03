import { useState, type FormEvent } from "react";

import { Badge, Button, Card, Input, Progress, Spinner } from "../../components/ui";
import { logStudyHours } from "../../hooks/use-study-hours";
import { useStudentDashboard } from "../../hooks/use-student-dashboard";

export default function DashboardPage() {
  const { data, error, isLoading, mutate } = useStudentDashboard();

  const [topicId, setTopicId] = useState("");
  const [hours, setHours] = useState("2");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      await logStudyHours({
        topicId,
        hours: Number(hours),
      });
      setTopicId("");
      await mutate();
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : "Failed to log study hours");
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="dashboard-grid">
        <Card>
          <Spinner />
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <h2>Unable to load dashboard</h2>
        <p>{error instanceof Error ? error.message : "Unknown error"}</p>
      </Card>
    );
  }

  return (
    <section className="dashboard-grid">
      <Card>
        <h2>Readiness Score</h2>
        <p>{data.readinessScore.toFixed(1)}%</p>
        <Progress value={data.readinessScore} />
      </Card>

      <Card>
        <h2>Study Hours</h2>
        <p>Today: {data.studyHoursToday.toFixed(1)}h</p>
        <p>This week: {data.studyHoursWeek.toFixed(1)}h</p>
      </Card>

      <Card>
        <h2>Leaderboard Rank</h2>
        <p>
          #{data.studentRank} / {data.totalStudents}
        </p>
        <p className="muted-text">Rank is based on total points.</p>
      </Card>

      <Card>
        <h2>Points & Streak</h2>
        <p>Points: {data.totalPoints}</p>
        <p>
          Streak: {data.streakCurrent} day(s), best {data.streakLongest}
        </p>
      </Card>

      <Card>
        <h2>Weak Areas</h2>
        {data.weakAreas.length === 0 ? (
          <p>No weak areas recorded yet.</p>
        ) : (
          <ul>
            {data.weakAreas.map((weakArea) => (
              <li key={weakArea.topicId}>
                <span>{weakArea.topicName}</span> - <Badge variant="warning">{weakArea.masteryLevel}%</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2>Studied Topics</h2>
        {data.studiedTopics.length === 0 ? (
          <p>No study logs yet.</p>
        ) : (
          <ul>
            {data.studiedTopics.map((topic) => (
              <li key={topic.topicId}>
                <span>{topic.topicName}</span> - {topic.totalHours.toFixed(1)}h ({topic.sessions} sessions)
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2>Recommended Test</h2>
        {data.recommendedTest ? (
          <>
            <p>{data.recommendedTest.title}</p>
            <p>{data.recommendedTest.difficulty}</p>
          </>
        ) : (
          <p>No test available.</p>
        )}
      </Card>

      <Card>
        <h2>Log Study Hours</h2>
        <form className="form-grid" onSubmit={onSubmit}>
          <label>
            Topic ID
            <Input
              value={topicId}
              onChange={(event) => setTopicId(event.target.value)}
              placeholder="Topic UUID (for example from Topic Mastery/Resources)"
              required
            />
          </label>
          <label>
            Hours
            <Input
              type="number"
              min="0.25"
              max="12"
              step="0.25"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              required
            />
          </label>
          {formError ? <p className="error-text">{formError}</p> : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Logging..." : "Log Hours"}
          </Button>
        </form>
      </Card>
    </section>
  );
}
