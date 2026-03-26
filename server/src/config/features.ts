export const serverFeatures = {
  aiAssistant: false,
  analytics: false,
  careerLab: false,
  mastery: false,
  mentorship: false,
  opsHub: false,
  points: false,
  tenantAdmin: false,
  tpoAdvancedInsights: false,
  // Kept on because the student Mock Tests page uses /api/v1/vault for company options.
  vault: true,
  studyGuides: false,
  wallet: false,
} as const;

export type ServerFeatureName = keyof typeof serverFeatures;

export function isServerFeatureEnabled(feature: ServerFeatureName) {
  return serverFeatures[feature];
}
