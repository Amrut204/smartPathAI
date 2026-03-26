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
    reset,
  } = useMockTestStore();

  const [timeRemaining, setTimeRemaining] = useState<number>(durationSec);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [integrityNotice, setIntegrityNotice] = useState<string | null>(null);
  const timeoutSubmitOnceRef = useRef(false);
  const integrityRef = useRef({
    copyEvents: 0,
    pasteEvents: 0,
    visibilityChanges: 0,
    blurEvents: 0,
  });

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
    integrityRef.current = {
      copyEvents: 0,
      pasteEvents: 0,
      visibilityChanges: 0,
      blurEvents: 0,
    };
    setIntegrityNotice(null);
  }, [attemptId, startedAt, durationSec]);

  useEffect(() => {
    if (bootstrapping || status !== "in_progress") {
      return;
    }

    const onCopy = () => {
      integrityRef.current.copyEvents += 1;
      setIntegrityNotice("Copy activity detected for this attempt.");
    };
    const onPaste = () => {
      integrityRef.current.pasteEvents += 1;
      setIntegrityNotice("Paste activity detected for this attempt.");
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        integrityRef.current.visibilityChanges += 1;
        setIntegrityNotice("Leaving the test tab is tracked during the attempt.");
      }
    };
    const onBlur = () => {
      integrityRef.current.blurEvents += 1;
    };

    window.addEventListener("copy", onCopy);
    window.addEventListener("paste", onPaste);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [bootstrapping, status]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!resolvedTestId) {
        setBootstrapping(false);
        return;
      }

      setBootstrapping(true);
      setSubmitError(null);

      if (
        requestedAttemptId &&
        attemptId === requestedAttemptId &&
        status === "in_progress" &&
        questions.length > 0
      ) {
        setBootstrapping(false);
        return;
      }

      if (requestedAttemptId) {
        const restored = hydrate(requestedAttemptId);
        if (restored) {
          if (!cancelled) {
            setBootstrapping(false);
          }
          return;
        }
      }

      reset();

      const started = await startMockTest(resolvedTestId);
      if (cancelled) {
        return;
      }

      initializeAttempt({
        attemptId: started.attemptId,
        testId: resolvedTestId,
        questions: started.questions,
        startedAt: started.startedAt,
        durationSec: started.durationSec,
      });
      setTimeRemaining(started.durationSec);
      timeoutSubmitOnceRef.current = false;
      navigate(`/mock-tests/${resolvedTestId}/attempt?attemptId=${started.attemptId}`, { replace: true });
      setBootstrapping(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [hydrate, initializeAttempt, navigate, requestedAttemptId, reset, resolvedTestId]);

  useEffect(() => {
    if (bootstrapping || status !== "submitted" || !attemptId || !resolvedTestId) {
      return;
    }

    navigate(`/mock-tests/${resolvedTestId}/results?attemptId=${attemptId}`, { replace: true });
  }, [attemptId, bootstrapping, navigate, resolvedTestId, status]);

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
        integrity: { ...integrityRef.current },
      });
      markSubmitted();
      navigate(`/mock-tests/${resolvedTestId}/results?attemptId=${attemptId}`, { replace: true });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to submit test");
    } finally {
      setSubmitting(false);
    }
  }, [attemptId, markSubmitted, preparedAnswers, navigate, resolvedTestId]);

  useEffect(() => {
    if (
      bootstrapping ||
      !startedAt ||
      durationSec <= 0 ||
      timeRemaining !== 0 ||
      submitting ||
      status !== "in_progress"
    ) {
      return;
    }

    if (timeoutSubmitOnceRef.current) {
      return;
    }

    timeoutSubmitOnceRef.current = true;
    void submit();
  }, [bootstrapping, durationSec, startedAt, status, submitting, submit, timeRemaining]);

  if (bootstrapping) {
    return (
      <Card>
        <Spinner />
        <p>Preparing test...</p>
      </Card>
    );
  }

  if (status === "submitted") {
    return (
      <Card>
        <Spinner />
        <p>Opening results...</p>
      </Card>
    );
  }

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
        {integrityNotice ? <p className="muted-text">{integrityNotice}</p> : null}
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
