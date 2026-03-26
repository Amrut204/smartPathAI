export interface BranchPrepFocusArea {
  topicName: string;
  reason: string;
}

export interface BranchPrepTrack {
  branch: string;
  label: string;
  summary: string;
  focusAreas: BranchPrepFocusArea[];
  recommendedActions: string[];
  starterPrompts: string[];
}

export const BRANCH_PREP_TRACKS: Record<string, BranchPrepTrack> = {
  CSE: {
    branch: "CSE",
    label: "Computer Science",
    summary: "Balanced placement preparation across coding, core CS subjects, aptitude, and interviews.",
    focusAreas: [
      { topicName: "Data Structures & Algorithms", reason: "Primary shortlist filter for software roles." },
      { topicName: "SQL & Databases", reason: "Common online test and interview topic." },
      { topicName: "Operating Systems", reason: "Core interview round topic." },
      { topicName: "Computer Networks", reason: "Frequently tested in core CS interviews." },
      { topicName: "DBMS", reason: "High-frequency theory and scenario questions." },
    ],
    recommendedActions: [
      "Maintain a weekly coding and aptitude rhythm.",
      "Prioritize DSA plus one core theory subject every week.",
      "Use interview practice after each mock cycle.",
    ],
    starterPrompts: [
      "Give me a 7-day DSA and aptitude plan for campus placements",
      "Top DBMS and OS questions for software engineer interviews",
      "How should I revise SQL and CN before an online test",
    ],
  },
  IT: {
    branch: "IT",
    label: "Information Technology",
    summary: "Software placement preparation with emphasis on databases, web systems, aptitude, and communication.",
    focusAreas: [
      { topicName: "SQL & Databases", reason: "Core screening topic for analyst and developer roles." },
      { topicName: "DBMS", reason: "Supports backend and systems understanding." },
      { topicName: "JavaScript", reason: "Useful for web and product company roles." },
      { topicName: "Python Programming", reason: "Relevant for automation and analytics roles." },
      { topicName: "Aptitude & Reasoning", reason: "Common first-round filter across companies." },
    ],
    recommendedActions: [
      "Keep SQL and aptitude active every week.",
      "Combine one coding topic with one application topic in each study cycle.",
      "Practice HR communication for support, analyst, and trainee roles.",
    ],
    starterPrompts: [
      "Create a 10-day SQL and aptitude study plan for IT students",
      "What JavaScript topics matter most for campus placements",
      "Give me mock interview questions for analyst and trainee roles",
    ],
  },
  ECE: {
    branch: "ECE",
    label: "Electronics and Communication",
    summary: "Core electronics preparation blended with aptitude, communication, and selective software fundamentals.",
    focusAreas: [
      { topicName: "Digital Electronics", reason: "Core subject for electronics shortlists and interviews." },
      { topicName: "Analog Electronics", reason: "Important for circuit understanding and viva questions." },
      { topicName: "Communication Systems", reason: "High-value topic for ECE role interviews." },
      { topicName: "Signals & Systems", reason: "Foundation topic across multiple ECE subjects." },
      { topicName: "Microcontrollers & Embedded Systems", reason: "Relevant for embedded and hardware trainee roles." },
    ],
    recommendedActions: [
      "Split preparation between aptitude and one core electronics area each week.",
      "Keep short notes for formulas, block diagrams, and common interview definitions.",
      "Use interview practice for explaining circuits and system behavior clearly.",
    ],
    starterPrompts: [
      "Create a placement prep plan for an ECE student targeting core roles",
      "Top digital electronics and communication systems interview questions",
      "How should an ECE student balance aptitude with embedded systems prep",
    ],
  },
  EEE: {
    branch: "EEE",
    label: "Electrical and Electronics",
    summary: "Preparation focused on electrical fundamentals, machines, power concepts, aptitude, and communication.",
    focusAreas: [
      { topicName: "Circuit Theory", reason: "Base layer for most electrical interviews." },
      { topicName: "Electrical Machines", reason: "Frequently asked in core EEE hiring." },
      { topicName: "Power Systems", reason: "Critical for utilities and plant-facing roles." },
      { topicName: "Control Systems", reason: "Common analytical interview area." },
      { topicName: "Power Electronics", reason: "Important for modern electrical systems roles." },
    ],
    recommendedActions: [
      "Revise one numerical subject and one theory subject in parallel.",
      "Practice explaining machine behavior and control loops verbally.",
      "Keep aptitude active for cross-functional trainee roles.",
    ],
    starterPrompts: [
      "Give me a 2-week EEE placement preparation plan",
      "Most important power systems and machines questions for interviews",
      "How should an EEE student prepare for both core and trainee roles",
    ],
  },
  ME: {
    branch: "ME",
    label: "Mechanical Engineering",
    summary: "Preparation centered on thermals, manufacturing, design, aptitude, and interview communication.",
    focusAreas: [
      { topicName: "Thermodynamics", reason: "High-frequency core mechanical interview topic." },
      { topicName: "Strength of Materials", reason: "Important for design and production roles." },
      { topicName: "Manufacturing Processes", reason: "Common practical interview area." },
      { topicName: "Fluid Mechanics", reason: "Core concept area for multiple ME roles." },
      { topicName: "CAD/CAM", reason: "Relevant for design and production support roles." },
    ],
    recommendedActions: [
      "Prepare formula sheets and practical examples for each core subject.",
      "Use mock interviews to explain manufacturing and thermal concepts simply.",
      "Keep aptitude practice active for mass recruiter rounds.",
    ],
    starterPrompts: [
      "Create a placement study plan for a mechanical engineering student",
      "Top thermodynamics and manufacturing interview questions",
      "How should an ME student prepare for design and production trainee roles",
    ],
  },
  Civil: {
    branch: "Civil",
    label: "Civil Engineering",
    summary: "Preparation focused on structures, surveying, construction, aptitude, and communication for site and planning roles.",
    focusAreas: [
      { topicName: "Structural Analysis", reason: "Core subject for design and execution roles." },
      { topicName: "Surveying", reason: "Frequently discussed in field and site interviews." },
      { topicName: "Geotechnical Engineering", reason: "Important for foundations and site understanding." },
      { topicName: "Transportation Engineering", reason: "Key public infrastructure and planning topic." },
      { topicName: "Construction Management", reason: "Relevant for execution and project roles." },
    ],
    recommendedActions: [
      "Mix one technical core subject with one project-management topic each week.",
      "Practice interview explanations around site execution and quality checks.",
      "Keep aptitude and communication active for management trainee roles.",
    ],
    starterPrompts: [
      "Create a civil engineering placement prep roadmap for core roles",
      "Top structural analysis and surveying questions for interviews",
      "How should a civil student prepare for site engineer and planning roles",
    ],
  },
};

