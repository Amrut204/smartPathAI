import { Link, useParams } from "react-router-dom";

import { Button, Card } from "../../components/ui";
import { useMockTestMetadata } from "../../hooks/use-mock-tests";

export default function MockTestDetailPage() {
  const { testId } = useParams<{ testId: string }>();

  const { data, isLoading, error } = useMockTestMetadata(testId ?? null);

  if (isLoading) {
    return <Card>Loading test metadata...</Card>;
  }

  if (error || !data) {
    return <Card>Unable to load test.</Card>;
  }

  return (
    <Card>
      <h1>{data.title}</h1>
      <p>Difficulty: {data.difficulty}</p>
      <p>Duration: {Math.ceil(data.durationSec / 60)} minutes</p>
      <p>Questions: {data.questionCount}</p>
      {testId ? (
        <Link to={`/mock-tests/${testId}/attempt`}>
          <Button>Start Test</Button>
        </Link>
      ) : null}
    </Card>
  );
}
