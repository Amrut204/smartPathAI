import { useNavigate, useParams } from "react-router-dom";
import { useState } from "react";

import { Button, Card } from "../../components/ui";
import { startMockTest, useMockTestMetadata } from "../../hooks/use-mock-tests";

export default function MockTestDetailPage() {
  const navigate = useNavigate();
  const { testId } = useParams<{ testId: string }>();

  const { data, isLoading, error } = useMockTestMetadata(testId ?? null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const onStart = async () => {
    if (!testId) {
      return;
    }

    setStartError(null);
    setStarting(true);

    try {
      const started = await startMockTest(testId);
      navigate(`/mock-tests/${testId}/attempt?attemptId=${started.attemptId}`);
    } catch (submitError) {
      setStartError(submitError instanceof Error ? submitError.message : "Unable to start test");
    } finally {
      setStarting(false);
    }
  };

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
      {startError ? <p className="error-text">{startError}</p> : null}
      <Button onClick={onStart} disabled={starting}>
        {starting ? "Starting..." : "Start Test"}
      </Button>
    </Card>
  );
}
