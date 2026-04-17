import type { TpoAutomationType } from "../hooks/use-tpo-automation";

type AutomationRunLike = {
  automationType: TpoAutomationType;
  preview?: unknown;
  targetPath?: string;
  title?: string;
  counts?: Record<string, number>;
  explanation?: string;
};

type AutomationDisplayMeta = {
  label: string;
  helper: string;
  dashboardMetricLabel: string;
  primaryCtaLabel: string;
  linkedViewLabel: string;
  fallbackTargetPath: string;
};

const AUTOMATION_DISPLAY: Record<TpoAutomationType, AutomationDisplayMeta> = {
  eligible_not_applied: {
    label: "Drive Reminder Draft",
    helper: "Students are eligible for a live drive but still have not applied.",
    dashboardMetricLabel: "Draft reminders",
    primaryCtaLabel: "Review and Send",
    linkedViewLabel: "Review audience",
    fallbackTargetPath: "/tpo/communication?automationType=eligible_not_applied",
  },
  blocked_profile_followup: {
    label: "Blocked Profile Follow-up",
    helper: "Students are blocked by resume, certification, declaration, or profile gaps.",
    dashboardMetricLabel: "Blocked follow-ups",
    primaryCtaLabel: "Review and Send",
    linkedViewLabel: "View students",
    fallbackTargetPath: "/tpo/communication?automationType=blocked_profile_followup",
  },
  weekly_tpo_digest: {
    label: "Weekly Placement Digest",
    helper: "A weekly summary is ready for placement-office review before sending.",
    dashboardMetricLabel: "Weekly digests",
    primaryCtaLabel: "Review and Send",
    linkedViewLabel: "Open linked view",
    fallbackTargetPath: "/tpo/communication?automationType=weekly_tpo_digest",
  },
  scheduled_report_pack: {
    label: "Scheduled Report Pack",
    helper: "The latest report pack is ready for quick download.",
    dashboardMetricLabel: "Scheduled report packs",
    primaryCtaLabel: "Download reports",
    linkedViewLabel: "Open scheduled reports",
    fallbackTargetPath: "/tpo/reports?focus=scheduled-reports",
  },
  unplaced_intervention_refresh: {
    label: "Unplaced Student Intervention",
    helper: "Students needing follow-up have been grouped into an intervention queue.",
    dashboardMetricLabel: "Intervention refreshes",
    primaryCtaLabel: "View students",
    linkedViewLabel: "View students",
    fallbackTargetPath: "/tpo/students?mode=ops&view=all&isPlaced=false&needsIntervention=true&sortBy=intervention_priority&sortDir=desc",
  },
  result_notification_review: {
    label: "Result Notification Review",
    helper: "Released result notifications are tracked here for visibility and audit.",
    dashboardMetricLabel: "Result reviews",
    primaryCtaLabel: "Open",
    linkedViewLabel: "Open linked view",
    fallbackTargetPath: "/tpo/communication?automationType=result_notification_review",
  },
};

function readPreviewRecord(run: Pick<AutomationRunLike, "preview">) {
  return run.preview && typeof run.preview === "object" && !Array.isArray(run.preview)
    ? run.preview as Record<string, unknown>
    : {};
}

export function getAutomationDisplayMeta(type: TpoAutomationType) {
  return AUTOMATION_DISPLAY[type];
}

export function getAutomationRunTargetPath(run: Pick<AutomationRunLike, "automationType" | "preview" | "targetPath">) {
  const preview = readPreviewRecord(run);
  const directTargetPath = typeof run.targetPath === "string" && run.targetPath.trim()
    ? run.targetPath.trim()
    : null;
  const targetPath = typeof preview.targetPath === "string" && preview.targetPath.trim()
    ? preview.targetPath.trim()
    : null;
  return directTargetPath ?? targetPath ?? AUTOMATION_DISPLAY[run.automationType].fallbackTargetPath;
}

export function getAutomationRunTitle(run: Pick<AutomationRunLike, "automationType" | "preview" | "title">) {
  const preview = readPreviewRecord(run);
  const directTitle = typeof run.title === "string" && run.title.trim()
    ? run.title.trim()
    : null;
  const title = typeof preview.title === "string" && preview.title.trim()
    ? preview.title.trim()
    : null;
  return directTitle ?? title ?? AUTOMATION_DISPLAY[run.automationType].label;
}

export function getAutomationRunCountLabel(run: Pick<AutomationRunLike, "automationType" | "counts">) {
  const counts = run.counts ?? {};
  if (run.automationType === "scheduled_report_pack") {
    const reportCount = Number(counts.reportCount ?? 0);
    return `${reportCount} report${reportCount === 1 ? "" : "s"}`;
  }
  if (run.automationType === "weekly_tpo_digest") {
    const recipientCount = Number(counts.recipientCount ?? 0);
    return `${recipientCount} recipient${recipientCount === 1 ? "" : "s"}`;
  }
  if (run.automationType === "result_notification_review") {
    const communicationCount = Number(counts.communicationCount ?? 0);
    return `${communicationCount} notification${communicationCount === 1 ? "" : "s"}`;
  }

  const candidateCount = Number(
    counts.candidateCount
    ?? counts.readyCount
    ?? counts.eligibleNotAppliedQueues
    ?? 0,
  );
  return `${candidateCount} student${candidateCount === 1 ? "" : "s"}`;
}

export function getAutomationRunReason(run: Pick<AutomationRunLike, "automationType" | "explanation">) {
  return run.explanation?.trim() || AUTOMATION_DISPLAY[run.automationType].helper;
}
