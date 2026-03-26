import useSWR from "swr";
import { withCsrfHeader } from "../utils/csrf";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string; details?: Array<{ field?: string; message: string }> };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json() as ApiResponse<T>;

  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? `Request failed with status ${response.status}`);
  }

  return payload.data;
}

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  return parseResponse<T>(response);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  return parseResponse<T>(response);
}

export interface StudentCareerHub {
  student: {
    id: string;
    branch: string;
    batch: string;
    rollNumber: string;
    readinessScore: number;
  };
  interviewSimulator: {
    history: Array<{
      id: string;
      company: string;
      role: string;
      focus_area: string;
      difficulty: string;
      status: string;
      questions: Array<{ id: string; prompt: string; category: string }>;
      answers: string[];
      answer_feedback?: Array<{
        questionIndex: number;
        transcript: string;
        durationSec: number;
        wordsPerMinute: number;
        fillerCount: number;
        rubric: {
          relevance: number;
          structure: number;
          clarity: number;
          confidence: number;
        };
        overallScore: number;
        strengths: string[];
        improvements: string[];
        improvedAnswer: string;
        followUpQuestion: string;
      } | null>;
      overall_score: number | null;
      feedback: string | null;
      created_at: string;
      completed_at: string | null;
    }>;
  };
  placementPredictor: {
    score: number;
    shortlistProbability: number;
    band: string;
    signals: {
      readiness: number;
      mockAverage: number;
      codingSolved: number;
      studyHours: number;
    };
    risks: string[];
    nextBestAction: string;
  };
  actionPlan: {
    id: string;
    week_start: string;
    status: string;
    focus_areas: Array<{ topicId: string; topicName: string; masteryLevel: number }>;
    tasks: Array<{ id: string; title: string; category: string; target: string; completed: boolean }>;
    target_readiness: number;
  };
  codingTracker: {
    profiles: Array<{
      id: string;
      platform: string;
      handle: string;
      solvedCount: number;
      weeklyGoal: number;
      streakDays: number;
      updatedAt: string;
    }>;
  };
  mentorship: {
    pool: Array<{ name: string; company: string; role: string; domain: string }>;
    matches: Array<{
      id: string;
      mentor_name: string;
      company: string;
      role: string;
      domain: string;
      request_note: string;
      status: string;
      created_at: string;
    }>;
  };
  wallet: {
    items: Array<{
      id: string;
      title: string;
      issuer: string;
      type: string;
      achieved_at: string;
      evidence_url: string | null;
      created_at: string;
    }>;
  };
  calendar: {
    upcomingDrives: Array<{ company: string; role: string; driveDate: string; status: string }>;
  };
  weakAreas: Array<{ topicId: string; topicName: string; masteryLevel: number }>;
  workflow: {
    nextActions: Array<{
      id: string;
      title: string;
      detail: string;
      ctaLabel: string;
      href: string;
      tone: "primary" | "secondary" | "ghost";
    }>;
    resourceRecommendations: Array<{
      id: string;
      title: string;
      resourceType: string;
      topicId: string | null;
      topicName: string | null;
      summaryShort: string | null;
      whyItMatters: string;
      openedCount: number;
    }>;
    mockRecommendations: Array<{
      id: string;
      title: string;
      topicId: string | null;
      topicName: string | null;
      companyName: string | null;
      difficulty: string;
      durationSec: number;
      attemptCount: number;
      latestScore: number | null;
      whyItMatters: string;
    }>;
    interviewFocus: {
      roleTrack: string;
      targetCompany: string;
      targetFocusArea: string;
      recommendedQuestionCategories: string[];
      latestScore: number | null;
      previousScore: number | null;
      retryReason: string;
    };
    progressTrend: {
      mockAverageCurrent: number;
      mockAveragePrevious: number;
      mockAverageDelta: number;
      interviewAverageCurrent: number;
      interviewAveragePrevious: number;
      interviewAverageDelta: number;
      readiness: number;
      recentStudyHours: number;
      activeDays7d: number;
      codingSolved: number;
    };
  };
}

