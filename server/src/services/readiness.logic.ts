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
  const normalizedProfileCompleteness = Math.max(0, Math.min(100, params.profileCompletenessPct));
  const certificationScore = params.isCertified ? 100 : 0;
  const resumeScore = params.hasResume ? 100 : 0;
  const evidenceSignals = [params.avgTestScore, params.avgMastery].filter((value): value is number => value !== null);
  const evidenceScore = evidenceSignals.length > 0
    ? evidenceSignals.reduce((sum, value) => sum + value, 0) / evidenceSignals.length
    : 35;
  const mockConsistencyScore = params.recentMockAttempts14d >= 2
    ? 100
    : params.recentMockAttempts14d === 1
      ? 75
      : params.totalSubmittedAttempts > 0
        ? 45
        : 30;
  const applicationBehaviorScore = params.eligibleUpcomingDrives > 0
    ? params.appliedRecently ? 100 : 45
    : 60;
  const readiness =
    normalizedProfileCompleteness * 0.24
    + certificationScore * 0.16
    + resumeScore * 0.14
    + evidenceScore * 0.28
    + mockConsistencyScore * 0.08
    + applicationBehaviorScore * 0.10;
  return Number(readiness.toFixed(2));
}
