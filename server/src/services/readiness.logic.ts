export function computeReadinessScore(params: {
  profileCompletenessPct: number;
  isCertified: boolean;
  hasResume: boolean;
  avgTestScore: number | null;
  avgMastery: number | null;
  totalSubmittedAttempts: number;
  recentMockAttempts14d: number;
  eligibleUpcomingDrives: number;
  appliedRecently: boolean;
}): number {
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  const normalizedProfileCompleteness = clamp(params.profileCompletenessPct);
  const certificationScore = params.isCertified ? 100 : 0;
  const resumeScore = params.hasResume ? 100 : 0;
  const mockPerformanceScore = clamp(params.avgTestScore ?? 20);
  const masteryEvidenceScore = clamp(params.avgMastery ?? params.avgTestScore ?? 25);
  const mockConsistencyScore = params.recentMockAttempts14d >= 3
    ? 100
    : params.recentMockAttempts14d === 2
      ? 85
      : params.recentMockAttempts14d === 1
        ? 60
        : params.totalSubmittedAttempts > 0
          ? 45
          : 20;
  const applicationBehaviorScore = params.eligibleUpcomingDrives > 0
    ? params.appliedRecently ? 100 : 55
    : 70;

  // Readiness is grounded in placement evidence only:
  // verified profile state, mock performance, recent mock consistency,
  // and drive behavior. Passive platform activity does not affect it.
  const readiness =
    normalizedProfileCompleteness * 0.18
    + certificationScore * 0.10
    + resumeScore * 0.10
    + mockPerformanceScore * 0.34
    + masteryEvidenceScore * 0.08
    + mockConsistencyScore * 0.14
    + applicationBehaviorScore * 0.06;

  return Number(readiness.toFixed(2));
}