export interface OpsHubData {
  recruiterPortal: {
    partners: Array<{
      id: string;
      company: string;
      contact_name: string;
      contact_email: string;
      open_roles: string[];
      notes: string | null;
      status: string;
      created_at: string;
    }>;
  };
  campaigns: {
    items: Array<{
      id: string;
      name: string;
      audience: string;
      channel: string;
      scheduled_for: string;
      goal: string;
      status: string;
      sent_count: number;
      open_rate: number;
      click_rate: number;
    }>;
  };
  calendar: {
    events: Array<{
      id: string;
      title: string;
      type: string;
      starts_at: string;
      audience: string;
      reminder_offset_hours: number;
      reminder_status: string;
    }>;
    driveTimeline: Array<{
      id: string;
      title: string;
      startsAt: string;
      status: string;
      shortlisted: number;
      selected: number;
    }>;
  };
  revenue: {
    plan_name: string;
    billing_cycle: string;
    student_limit: number;
    ai_quota: number;
    message_quota: number;
    monthly_price: number;
    renewal_date: string;
    status: string;
    usage: {
      students: number;
      ai: number;
      messages: number;
    };
  };
}

export function useStudentCareerHub() {
  return useSWR<StudentCareerHub>("/api/v1/career/student-hub", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 15_000,
  });
}

export function useOpsHub() {
  return useSWR<OpsHubData>("/api/v1/career/ops-hub", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 15_000,
  });
}

export function startInterviewSession(input: {
  company: string;
  role: string;
  focusArea: string;
  difficulty: "foundation" | "core" | "advanced";
}) {
  return postJson<StudentCareerHub["interviewSimulator"]["history"][number]>("/api/v1/career/interview-sessions", input);
}

export function completeInterviewSession(sessionId: string, answers: string[]) {
  return postJson<StudentCareerHub["interviewSimulator"]["history"][number]>(
    `/api/v1/career/interview-sessions/${sessionId}/complete`,
    { answers },
  );
}

export function analyzeInterviewAnswer(input: {
  sessionId: string;
  questionIndex: number;
  transcript: string;
  durationSec: number;
}) {
  return postJson<NonNullable<StudentCareerHub["interviewSimulator"]["history"][number]["answer_feedback"]>[number]>(
    `/api/v1/career/interview-sessions/${input.sessionId}/analyze-answer`,
    {
      questionIndex: input.questionIndex,
      transcript: input.transcript,
      durationSec: input.durationSec,
    },
  );
}

export function generateActionPlan() {
  return postJson<StudentCareerHub["actionPlan"]>("/api/v1/career/action-plans/generate", {});
}

export function saveCodingProfile(input: {
  platform: string;
  handle: string;
  solvedCount: number;
  weeklyGoal: number;
  streakDays: number;
}) {
  return postJson("/api/v1/career/coding-profiles", input);
}

export function requestMentorship(input: {
  domain: string;
  targetCompany: string;
  note: string;
}) {
  return postJson("/api/v1/career/mentorship/request", input);
}

export function addWalletItem(input: {
  title: string;
  issuer: string;
  type: string;
  achievedAt: string;
  evidenceUrl?: string;
}) {
  return postJson("/api/v1/career/wallet", input);
}

export function addRecruiterPartner(input: {
  company: string;
  contactName: string;
  contactEmail: string;
  openRoles: string[];
  notes?: string;
}) {
  return postJson("/api/v1/career/recruiters", input);
}

export function addCampaign(input: {
  name: string;
  audience: string;
  channel: string;
  scheduledFor: string;
  goal: string;
}) {
  return postJson("/api/v1/career/campaigns", input);
}

export function addCalendarEvent(input: {
  title: string;
  type: string;
  startsAt: string;
  audience: string;
  reminderOffsetHours: number;
}) {
  return postJson("/api/v1/career/calendar-events", input);
}

export function updateBillingPlan(input: {
  planName: string;
  billingCycle: "monthly" | "quarterly" | "annual";
  studentLimit: number;
  aiQuota: number;
  messageQuota: number;
  monthlyPrice: number;
  renewalDate: string;
}) {
  return postJson("/api/v1/career/revenue/plan", input);
}