function normalizeBranchValue(raw: string | null | undefined) {
  const value = String(raw ?? "").trim();
  const upper = value.toUpperCase();
  // Helps match inputs like "E&C", "Civil Engg", "CSE-AIML", etc.
  const compact = upper.replace(/[^A-Z0-9]/g, "");
  return { value, upper, compact };
}

const BRANCH_ALIAS_RULES: Array<{ test: RegExp; key: keyof typeof BRANCH_PREP_TRACKS }> = [
  { test: /^(CSE|CS|COMPUTERSCIENCE|COMPUTERSCIENCEENGINEERING)/i, key: "CSE" },
  { test: /^(IT|INFORMATIONTECHNOLOGY)/i, key: "IT" },
  { test: /^(ECE|EC|EANDC|ELECTRONICS|ELECTRONICSANDCOMMUNICATION)/i, key: "ECE" },
  { test: /^(EEE|EE|ELECTRICAL|ELECTRICALANDELECTRONICS)/i, key: "EEE" },
  { test: /^(ME|MECH|MECHANICAL)/i, key: "ME" },
  // Track key is "Civil" in this config.
  { test: /^(CIVIL|CE)/i, key: "Civil" },
];

export function getBranchPrepTrack(branch: string | null | undefined) {
  const { upper, compact } = normalizeBranchValue(branch);

  if (!upper) {
    return BRANCH_PREP_TRACKS.CSE;
  }

  const exactKey = Object.keys(BRANCH_PREP_TRACKS).find(
    (key) => key.toUpperCase() === upper,
  );
  if (exactKey) {
    return BRANCH_PREP_TRACKS[exactKey];
  }

  for (const rule of BRANCH_ALIAS_RULES) {
    if (rule.test.test(upper) || rule.test.test(compact)) {
      return BRANCH_PREP_TRACKS[rule.key];
    }
  }

  return BRANCH_PREP_TRACKS.CSE;
}
