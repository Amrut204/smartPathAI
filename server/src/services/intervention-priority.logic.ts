export type InterventionPriority = "urgent" | "follow_up" | "monitor";

export function getInterventionPriorityLabel(priority: InterventionPriority) {
  if (priority === "urgent") return "Urgent";
  if (priority === "follow_up") return "Follow-up";
  return "Monitor";
}

export function getInterventionPriorityRank(priority: InterventionPriority) {
  if (priority === "urgent") return 3;
  if (priority === "follow_up") return 2;
  return 1;
}

function daysUntil(dateIso: string | null): number | null {
  if (!dateIso) return null;
  const target = new Date(dateIso);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function deriveInterventionPolicy(params: {
  isPlaced: boolean;
  readinessScore: number;
  hasResumeReady: boolean;
  isProfileCertified: boolean;
  profileCompletenessPct: number;
  isActive7d: boolean;
  eligibleUpcomingDriveCount: number;
  blockedUpcomingDriveCount: number;
  nearestUpcomingDriveDate: string | null;
  appliedRecently: boolean;
  recentMockAttempts14d: number;
  mockAvg: number;
  primaryBlocker?: string | null;
}) {
  const profileComplete = params.profileCompletenessPct >= 100;
  const daysToUpcomingDrive = daysUntil(params.nearestUpcomingDriveDate);
  const hasUpcomingOpportunity = params.eligibleUpcomingDriveCount > 0;
  const nearUpcomingDeadline = hasUpcomingOpportunity && daysToUpcomingDrive !== null && daysToUpcomingDrive <= 7;
  const hasWeakMockEvidence = params.recentMockAttempts14d === 0 || params.mockAvg < 55 || params.readinessScore < 60;

  if (params.isPlaced) {
    return {
      needsIntervention: false,
      interventionPriority: "monitor" as const,
      interventionLabel: "Placed",
      interventionReason: "Already placed. No immediate TPO action is required.",
      interventionRank: getInterventionPriorityRank("monitor"),
    };
  }

  if (hasUpcomingOpportunity && !params.hasResumeReady) {
    return {
      needsIntervention: true,
      interventionPriority: "urgent" as const,
      interventionLabel: "Resume missing",
      interventionReason: "Eligible for an upcoming drive, but the resume is still missing.",
      interventionRank: getInterventionPriorityRank("urgent"),
    };
  }

  if (hasUpcomingOpportunity && !params.isProfileCertified) {
    return {
      needsIntervention: true,
      interventionPriority: "urgent" as const,
      interventionLabel: "Uncertified",
      interventionReason: "Eligible for an upcoming drive, but profile certification is still pending.",
      interventionRank: getInterventionPriorityRank("urgent"),
    };
  }

  if (hasUpcomingOpportunity && !profileComplete) {
    return {
      needsIntervention: true,
      interventionPriority: "urgent" as const,
      interventionLabel: "Incomplete profile",
      interventionReason: "Eligible for an upcoming drive, but required profile details are still incomplete.",
      interventionRank: getInterventionPriorityRank("urgent"),
    };
  }

  if (hasUpcomingOpportunity && !params.appliedRecently) {
    return {
      needsIntervention: true,
      interventionPriority: "urgent" as const,
      interventionLabel: "Eligible but not applied",
      interventionReason: "Eligible for an upcoming drive and still not applied.",
      interventionRank: getInterventionPriorityRank("urgent"),
    };
  }

  if (nearUpcomingDeadline && hasWeakMockEvidence) {
    return {
      needsIntervention: true,
      interventionPriority: "urgent" as const,
      interventionLabel: "Needs mock push",
      interventionReason: "An upcoming drive is close, but recent mock evidence is still too weak.",
      interventionRank: getInterventionPriorityRank("urgent"),
    };
  }

  if (hasUpcomingOpportunity && !params.isActive7d && params.readinessScore >= 60) {
    return {
      needsIntervention: true,
      interventionPriority: "urgent" as const,
      interventionLabel: "Ready but inactive",
      interventionReason: "Ready for an upcoming drive, but inactive in the last 7 days.",
      interventionRank: getInterventionPriorityRank("urgent"),
    };
  }

  if (!params.hasResumeReady) {
    return {
      needsIntervention: true,
      interventionPriority: "follow_up" as const,
      interventionLabel: "Resume missing",
      interventionReason: "Resume is missing and should be fixed before the next drive cycle.",
      interventionRank: getInterventionPriorityRank("follow_up"),
    };
  }

  if (!params.isProfileCertified) {
    return {
      needsIntervention: true,
      interventionPriority: "follow_up" as const,
      interventionLabel: "Uncertified",
      interventionReason: "Profile certification is pending and should be completed soon.",
      interventionRank: getInterventionPriorityRank("follow_up"),
    };
  }

  if (!profileComplete) {
    return {
      needsIntervention: true,
      interventionPriority: "follow_up" as const,
      interventionLabel: "Incomplete profile",
      interventionReason: "Required profile details are still incomplete.",
      interventionRank: getInterventionPriorityRank("follow_up"),
    };
  }

  if (params.blockedUpcomingDriveCount > 0 && params.eligibleUpcomingDriveCount === 0) {
    return {
      needsIntervention: true,
      interventionPriority: "follow_up" as const,
      interventionLabel: "Academically blocked",
      interventionReason: params.primaryBlocker ?? "Upcoming drive criteria are still blocking this student.",
      interventionRank: getInterventionPriorityRank("follow_up"),
    };
  }

  if (!params.isActive7d && params.readinessScore >= 60) {
    return {
      needsIntervention: true,
      interventionPriority: "follow_up" as const,
      interventionLabel: "Ready but inactive",
      interventionReason: "Placement-ready, but recently inactive and needs follow-up.",
      interventionRank: getInterventionPriorityRank("follow_up"),
    };
  }

  if (hasWeakMockEvidence) {
    return {
      needsIntervention: true,
      interventionPriority: "follow_up" as const,
      interventionLabel: "Needs mock push",
      interventionReason: "Mock performance or recent mock consistency needs improvement.",
      interventionRank: getInterventionPriorityRank("follow_up"),
    };
  }

  return {
    needsIntervention: false,
    interventionPriority: "monitor" as const,
    interventionLabel: "Stable",
    interventionReason: "No immediate TPO action is needed right now.",
    interventionRank: getInterventionPriorityRank("monitor"),
  };
}
