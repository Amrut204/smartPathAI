import { deriveInterventionPolicy } from "../src/services/intervention-priority.logic.js";

describe("Intervention priority policy", () => {
  it("marks eligible blocked students as urgent", () => {
    const result = deriveInterventionPolicy({
      isPlaced: false,
      readinessScore: 78,
      hasResumeReady: false,
      isProfileCertified: true,
      profileCompletenessPct: 100,
      isActive7d: true,
      eligibleUpcomingDriveCount: 2,
      blockedUpcomingDriveCount: 0,
      nearestUpcomingDriveDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
      appliedRecently: false,
      recentMockAttempts14d: 2,
      mockAvg: 74,
      primaryBlocker: "Resume missing",
    });

    expect(result.interventionPriority).toBe("urgent");
    expect(result.interventionLabel).toBe("Resume missing");
  });

  it("marks non-urgent blockers as follow-up", () => {
    const result = deriveInterventionPolicy({
      isPlaced: false,
      readinessScore: 62,
      hasResumeReady: true,
      isProfileCertified: false,
      profileCompletenessPct: 100,
      isActive7d: true,
      eligibleUpcomingDriveCount: 0,
      blockedUpcomingDriveCount: 0,
      nearestUpcomingDriveDate: null,
      appliedRecently: false,
      recentMockAttempts14d: 1,
      mockAvg: 61,
      primaryBlocker: "Profile certification pending",
    });

    expect(result.interventionPriority).toBe("follow_up");
    expect(result.interventionLabel).toBe("Uncertified");
  });

  it("keeps students without near-term blockers in monitor", () => {
    const result = deriveInterventionPolicy({
      isPlaced: false,
      readinessScore: 76,
      hasResumeReady: true,
      isProfileCertified: true,
      profileCompletenessPct: 100,
      isActive7d: true,
      eligibleUpcomingDriveCount: 0,
      blockedUpcomingDriveCount: 0,
      nearestUpcomingDriveDate: null,
      appliedRecently: false,
      recentMockAttempts14d: 2,
      mockAvg: 73,
      primaryBlocker: null,
    });

    expect(result.interventionPriority).toBe("monitor");
    expect(result.needsIntervention).toBe(false);
  });
});
