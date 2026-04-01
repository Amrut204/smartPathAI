import { Link, useSearchParams } from "react-router-dom";

import { Badge, Button, Card, Table } from "../../components/ui";
import { useMockTestResult } from "../../hooks/use-mock-tests";

function scoreTone(score: number) {
  if (score >= 70) return "success";
  if (score >= 60) return "warning";
  return "danger";
}

export default function MockTestResultsPage() {
  const [searchParams] = useSearchParams();
  const attemptId = searchParams.get("attemptId");

  const { data, error, isLoading } = useMockTestResult(attemptId);

  if (isLoading) {
    return <Card>Loading result...</Card>;
  }

  if (error || !data) {
    return <Card>Unable to load result.</Card>;
  }

  return (
    <section className="student-workspace-shell mock-results-page">
      <section className="student-workspace-header">
        <div className="mock-hero-copy">
          <p className="resources-kicker">Result Review</p>
          <h1>{data.title}</h1>
          <p>Your score is ready. The page below focuses on what to do next, not just what happened.</p>
        </div>
      </section>

      <section className="student-workspace-panel">
        <div className="workspace-metrics-grid">
          <div className="workspace-metric">
            <span>Score</span>
            <strong>{data.score.toFixed(1)}%</strong>
            <Badge variant={scoreTone(data.score)}>Current result</Badge>
          </div>
          <div className="workspace-metric">
            <span>Attempted</span>
            <strong>{data.attemptedQuestions}/{data.questions.length}</strong>
            <p className="muted-text">Correct {data.correctAnswers} · Incorrect {data.incorrectAnswers}</p>
          </div>
          <div className="workspace-metric">
            <span>Time Taken</span>
            <strong>{Math.ceil(data.timeTakenSec / 60)} min</strong>
            <p className="muted-text">Unattempted {data.unattemptedQuestions}</p>
          </div>
          <div className="workspace-metric">
            <span>Percentile</span>
            <strong>{data.percentileRank !== null ? `${Math.round(data.percentileRank)}th` : "Pending"}</strong>
            <p className="muted-text">
              {data.percentileRank !== null
                ? `Based on ${data.attemptPopulation} submitted attempts for this test.`
                : `Shown after at least 15 attempts. Current population: ${data.attemptPopulation}.`}
            </p>
          </div>
        </div>
      </section>

      <section className="mock-section mock-section-company">
        <div className="mock-section-header">
          <div>
            <p className="resources-section-eyebrow">What Next</p>
            <h2>Take this next</h2>
            <p>Use these next steps to convert this result into actual preparation progress.</p>
          </div>
        </div>

        {data.retrySuggested ? (
          <Card className="workspace-block">
            <h3>Retry recommended</h3>
            <p className="muted-text">
              Your score is still below {60}% and enough time has passed since the last attempt. A retry is worth doing after a short revision round.
            </p>
            <div className="hero-actions">
              <Link to={`/mock-tests/${data.testId}`}>
                <Button variant="secondary">Open Test Again</Button>
              </Link>
            </div>
          </Card>
        ) : null}

        {data.weakAreas.length > 0 ? (
          <Card className="workspace-block">
            <h3>Weak areas detected</h3>
            <div className="resource-topic-chips">
              {data.weakAreas.map((area) => (
                <span key={area.skillTag} className="resource-topic-chip resource-topic-chip-reason">
                  {area.skillTag} · {Math.round(area.masteryLevel)}%
                </span>
              ))}
            </div>
          </Card>
        ) : null}

        {data.nextRecommendedTests.length > 0 ? (
          <div className="mock-discovery-grid">
            {data.nextRecommendedTests.map((test) => (
              <Card key={test.id} className="mock-discovery-card">
                <div className="mock-discovery-head">
                  <div>
                    <h3>{test.title}</h3>
                    <p>{test.topicName ?? "Practice test"}{test.companyName ? ` - ${test.companyName}` : ""}</p>
                  </div>
                  <Badge variant={scoreTone(test.lastScore ?? 70)}>{test.difficulty}</Badge>
                </div>
                {(test.recommendationReasons?.length ?? 0) > 0 ? (
                  <div className="resource-topic-chips">
                    {(test.recommendationReasons ?? []).map((reason) => (
                      <span key={`${test.id}_${reason}`} className="resource-topic-chip resource-topic-chip-reason">{reason}</span>
                    ))}
                  </div>
                ) : null}
                <div className="mock-discovery-stats">
                  <div>
                    <span>Duration</span>
                    <strong>{Math.ceil(test.durationSec / 60)} min</strong>
                  </div>
                  <div>
                    <span>Attempts</span>
                    <strong>{test.attemptCount}</strong>
                  </div>
                </div>
                <div className="mock-discovery-footer">
                  <Link to={`/mock-tests/${test.id}`}>
                    <Button>Open Test</Button>
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mock-section">
        <div className="mock-section-header">
          <div>
            <p className="resources-section-eyebrow">Question Review</p>
            <h2>Question breakdown</h2>
            <p>Review answers, compare with the correct options, and use explanations where available.</p>
          </div>
        </div>

        <div className="workspace-table-wrap">
          <Table>
            <thead>
              <tr>
                <th>#</th>
                <th>Status</th>
                <th>Skill</th>
                <th>Selected</th>
                <th>Correct</th>
              </tr>
            </thead>
            <tbody>
              {data.questions.map((question, index) => {
                const answer = data.answers.find((item) => item.questionIndex === index);
                return (
                  <tr key={`result_${index}`}>
                    <td>{index + 1}</td>
                    <td>
                      {!answer ? "Unattempted" : answer.isCorrect ? "Correct" : "Incorrect"}
                    </td>
                    <td>{question.skillTag || "-"}</td>
                    <td>{answer ? question.options?.[answer.selectedOption] ?? "N/A" : "-"}</td>
                    <td>{question.options?.[question.correctIndex] ?? "N/A"}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </section>
    </section>
  );
}
