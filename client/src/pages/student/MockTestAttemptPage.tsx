import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";

import { Button, Card, Spinner } from "../../components/ui";
import { startMockTest, submitMockTest } from "../../hooks/use-mock-tests";
import { useMockTestStore } from "../../stores/mock-test-store";

function generateIdempotencyKey(): string {
  return `submit_${crypto.randomUUID()}`;
}

function formatDuration(totalSec: number): string {
  const safe = Math.max(0, totalSec);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function MockTestAttemptPage() {
  const navigate = useNavigate();
  const { testId } = useParams<{ testId: string }>();
  const [searchParams] = useSearchParams();

  const resolvedTestId = testId ?? "";
  const requestedAttemptId = searchParams.get("attemptId");

  const {
    attemptId,
    questions,
    answers,
    currentQuestion,
    startedAt,
    durationSec,
    status,
    initializeAttempt,
    selectAnswer,
    nextQuestion,
    previousQuestion,
    goToQuestion,
    hydrate,
    markSubmitted,
  } = useMockTestStore();

  const [timeRemaining, setTimeRemaining] = useState<number>(durationSec);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const timeoutSubmitOnceRef = useRef(false);

  useEffect(() => {
    if (!startedAt || durationSec <= 0) {
      setTimeRemaining(durationSec);
      return;
    }

    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    setTimeRemaining(Math.max(0, durationSec - elapsed));
  }, [durationSec, startedAt]);

  useEffect(() => {
    timeoutSubmitOnceRef.current = false;
  }, [attemptId, startedAt, durationSec]);

  useEffect(() => {
    const load = async () => {
      if (!resolvedTestId) {
        return;
      }

      const targetAttemptId = requestedAttemptId ?? attemptId;
      if (targetAttemptId) {
        hydrate(targetAttemptId);
      }

      const shouldStart = !targetAttemptId || (attemptId !== targetAttemptId && questions.length === 0);
      if (!shouldStart) {
        return;
      }

      const started = await startMockTest(resolvedTestId);
      initializeAttempt({
        attemptId: started.attemptId,
        testId: resolvedTestId,
        questions: started.questions,
        startedAt: started.startedAt,
        durationSec: started.durationSec,
      });
      navigate(`/mock-tests/${resolvedTestId}/attempt?attemptId=${started.attemptId}`, { replace: true });
    };

    void load();
  }, [attemptId, hydrate, initializeAttempt, questions.length, requestedAttemptId, navigate, resolvedTestId]);

  useEffect(() => {
    if (!startedAt || durationSec <= 0 || status !== "in_progress") {
      return;
    }

    const intervalId = window.setInterval(() => {
      const now = Date.now();
      const startedMillis = new Date(startedAt).getTime();
      const elapsedSec = Math.max(0, Math.floor((now - startedMillis) / 1000));
      const remaining = Math.max(0, durationSec - elapsedSec);
      setTimeRemaining(remaining);

      if (remaining === 0) {
        window.clearInterval(intervalId);
      }
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [durationSec, startedAt, status]);

  const preparedAnswers = useMemo(
    () =>
      Object.entries(answers).map(([questionIndex, selectedOption]) => ({
        questionIndex: Number(questionIndex),
        selectedOption,
      })),
    [answers],
  );

  const submit = useCallback(async () => {
    if (!attemptId || !resolvedTestId) {
      return;
    }

    setSubmitError(null);
    setSubmitting(true);

    try {
      await submitMockTest(resolvedTestId, {
        attemptId,
        idempotencyKey: generateIdempotencyKey(),
        answers: preparedAnswers,
      });
      markSubmitted();
      navigate(`/mock-tests/${resolvedTestId}/results?attemptId=${attemptId}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to submit test");
    } finally {
      setSubmitting(false);
    }
  }, [attemptId, markSubmitted, preparedAnswers, navigate, resolvedTestId]);

  useEffect(() => {
    if (!startedAt || timeRemaining !== 0 || submitting || status !== "in_progress") {
      return;
    }

    if (timeoutSubmitOnceRef.current) {
      return;
    }

    timeoutSubmitOnceRef.current = true;
    void submit();
  }, [startedAt, status, submitting, submit, timeRemaining]);

  if (questions.length === 0) {
    return (
      <Card>
        <Spinner />
        <p>Preparing test...</p>
      </Card>
    );
  }

  const question = questions[currentQuestion];

  return (
    <section className="mock-attempt-layout">
      <Card className="mock-attempt-question-card">
        <h2>
          Question {currentQuestion + 1} / {questions.length}
        </h2>
        <p className="mock-attempt-timer">
          Time remaining: <span>{formatDuration(timeRemaining)}</span>
        </p>
        <p>{question.text}</p>
        <div className="mock-attempt-options">
          {question.options.map((option, index) => (
            <label key={`${currentQuestion}_${index}`} className="mock-attempt-option">
              <input
                type="radio"
                name={`question_${currentQuestion}`}
                checked={answers[currentQuestion] === index}
                onChange={() => selectAnswer(currentQuestion, index)}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
        <div className="hero-actions">
          <Button variant="ghost" onClick={previousQuestion} disabled={currentQuestion === 0}>
            Previous
          </Button>
          <Button
            variant="secondary"
            onClick={nextQuestion}
            disabled={currentQuestion >= questions.length - 1}
          >
            Next
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit"}
          </Button>
        </div>
        {submitError ? <p className="error-text">{submitError}</p> : null}
      </Card>

      <Card className="mock-attempt-nav-card">
        <h3>Navigator</h3>
        <div className="mock-attempt-nav-grid">
          {questions.map((_, index) => (
            <Button
              key={`nav_${index}`}
              className="mock-attempt-nav-btn"
              variant={answers[index] !== undefined ? "secondary" : "ghost"}
              onClick={() => goToQuestion(index)}
            >
              {index + 1}
            </Button>
          ))}
        </div>
      </Card>
    </section>
  );
}
