export const clientFeatures = {
  aiAssistant: false,
  careerLab: false,
  mastery: false,
  mentorship: false,
  opsHub: false,
  points: false,
  studentAdvancedMetrics: false,
  studentAiStudyAssist: false,
  studentExpandedMockCatalog: true,
  studentExpandedResources: true,
  studentProfileRecommended: false,
  tpoAdvancedInsights: false,
  vault: false,
  studyGuides: false,
  wallet: false,
} as const;

export type ClientFeatureName = keyof typeof clientFeatures;

export function isClientFeatureEnabled(feature: ClientFeatureName) {
  return clientFeatures[feature];
}
