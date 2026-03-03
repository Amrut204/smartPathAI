export function computeReadinessScore(params: {
  avgTestScore: number;
  avgMastery: number;
  totalStudyHours: number;
  points: number;
}): number {
  const studyScore = Math.min(100, (params.totalStudyHours / 40) * 100);
  const pointsScore = Math.min(100, (params.points / 1000) * 100);
  const readiness =
    params.avgTestScore * 0.4 + params.avgMastery * 0.25 + studyScore * 0.2 + pointsScore * 0.15;
  return Number(readiness.toFixed(2));
}
