import useSWR from "swr";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error: { code: string; message: string; details?: Array<{ field?: string; message: string }> };
  meta?: { pagination?: { cursor: string | null; has_more: boolean; limit: number }; timestamp?: string; correlation_id?: string };
}

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = (await response.json()) as ApiResponse<T>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export function useReadinessAnalytics() {
  return useSWR<{
    batchAverages: Array<{ batch: string; avgReadiness: number; studentCount: number }>;
    trend: Array<{ date: string; avgScore: number; attempts: number }>;
  }>("/api/v1/analytics/readiness", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useTopicAnalytics() {
  return useSWR<{
    summary: Array<{ topicId: string; topicName: string; avgMastery: number; studentsCovered: number }>;
    students: Array<{ studentId: string; studentName: string }>;
    cells: Array<{ studentId: string; topicId: string; topicName: string; masteryLevel: number }>;
  }>("/api/v1/analytics/topics", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useTestAnalytics() {
  return useSWR<{
    totalStudents: number;
    totalAttempts: number;
    tests: Array<{
      testId: string;
      title: string;
      difficulty: string;
      completedStudents: number;
      completionRate: number;
      averageScore: number;
    }>;
  }>("/api/v1/analytics/tests", fetcher, {
    revalidateOnFocus: false,
  });
}

export function usePlacementAnalytics() {
  return useSWR<{
    funnel: Array<{ stage: string; count: number }>;
    outcomes: {
      pending: number;
      shortlisted: number;
      selected: number;
      rejected: number;
    };
  }>("/api/v1/analytics/placement", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useTpoDashboardAnalytics() {
  return useSWR<{
    totalStudents: number;
    activeDrives: number;
    avgReadiness: number;
    readinessTrend: Array<{ date: string; avgScore: number }>;
    upcomingDrives: Array<{
      id: string;
      company: string;
      role: string | null;
      driveDate: string;
      status: string;
      eligibleCount: number;
    }>;
    actionItems: string[];
    impact: {
      readinessUplift30d: number;
      activeUsers7d: number;
      messagesSent30d: number;
      selectedRatePct: number;
      placementFunnelTrend: Array<{ stage: string; count: number }>;
    };
  }>("/api/v1/analytics/dashboard", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useStudentRankings(limit = 20, windowDays = 30) {
  return useSWR<{
    generatedAt: string;
    windowDays: number;
    parameters: Array<{ key: string; label: string; weight: number }>;
    items: Array<{
      studentId: string;
      fullName: string;
      rollNumber: string;
      branch: string;
      batch: string;
      metrics: {
        readinessScore: number;
        mockPerformanceScore: number;
        studyConsistencyScore: number;
        avgMockScore: number;
        mockAttempts: number;
        studyHoursWindow: number;
        activeStudyDaysWindow: number;
        studyHours30d: number;
        activeStudyDays30d: number;
        overallScore: number;
      };
      ranks: {
        overall: number;
        readiness: number;
        mockPerformance: number;
        studyConsistency: number;
      };
    }>;
  }>(`/api/v1/analytics/student-rankings?limit=${limit}&windowDays=${windowDays}`, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useTpoControlCenter() {
  return useSWR<{
    summary: {
      totalStudents: number;
      totalDrives: number;
      activeStudents7d: number;
      avgReadiness: number;
      upcomingDrives: number;
      atRiskStudents: number;
      profileCompletePct: number;
      resourceOpens7d: number;
      studentsUsingResources7d: number;
      avgResourceReadingMinutes7d: number;
      outreachStartedCount: number;
    };
    trends: {
      readinessTrend: Array<{ date: string; avgScore: number }>;
      mockTrend: Array<{ date: string; avgScore: number }>;
      batchActivity: Array<{ batch: string; active: number; inactive: number }>;
      weakTopicsByBranch: Array<{ branch: string; topicName: string; avgMastery: number; studentsCovered: number }>;
    };
    alerts: {
      topAlerts: string[];
      recommendedActions: string[];
    };
    activityFeed: {
      items: Array<{
        id: string;
        timestamp: string;
        studentId: string;
        studentName: string;
        branch: string;
        batch: string;
        eventType: string;
        title: string;
        description: string;
        module: string;
        impactLabel: "Low" | "Medium" | "High";
      }>;
    };
    operationsBoard: {
      items: Array<{
        studentId: string;
        fullName: string;
        email: string;
        rollNumber: string;
        branch: string;
        batch: string;
        readinessScore: number;
        lastActiveAt: string | null;
        isActive7d: boolean;
        studyHours7d: number;
        mockAvg: number;
        mockAttempts: number;
        codingSolved: number;
        interviewScore: number | null;
        aiUsage7d: number;
        profileCompletenessPct: number;
        profileMissingFields: string[];
        riskScore: number;
        riskLevel: "Low" | "Moderate" | "High" | "Critical";
        riskReasons: string[];
        nextRecommendedAction: string;
        driveEligibleUpcoming: boolean;
        driveImpact: string;
        isProfileCertified: boolean;
        hasResumeReady: boolean;
        isProfileComplete: boolean;
        appliedRecently: boolean;
      }>;
    };
    readinessFunnel: {
      totalStudents: number;
      completeProfiles: number;
      certifiedProfiles: number;
      resumeReadyProfiles: number;
      eligibleForUpcomingDrives: number;
      appliedRecently: number;
    };
    blockerSegments: {
      missingResume: number;
      uncertified: number;
      incompleteProfile: number;
      academicallyBlocked: number;
      lowEngagement: number;
    };
    pilotProof?: {
      activationWindowDays: number;
      metrics: {
        activatedStudents7d: { count: number; pct: number; helper: string };
        profileComplete: { count: number; pct: number; helper: string };
        certifiedProfiles: { count: number; pct: number; helper: string };
        resumeReady: { count: number; pct: number; helper: string };
        eligibleForUpcoming: { count: number; pct: number; helper: string };
        eligibleButNotApplied: { count: number; pct: number; helper: string };
        mockAdoption: { count: number; pct: number; helper: string };
        announcementReadRate: { readCount: number; recipientCount: number; pct: number; helper: string };
      };
      milestoneChecklist: {
        importedStudents: boolean;
        createdFirstDrive: boolean;
        sentFirstAnnouncement: boolean;
        releasedFirstResult: boolean;
      };
    };
    dashboardQueues: {
      profileUnlockRequests: {
        count: number;
        items: Array<{
          id: string;
          type: string;
          title: string;
          summary: string;
          priority: string;
          targetPath: string;
          ctaLabel: string;
          studentId: string;
          studentName: string;
          studentEmail: string;
          reasonCategory: string;
          requestedFields: string[];
          createdAt: string;
          requestId: string;
        }>;
      };
      studentSupportRequests: {
        count: number;
        items: Array<{
          id: string;
          type: string;
          title: string;
          summary: string;
          priority: string;
          targetPath: string;
          ctaLabel: string;
          requestId: string;
          studentId: string;
          studentName: string;
          studentEmail: string;
          subject: string;
          message: string;
          createdAt: string;
        }>;
      };
      supportAccessRequests: {
        count: number;
        items: Array<{
          id: string;
          type: string;
          title: string;
          summary: string;
          priority: string;
          targetPath: string;
          ctaLabel: string;
          requestId: string;
          requestedByEmail: string;
          reason: string;
          createdAt: string;
        }>;
      };
      communicationTasks: {
        count: number;
        items: Array<{
          id: string;
          type: string;
          title: string;
          summary: string;
          priority: string;
          targetPath: string;
          ctaLabel: string;
          driveId: string;
          driveName: string;
        }>;
      };
    };
    nextBestActions: Array<{
      id: string;
      type: string;
      title: string;
      explanation: string;
      affectedWorkflow: string;
      targetPath: string;
      ctaLabel: string;
      priority: "high" | "medium" | "low";
      urgency: "today" | "this_week";
    }>;
    riskSummary: {
      totalAtRisk: number;
      highRisk: number;
      moderateRisk: number;
      newlyAtRisk7d: number;
    };
    riskStudents: {
      items: Array<{
        studentId: string;
        fullName: string;
        severity: "Low" | "Moderate" | "High" | "Critical";
        riskScore: number;
        riskReasons: string[];
        lastActiveAt: string | null;
        upcomingDriveImpact: string;
        recommendedIntervention: string;
      }>;
    };
    drivePreparedness: {
      items: Array<{
        driveId: string;
        company: string;
        role: string | null;
        driveDate: string;
        status: string;
        daysRemaining: number | null;
        eligibleStudents: number;
        notEligibleStudents: number;
        appliedCount: number;
        eligibleButNotAppliedCount: number;
        eligibleButNotAppliedStudents: Array<{
          studentId: string;
          fullName: string;
          email: string;
          branch: string;
          batch: string;
          readinessScore: number;
          profileCompletenessPct: number;
          hasResumeReady: boolean;
          isProfileCertified: boolean;
          nextRecommendedAction: string;
        }>;
        exportReadyApplicants: number;
        resumeExportReady: boolean;
        resultPublicationState: string;
        lowApplyRisk: boolean;
        incompleteProfileStudents: number;
        noRelevantMockStudents: number;
        avgReadinessEligible: number;
        avgInterviewScore: number;
        driveRiskScore: number;
        drilldown: {
          eligibleButWeak: number;
          ineligibleButRecoverable: number;
          noMockTest: number;
          noResumeProfile: number;
          noRecentActivity: number;
        };
      }>;
    };
    profileCompleteness: {
      summary: {
        completeProfiles: number;
        incompleteProfiles: number;
        missingResume: number;
        missingCertificates: number;
        missingCodingProfile: number;
      };
      items: Array<{
        studentId: string;
        fullName: string;
        completenessPct: number;
        missingFields: string[];
        lastUpdated: string | null;
        driveImpact: string;
      }>;
    };
    mockInsights: {
      summary: {
        totalAttempts: number;
        avgScore: number;
        studentsWithZeroAttempts: number;
        topImprovers: number;
        scoreDropCases: number;
      };
      charts: {
        scoreTrendByBatch: Array<{ batch: string; avgScore: number }>;
        difficultyPerformance: Array<{ difficulty: string; avgScore: number; attempts: number }>;
        weakTopics: Array<{ topicName: string; avgMastery: number; studentsCovered: number }>;
      };
      students: Array<{
        studentId: string;
        fullName: string;
        attempts: number;
        avgScore: number;
        latestScore: number | null;
        scoreTrend: string;
        weakTopic: string;
        recommendation: string;
      }>;
    };
    interviewReadiness: {
      summary: {
        studentsAttempted: number;
        avgInterviewScore: number;
        avgClarity: number;
        avgStructure: number;
        avgConfidence: number;
        belowSpeakingThreshold: number;
      };
      students: Array<{
        studentId: string;
        fullName: string;
        sessionsAttempted: number;
        avgInterviewScore: number;
        clarity: number;
        structure: number;
        confidence: number;
        fillerWordsTrend: string;
        lastAttemptDate: string | null;
      }>;
    };
    codingReadiness: {
      summary: {
        linkedProfiles: number;
        avgSolved: number;
        activeCoders7d: number;
        lowActivityCoders: number;
      };
      students: Array<{
        studentId: string;
        fullName: string;
        platform: string;
        solvedCount: number;
        weeklyGoal: number;
        streak: number;
        codingReadinessLabel: "Strong" | "Moderate" | "Low";
      }>;
    };
    actionCenter: {
      studentsToContactToday: Array<{ studentId: string; fullName: string; riskLevel: string; nextRecommendedAction: string }>;
      eligibleButNotApplied: Array<{ driveId: string; company: string; role: string | null; driveDate: string; eligibleButNotAppliedCount: number; daysRemaining: number | null; students: Array<{ studentId: string; fullName: string; email: string; branch: string; batch: string; readinessScore: number; profileCompletenessPct: number; hasResumeReady: boolean; isProfileCertified: boolean; nextRecommendedAction: string }>; nextRecommendedAction: string }>;
      readyButInactive: Array<{ studentId: string; fullName: string; riskLevel: string; nextRecommendedAction: string }>;
      lowReadinessNearDriveImpact: Array<{ studentId: string; fullName: string; riskLevel: string; nextRecommendedAction: string }>;
      studentsNeedingMockPush: Array<{ studentId: string; fullName: string; mockAvg: number; mockAttempts: number; nextRecommendedAction: string }>;
      studentsNeedingInterviewCoaching: Array<{ studentId: string; fullName: string; interviewScore: number | null; nextRecommendedAction: string }>;
      studentsNeedingProfileCompletion: Array<{ studentId: string; fullName: string; profileCompletenessPct: number; nextRecommendedAction: string }>;
      driveSpecificUrgentList: Array<{ studentId: string; fullName: string; driveImpact: string; nextRecommendedAction: string }>;
      studentsNotUsingResources: Array<{ studentId: string; fullName: string; nextRecommendedAction: string }>;
      readingWithoutMock: Array<{ studentId: string; fullName: string; mockAttempts: number; nextRecommendedAction: string }>;
    };
    resourceInsights: {
      topResources: Array<{ resourceId: string; title: string; resourceType: string; topicName: string | null; opens: number; uniqueStudents: number; avgReadingMinutes: number; impactScore: number }>;
      underusedResources: Array<{ resourceId: string; title: string; resourceType: string; topicName: string | null; opens: number }>;
      highImpactResources: Array<{ resourceId: string; title: string; resourceType: string; topicName: string | null; opens: number; uniqueStudents: number; avgReadingMinutes: number; impactScore: number }>;
    };
    studentActivityById: Record<string, Array<{
      id: string;
      timestamp: string;
      eventType: string;
      title: string;
      description: string;
      module: string;
      impactLabel: "Low" | "Medium" | "High";
    }>>;
  }>("/api/v1/tpo/dashboard/control-center", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 15_000,
  });
}

export function useTpoStudentActivityEvents(studentId: string | null) {
  return useSWR<{
    items: Array<{
      id: string;
      timestamp: string;
      eventType: string;
      title: string;
      description: string;
      module: string;
      impactLabel: "Low" | "Medium" | "High";
    }>;
    pagination: PaginationMeta;
  }>(studentId ? `/api/v1/tpo/students/${studentId}/activity-events` : null, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useTpoActivityFeed(params: {
  page: number;
  limit?: number;
  search?: string;
  eventType?: string;
  branch?: string;
  batch?: string;
}) {
  const query = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit ?? 20),
  });

  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.eventType && params.eventType !== "all") query.set("eventType", params.eventType);
  if (params.branch && params.branch !== "all") query.set("branch", params.branch);
  if (params.batch && params.batch !== "all") query.set("batch", params.batch);

  return useSWR<{
    items: Array<{
      id: string;
      timestamp: string;
      studentId: string;
      studentName: string;
      branch: string;
      batch: string;
      eventType: string;
      title: string;
      description: string;
      module: string;
      impactLabel: "Low" | "Medium" | "High";
    }>;
    pagination: PaginationMeta;
  }>(`/api/v1/tpo/activity-events?${query.toString()}`, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
}

export function useTpoRiskStudents(params: {
  page: number;
  limit?: number;
  search?: string;
  severity?: string;
  branch?: string;
  batch?: string;
}) {
  const query = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit ?? 20),
  });

  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.severity && params.severity !== "all") query.set("severity", params.severity);
  if (params.branch && params.branch !== "all") query.set("branch", params.branch);
  if (params.batch && params.batch !== "all") query.set("batch", params.batch);

  return useSWR<{
    items: Array<{
      studentId: string;
      fullName: string;
      branch: string;
      batch: string;
      severity: "Low" | "Moderate" | "High" | "Critical";
      riskScore: number;
      riskReasons: string[];
      lastActiveAt: string | null;
      upcomingDriveImpact: string;
      recommendedIntervention: string;
    }>;
    pagination: PaginationMeta;
  }>(`/api/v1/tpo/risk-students?${query.toString()}`, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
}

export function useTpoStudentInterviewReadiness(studentId: string | null) {
  return useSWR<{
    studentId: string;
    fullName: string;
    sessionsAttempted: number;
    avgInterviewScore: number;
    clarity: number;
    structure: number;
    confidence: number;
    fillerWordsTrend: string;
    lastAttemptDate: string | null;
  }>(studentId ? `/api/v1/tpo/students/${studentId}/interview-readiness` : null, fetcher, {
    revalidateOnFocus: false,
  });
}
