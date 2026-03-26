import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Badge, Button, Card, Input, Progress, Spinner } from "../../components/ui";
import {
  analyzeInterviewAnswer,
  completeInterviewSession,
  generateActionPlan,
  saveCodingProfile,
  startInterviewSession,
  useStudentCareerHub,
} from "../../hooks/use-career";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionConstructorLike {
  new (): SpeechRecognitionLike;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
  }
}

function getSpeechRecognitionCtor() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function deltaTone(value: number): "success" | "danger" | "default" {
  if (value > 0) {
    return "success";
  }
  if (value < 0) {
    return "danger";
  }
  return "default";
}

function formatDelta(value: number) {
  const rounded = Number(value.toFixed(1));
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

export default function CareerLabPage() {
  const { data, error, isLoading, mutate } = useStudentCareerHub();
  const [interviewForm, setInterviewForm] = useState({
    company: "Infosys",
    role: "Software Engineer",
    focusArea: "Data Structures",
    difficulty: "core" as "foundation" | "core" | "advanced",
  });
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [recordingDurationSec, setRecordingDurationSec] = useState(0);
  const [listening, setListening] = useState(false);
  const [micPermission, setMicPermission] = useState<"unknown" | "granted" | "denied" | "unsupported">("unknown");
  const [waveformLevels, setWaveformLevels] = useState<number[]>(Array.from({ length: 24 }, () => 0.18));
  const [codingForm, setCodingForm] = useState({
    platform: "LeetCode",
    handle: "",
    solvedCount: "0",
    weeklyGoal: "10",
    streakDays: "0",
  });
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const recordingStartedAtRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const activeSession = data?.interviewSimulator.history[0] ?? null;
  const activeQuestion = activeSession?.questions[currentQuestionIndex] ?? null;
  const activeFeedback = activeSession?.answer_feedback?.[currentQuestionIndex] ?? null;
  const micSupported = Boolean(getSpeechRecognitionCtor());
  const answeredCount = activeSession?.answers.filter((item) => item && item.trim().length >= 20).length ?? 0;
  const isReadyToComplete = activeSession
    ? activeSession.questions.every((_, index) => (activeSession.answers[index] ?? "").trim().length >= 20)
    : false;

  useEffect(() => {
    if (!activeSession) {
      setCurrentQuestionIndex(0);
      setDraftAnswer("");
      setInterimTranscript("");
      setRecordingDurationSec(0);
      return;
    }

    const firstIncompleteIndex = activeSession.answers.findIndex((answer) => !answer || answer.trim().length < 20);
    setCurrentQuestionIndex(firstIncompleteIndex >= 0 ? firstIncompleteIndex : 0);
  }, [activeSession?.id]);

  useEffect(() => {
    if (!activeSession) {
      setDraftAnswer("");
      setInterimTranscript("");
      setRecordingDurationSec(0);
      return;
    }

    setDraftAnswer(activeSession.answers[currentQuestionIndex] ?? "");
    setInterimTranscript("");
    setRecordingDurationSec(activeSession.answer_feedback?.[currentQuestionIndex]?.durationSec ?? 0);
  }, [activeSession, currentQuestionIndex]);

  useEffect(() => () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
    }
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close();
    }
  }, []);

  const resetWaveform = () => {
    setWaveformLevels(Array.from({ length: 24 }, () => 0.18));
  };

  const stopAudioMonitoring = () => {
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    resetWaveform();
  };

  const startWaveformMonitoring = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicPermission("unsupported");
      throw new Error("Microphone capture is not supported in this browser.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;
    setMicPermission("granted");

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    analyserRef.current = analyser;

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!analyserRef.current) {
        return;
      }
      analyserRef.current.getByteFrequencyData(buffer);
      const bucketSize = Math.max(1, Math.floor(buffer.length / 24));
      const nextLevels = Array.from({ length: 24 }, (_, index) => {
        const start = index * bucketSize;
        const end = Math.min(buffer.length, start + bucketSize);
        let total = 0;
        for (let position = start; position < end; position += 1) {
          total += buffer[position] ?? 0;
        }
        const average = end > start ? total / (end - start) : 0;
        return Math.max(0.12, Math.min(1, average / 180));
      });
      setWaveformLevels(nextLevels);
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    tick();
  };

  const stopVoiceCapture = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopAudioMonitoring();
  };

  const startVoiceCapture = async () => {
    const RecognitionCtor = getSpeechRecognitionCtor();
    if (!RecognitionCtor) {
      setMicPermission("unsupported");
      setStatus("Browser speech recognition is not available. Use manual transcript entry on this device.");
      return;
    }

    stopVoiceCapture();
    const recognition = new RecognitionCtor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognitionRef.current = recognition;
    transcriptRef.current = "";
    setDraftAnswer("");
    setInterimTranscript("");
    setStatus(null);
    setListening(true);
    recordingStartedAtRef.current = Date.now();
    setRecordingDurationSec(0);

    try {
      await startWaveformMonitoring();
    } catch (error) {
      setListening(false);
      setMicPermission("denied");
      setStatus(error instanceof Error ? error.message : "Microphone access was denied.");
      return;
    }

    timerRef.current = window.setInterval(() => {
      if (!recordingStartedAtRef.current) {
        return;
      }
      setRecordingDurationSec((Date.now() - recordingStartedAtRef.current) / 1000);
    }, 250);

    recognition.onresult = (event) => {
      let finalTranscript = "";
      let interim = "";

      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const chunk = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalTranscript += chunk;
        } else {
          interim += chunk;
        }
      }

      transcriptRef.current = finalTranscript.trim();
      setDraftAnswer(transcriptRef.current);
      setInterimTranscript(interim.trim());
    };

    recognition.onerror = () => {
      setListening(false);
      stopAudioMonitoring();
      setStatus("Voice capture failed. Check microphone permission and try again.");
      if (micPermission !== "unsupported") {
        setMicPermission("denied");
      }
    };

    recognition.onend = () => {
      setListening(false);
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (recordingStartedAtRef.current) {
        setRecordingDurationSec((Date.now() - recordingStartedAtRef.current) / 1000);
      }
      stopAudioMonitoring();
    };

    recognition.start();
  };

  const onStartInterview = async () => {
    setBusy("interview");
    setStatus(null);
    try {
      await startInterviewSession(interviewForm);
      await mutate();
      setStatus("Voice interview session generated.");
    } catch (submitError) {
      setStatus(submitError instanceof Error ? submitError.message : "Unable to start interview session");
    } finally {
      setBusy(null);
    }
  };

  const onAnalyzeAnswer = async () => {
    if (!activeSession || !activeQuestion) {
      return;
    }

    const transcript = draftAnswer.trim();
    if (transcript.length < 20) {
      setStatus("Speak a longer answer or edit the transcript before analysis.");
      return;
    }

    setBusy("analyze-answer");
    setStatus(null);
    try {
      await analyzeInterviewAnswer({
        sessionId: activeSession.id,
        questionIndex: currentQuestionIndex,
        transcript,
        durationSec: Math.max(1, Number(recordingDurationSec.toFixed(1))),
      });
      await mutate();
      setStatus("Answer analyzed with AI feedback.");
    } catch (submitError) {
      setStatus(submitError instanceof Error ? submitError.message : "Unable to analyze answer");
    } finally {
      setBusy(null);
    }
  };

  const onCompleteInterview = async () => {
    if (!activeSession) {
      return;
    }

    setBusy("complete-interview");
    setStatus(null);
    try {
      await completeInterviewSession(activeSession.id, activeSession.answers);
      await mutate();
      setStatus("Voice interview completed.");
    } catch (submitError) {
      setStatus(submitError instanceof Error ? submitError.message : "Unable to complete interview");
    } finally {
      setBusy(null);
    }
  };

  const onGeneratePlan = async () => {
    setBusy("plan");
    setStatus(null);
    try {
      await generateActionPlan();
      await mutate();
      setStatus("Weekly action plan refreshed.");
    } catch (submitError) {
      setStatus(submitError instanceof Error ? submitError.message : "Unable to generate action plan");
    } finally {
      setBusy(null);
    }
  };

  const onSaveCodingProfile = async () => {
    setBusy("coding");
    setStatus(null);
    try {
      await saveCodingProfile({
        platform: codingForm.platform,
        handle: codingForm.handle,
        solvedCount: Number(codingForm.solvedCount),
        weeklyGoal: Number(codingForm.weeklyGoal),
        streakDays: Number(codingForm.streakDays),
      });
      await mutate();
      setStatus("Coding tracker synced.");
      setCodingForm((current) => ({ ...current, handle: "" }));
    } catch (submitError) {
      setStatus(submitError instanceof Error ? submitError.message : "Unable to save coding profile");
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return <Card className="app-state-card"><Spinner /><p className="muted-text">Loading career lab...</p></Card>;
  }

  if (error || !data) {
    return <Card className="app-state-card app-state-card-error"><h2>Unable to load career lab</h2></Card>;
  }

  return (
    <section className="career-page">
      <Card className="career-hero-card">
        <h1>Career Lab</h1>
        <p className="muted-text">
          Assess, practice, improve, and retry from one workflow. Career Lab now links your weak areas directly to the next resource, mock, and interview action.
        </p>
        <div className="career-stat-grid">
          <div>
            <h3>Readiness</h3>
            <p>{data.student.readinessScore.toFixed(1)}%</p>
          </div>
          <div>
            <h3>Predictor</h3>
            <p>{data.placementPredictor.shortlistProbability}% shortlist chance</p>
          </div>
          <div>
            <h3>Weak Areas</h3>
            <p>{data.weakAreas.map((item) => item.topicName).join(", ") || "None"}</p>
          </div>
          <div>
            <h3>Active Days</h3>
            <p>{data.workflow.progressTrend.activeDays7d}/7 this week</p>
          </div>
        </div>
      </Card>

      <div className="career-workflow-grid">
        <Card className="career-workflow-card">
          <div className="career-section-heading">
            <div>
              <p className="resources-kicker">Next Best Moves</p>
              <h2>Career Workflow</h2>
            </div>
            <Badge>{data.workflow.nextActions.length} live actions</Badge>
          </div>
          <div className="career-next-actions">
            {data.workflow.nextActions.map((action) => (
              <div key={action.id} className="career-action-card">
                <h3>{action.title}</h3>
                <p className="muted-text">{action.detail}</p>
                {action.href.startsWith("#") ? (
                  <Button
                    variant={action.tone}
                    type="button"
                    onClick={() => {
                      window.location.hash = action.href.slice(1);
                    }}
                  >
                    {action.ctaLabel}
                  </Button>
                ) : (
                  <Link to={action.href}>
                    <Button variant={action.tone}>{action.ctaLabel}</Button>
                  </Link>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card className="career-workflow-card">
          <div className="career-section-heading">
            <div>
              <p className="resources-kicker">Progress Snapshot</p>
              <h2>Improvement Trend</h2>
            </div>
          </div>
          <div className="career-progress-grid">
            <div className="career-progress-card">
              <h3>Mock Trend</h3>
              <p className="career-score">{data.workflow.progressTrend.mockAverageCurrent.toFixed(1)}</p>
              <Badge variant={deltaTone(data.workflow.progressTrend.mockAverageDelta)}>
                {formatDelta(data.workflow.progressTrend.mockAverageDelta)} vs previous block
              </Badge>
            </div>
            <div className="career-progress-card">
              <h3>Interview Trend</h3>
              <p className="career-score">{data.workflow.progressTrend.interviewAverageCurrent.toFixed(1)}</p>
              <Badge variant={deltaTone(data.workflow.progressTrend.interviewAverageDelta)}>
                {formatDelta(data.workflow.progressTrend.interviewAverageDelta)} vs previous block
              </Badge>
            </div>
            <div className="career-progress-card">
              <h3>Study Effort</h3>
              <p className="career-score">{data.workflow.progressTrend.recentStudyHours.toFixed(1)}h</p>
              <span className="muted-text">{data.workflow.progressTrend.activeDays7d} active days in the last week</span>
            </div>
            <div className="career-progress-card">
              <h3>Coding Volume</h3>
              <p className="career-score">{data.workflow.progressTrend.codingSolved}</p>
              <span className="muted-text">Solved problems tracked across synced profiles</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="career-grid">
        <div id="career-interview">
        <Card>
          <h2>Voice Interview Simulator</h2>
          <div className="form-grid">
            <label>
              Company
              <Input
                value={interviewForm.company}
                onChange={(event) => setInterviewForm((current) => ({ ...current, company: event.target.value }))}
              />
            </label>
            <label>
              Role
              <Input
                value={interviewForm.role}
                onChange={(event) => setInterviewForm((current) => ({ ...current, role: event.target.value }))}
              />
            </label>
            <label>
              Focus Area
              <Input
                value={interviewForm.focusArea}
                onChange={(event) => setInterviewForm((current) => ({ ...current, focusArea: event.target.value }))}
              />
            </label>
            <label>
              Difficulty
              <select
                className="ui-select"
                value={interviewForm.difficulty}
                onChange={(event) =>
                  setInterviewForm((current) => ({
                    ...current,
                    difficulty: event.target.value as "foundation" | "core" | "advanced",
                  }))}
              >
                <option value="foundation">Foundation</option>
                <option value="core">Core</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
            <Button onClick={onStartInterview} disabled={busy === "interview"}>
              {busy === "interview" ? "Generating..." : "Start Voice Interview"}
            </Button>
          </div>

          {activeSession && activeQuestion ? (
            <div className="career-section-stack">
              <div className="career-focus-banner">
                <div>
                  <strong>{data.workflow.interviewFocus.targetCompany} · {data.workflow.interviewFocus.roleTrack}</strong>
                  <p className="muted-text">
                    Focus now: {data.workflow.interviewFocus.targetFocusArea} | Categories: {data.workflow.interviewFocus.recommendedQuestionCategories.join(", ")}
                  </p>
                </div>
                <div className="career-focus-score">
                  <span>Latest</span>
                  <strong>{data.workflow.interviewFocus.latestScore?.toFixed(1) ?? "New"}</strong>
                </div>
              </div>

              <div className="career-list-row">
                <div>
                  <strong>{activeSession.company} - {activeSession.role}</strong>
                  <p className="muted-text">
                    Question {currentQuestionIndex + 1} of {activeSession.questions.length} | Answered {answeredCount}
                  </p>
                </div>
                <Badge variant={activeSession.status === "completed" ? "success" : "warning"}>
                  {activeSession.status}
                </Badge>
              </div>

              <div className="career-question-nav">
                {activeSession.questions.map((question, index) => (
                  <button
                    key={question.id}
                    type="button"
                    className={`career-question-chip${index === currentQuestionIndex ? " active" : ""}`}
                    onClick={() => setCurrentQuestionIndex(index)}
                  >
                    Q{index + 1}
                  </button>
                ))}
              </div>

              <div className="career-voice-panel">
                <p className="career-question-text">{activeQuestion.prompt}</p>
                <div className="career-voice-stats">
                  <span>{listening ? "Listening..." : "Ready"}</span>
                  <span>{recordingDurationSec.toFixed(1)}s</span>
                  <span>
                    {micPermission === "granted" ? "Mic connected" : micPermission === "denied" ? "Mic blocked" : micSupported ? "Mic ready" : "Manual transcript only"}
                  </span>
                </div>
                <div className={`career-waveform${listening ? " active" : ""}`}>
                  {waveformLevels.map((level, index) => (
                    <span
                      key={index}
                      className="career-waveform-bar"
                      style={{ transform: `scaleY(${level})` }}
                    />
                  ))}
                </div>
                {!micSupported || micPermission === "denied" || micPermission === "unsupported" ? (
                  <div className="career-mic-fallback">
                    <h3>Microphone Fallback</h3>
                    <p className="muted-text">
                      {!micSupported || micPermission === "unsupported"
                        ? "This browser does not support speech recognition. You can still paste or type the transcript manually."
                        : "Microphone permission is blocked. Allow microphone access in the browser and retry, or use manual transcript mode."}
                    </p>
                    <div className="hero-actions">
                      <Button variant="secondary" onClick={() => void startVoiceCapture()}>
                        Retry Microphone
                      </Button>
                    </div>
                  </div>
                ) : null}
                <div className="hero-actions">
                  <Button onClick={() => void startVoiceCapture()} disabled={listening || activeSession.status === "completed"}>
                    {listening ? "Recording..." : "Record Answer"}
                  </Button>
                  <Button variant="secondary" onClick={stopVoiceCapture} disabled={!listening}>
                    Stop Recording
                  </Button>
                  <Button onClick={onAnalyzeAnswer} disabled={busy === "analyze-answer" || activeSession.status === "completed"}>
                    {busy === "analyze-answer" ? "Analyzing..." : "Analyze with AI"}
                  </Button>
                </div>

                <label className="career-textarea-row">
                  <span>Transcript</span>
                  <textarea
                    rows={6}
                    value={draftAnswer}
                    disabled={activeSession.status === "completed"}
                    onChange={(event) => setDraftAnswer(event.target.value)}
                    placeholder="Your spoken answer transcript will appear here. You can edit it before AI analysis."
                  />
                </label>
                {interimTranscript ? <p className="muted-text">Live transcript: {interimTranscript}</p> : null}

                {activeFeedback ? (
                  <div className="career-feedback-grid">
                    <div className="career-feedback-card">
                      <h3>AI Score</h3>
                      <p className="career-score">{activeFeedback.overallScore}%</p>
                      <Progress value={activeFeedback.overallScore} />
                    </div>
                    <div className="career-feedback-card">
                      <h3>Delivery Signals</h3>
                      <ul className="tpo-list">
                        <li>Pace: {activeFeedback.wordsPerMinute} WPM</li>
                        <li>Filler Words: {activeFeedback.fillerCount}</li>
                        <li>Duration: {activeFeedback.durationSec.toFixed(1)}s</li>
                      </ul>
                    </div>
                    <div className="career-feedback-card">
                      <h3>Rubric</h3>
                      <ul className="tpo-list">
                        <li>Relevance: {activeFeedback.rubric.relevance}/25</li>
                        <li>Structure: {activeFeedback.rubric.structure}/20</li>
                        <li>Clarity: {activeFeedback.rubric.clarity}/15</li>
                        <li>Confidence: {activeFeedback.rubric.confidence}/15</li>
                      </ul>
                    </div>
                    <div className="career-feedback-card">
                      <h3>Strengths</h3>
                      <ul className="tpo-list">
                        {activeFeedback.strengths.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                    <div className="career-feedback-card">
                      <h3>Improvements</h3>
                      <ul className="tpo-list">
                        {activeFeedback.improvements.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                    <div className="career-feedback-card">
                      <h3>Coach Rewrite</h3>
                      <p className="muted-text">{activeFeedback.improvedAnswer}</p>
                      <p><strong>Follow-up:</strong> {activeFeedback.followUpQuestion}</p>
                    </div>
                  </div>
                ) : (
                  <p className="muted-text">Record a spoken answer, review the transcript, then run AI analysis.</p>
                )}

                <div className="hero-actions">
                  <Button
                    variant="secondary"
                    onClick={() => setCurrentQuestionIndex((current) => Math.max(0, current - 1))}
                    disabled={currentQuestionIndex === 0}
                  >
                    Previous Question
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setCurrentQuestionIndex((current) => Math.min(activeSession.questions.length - 1, current + 1))}
                    disabled={currentQuestionIndex >= activeSession.questions.length - 1}
                  >
                    Next Question
                  </Button>
                  <Button onClick={onCompleteInterview} disabled={!isReadyToComplete || busy === "complete-interview"}>
                    {busy === "complete-interview" ? "Finishing..." : "Complete Interview"}
                  </Button>
                </div>
              </div>

              {activeSession.overall_score !== null ? (
                <div>
                  <p><strong>Final Score:</strong> {activeSession.overall_score.toFixed(1)}</p>
                  <p className="muted-text">{activeSession.feedback}</p>
                </div>
              ) : null}

              <Card className="career-inline-card">
                <h3>Retry Coaching</h3>
                <p className="muted-text">{data.workflow.interviewFocus.retryReason}</p>
                <div className="hero-actions">
                  <Button
                    variant="secondary"
                    onClick={() => setInterviewForm((current) => ({
                      ...current,
                      company: data.workflow.interviewFocus.targetCompany,
                      role: data.workflow.interviewFocus.roleTrack,
                      focusArea: data.workflow.interviewFocus.targetFocusArea,
                    }))}
                  >
                    Reuse This Setup
                  </Button>
                </div>
              </Card>
            </div>
          ) : (
            <p className="muted-text">No interview session started yet.</p>
          )}
        </Card>
        </div>

        <Card>
          <h2>Placement Predictor</h2>
          <p className="career-score">{data.placementPredictor.shortlistProbability}%</p>
          <Progress value={data.placementPredictor.shortlistProbability} />
          <p>
            <Badge variant={data.placementPredictor.band === "High" ? "success" : data.placementPredictor.band === "Moderate" ? "warning" : "danger"}>
              {data.placementPredictor.band}
            </Badge>
          </p>
          <ul className="tpo-list">
            <li>Readiness: {data.placementPredictor.signals.readiness.toFixed(1)}</li>
            <li>Mock Avg: {data.placementPredictor.signals.mockAverage.toFixed(1)}</li>
            <li>Coding Solved: {data.placementPredictor.signals.codingSolved}</li>
            <li>Study Hours: {data.placementPredictor.signals.studyHours.toFixed(1)}</li>
          </ul>
          <p><strong>Next Best Action:</strong> {data.placementPredictor.nextBestAction}</p>
          <Card className="career-inline-card">
            <h3>Why this score looks like this</h3>
            <ul className="tpo-list">
              <li>Mock momentum: {data.workflow.progressTrend.mockAverageCurrent.toFixed(1)} current average.</li>
              <li>Interview momentum: {data.workflow.progressTrend.interviewAverageCurrent.toFixed(1)} current average.</li>
              <li>Weekly effort: {data.workflow.progressTrend.recentStudyHours.toFixed(1)} study hours across {data.workflow.progressTrend.activeDays7d} active days.</li>
            </ul>
          </Card>
          <h3>Risk Flags</h3>
          <ul className="tpo-list">
            {data.placementPredictor.risks.length > 0 ? data.placementPredictor.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            )) : <li>No major red flags right now.</li>}
          </ul>
        </Card>

        <div id="career-plan">
        <Card>
          <h2>Action Plan Engine</h2>
          <p className="muted-text">
            Week of {data.actionPlan.week_start} | Target readiness {data.actionPlan.target_readiness.toFixed(1)}
          </p>
          <div className="hero-actions">
            <Button variant="secondary" onClick={onGeneratePlan} disabled={busy === "plan"}>
              {busy === "plan" ? "Refreshing..." : "Regenerate Plan"}
            </Button>
          </div>
          <h3>Focus Areas</h3>
          <ul className="tpo-list">
            {data.actionPlan.focus_areas.map((item) => (
              <li key={item.topicId}>
                {item.topicName} <Badge variant="warning">{item.masteryLevel}%</Badge>
              </li>
            ))}
          </ul>
          <h3>Tasks</h3>
          <ul className="tpo-list">
            {data.actionPlan.tasks.map((task) => (
              <li key={task.id}>
                <strong>{task.title}</strong>: {task.target}
              </li>
            ))}
          </ul>
          <div className="career-linked-grid">
            <div>
              <h3>Linked Resources</h3>
              {data.workflow.resourceRecommendations.length > 0 ? (
                <div className="career-link-list">
                  {data.workflow.resourceRecommendations.map((resource) => (
                    <Link key={resource.id} to={`/resources/view/${resource.id}`} className="career-link-card">
                      <div>
                        <strong>{resource.title}</strong>
                        <p className="muted-text">{resource.summaryShort ?? resource.whyItMatters}</p>
                      </div>
                      <Badge>{resource.topicName ?? resource.resourceType}</Badge>
                    </Link>
                  ))}
                </div>
              ) : <p className="muted-text">No resource recommendations yet.</p>}
            </div>
            <div>
              <h3>Recommended Mock Runs</h3>
              {data.workflow.mockRecommendations.length > 0 ? (
                <div className="career-link-list">
                  {data.workflow.mockRecommendations.map((test) => (
                    <Link key={test.id} to={`/mock-tests/${test.id}`} className="career-link-card">
                      <div>
                        <strong>{test.title}</strong>
                        <p className="muted-text">{test.whyItMatters}</p>
                      </div>
                      <Badge variant={test.attemptCount > 0 ? "warning" : "success"}>
                        {test.attemptCount > 0 ? `${test.attemptCount} prior attempts` : "New timed set"}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : <p className="muted-text">No weak-area mock recommendations yet.</p>}
            </div>
          </div>
        </Card>
        </div>

        <Card>
          <h2>Coding Tracker Integration</h2>
          <div className="form-grid">
            <label>
              Platform
              <Input
                value={codingForm.platform}
                onChange={(event) => setCodingForm((current) => ({ ...current, platform: event.target.value }))}
              />
            </label>
            <label>
              Handle
              <Input
                value={codingForm.handle}
                onChange={(event) => setCodingForm((current) => ({ ...current, handle: event.target.value }))}
              />
            </label>
            <label>
              Solved Count
              <Input
                type="number"
                value={codingForm.solvedCount}
                onChange={(event) => setCodingForm((current) => ({ ...current, solvedCount: event.target.value }))}
              />
            </label>
            <label>
              Weekly Goal
              <Input
                type="number"
                value={codingForm.weeklyGoal}
                onChange={(event) => setCodingForm((current) => ({ ...current, weeklyGoal: event.target.value }))}
              />
            </label>
            <label>
              Streak Days
              <Input
                type="number"
                value={codingForm.streakDays}
                onChange={(event) => setCodingForm((current) => ({ ...current, streakDays: event.target.value }))}
              />
            </label>
            <Button onClick={onSaveCodingProfile} disabled={busy === "coding"}>
              {busy === "coding" ? "Saving..." : "Sync Coding Profile"}
            </Button>
          </div>
          <div className="career-section-stack">
            {data.codingTracker.profiles.length > 0 ? data.codingTracker.profiles.map((profile) => (
              <div key={profile.id} className="career-list-row">
                <div>
                  <strong>{profile.platform}</strong> - {profile.handle}
                </div>
                <div className="muted-text">
                  {profile.solvedCount} solved | goal {profile.weeklyGoal} | streak {profile.streakDays}d
                </div>
              </div>
            )) : <p className="muted-text">No coding profiles added yet.</p>}
          </div>
        </Card>
      </div>

      {status ? <p className="muted-text">{status}</p> : null}
    </section>
  );
}
