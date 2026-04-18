function parseBooleanEnv(value: string | undefined): boolean | null {
  if (!value) return null;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function isDemoAutoLoginEnabled(): boolean {
  const configured = parseBooleanEnv(import.meta.env.VITE_ENABLE_DEMO_AUTO_LOGIN);
  if (configured !== null) {
    return configured;
  }

  return !import.meta.env.PROD;
}

export const clientFeatures = {
  aiAssistant: false,
  careerLab: false,
  demoAutoLogin: isDemoAutoLoginEnabled(),
  mastery: false,
  mentorship: false,
  opsHub: false,
  points: false,
  studentAdvancedMetrics: false,
  studentAiStudyAssist: false,
  studentExpandedMockCatalog: false,
  studentExpandedResources: false,
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
