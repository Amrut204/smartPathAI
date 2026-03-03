import { useSearchParams } from "react-router-dom";

import { Badge, Card, Table } from "../../components/ui";
import { useMockTestResult } from "../../hooks/use-mock-tests";

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

  const totalQuestions = data.questions.length;
  const attemptedQuestions = data.answers.length;
  const correctAnswers = data.answers.filter((answer) => answer.isCorrect).length;
  const incorrectAnswers = Math.max(0, attemptedQuestions - correctAnswers);
  const unattemptedQuestions = Math.max(0, totalQuestions - attemptedQuestions);

  return (
    <section className="dashboard-grid">
      <Card>
        <h1>{data.title}</h1>
        <p>Score: {data.score.toFixed(2)}%</p>
        <p>Time Taken: {data.timeTakenSec}s</p>
        <p>Attempted: {attemptedQuestions}/{totalQuestions}</p>
        <p>Correct: {correctAnswers}</p>
        <p>Incorrect: {incorrectAnswers}</p>
        <p>Unattempted: {unattemptedQuestions}</p>
        <Badge variant={data.score >= 70 ? "success" : "warning"}>Result</Badge>
      </Card>

      <Card>
        <h2>Question Breakdown</h2>
        <Table>
          <thead>
            <tr>
              <th>#</th>
              <th>Status</th>
              <th>Selected</th>
              <th>Correct</th>
            </tr>
          </thead>
          <tbody>
            {data.answers.map((answer) => {
              const question = data.questions[answer.questionIndex];
              return (
                <tr key={`result_${answer.questionIndex}`}>
                  <td>{answer.questionIndex + 1}</td>
                  <td>{answer.isCorrect ? "Correct" : "Incorrect"}</td>
                  <td>{question?.options?.[answer.selectedOption] ?? "N/A"}</td>
                  <td>{question?.options?.[question.correctIndex] ?? "N/A"}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </section>
  );
}
