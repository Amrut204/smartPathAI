export const CROSS_BRANCH_PROMPT_LIBRARY = {
  software: "I am from a non-CS branch and want a roadmap for software placements",
  analyst: "I want to prepare for analyst and data-focused roles outside my core branch",
  aptitude: "Create a cross-branch aptitude and interview preparation plan for me",
};

export function buildCareerSwitchPrompts(branch: string, branchLabel: string) {
  const normalizedBranch = branch.trim() || branchLabel.trim() || "my branch";
  return [
    `I am a ${normalizedBranch} student but want to prepare for software placements`,
    `Show me a cross-branch roadmap from ${normalizedBranch} to analyst roles`,
    `What should a ${branchLabel} student study first to explore placements outside their core branch`,
  ];
}
