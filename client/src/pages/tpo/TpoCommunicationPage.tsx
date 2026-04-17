import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { TpoActionMenu } from "../../components/composites/TpoActionMenu";
import { TpoSubviewSwitcher } from "../../components/composites/TpoSubviewSwitcher";
import { TpoWorkspaceHeader } from "../../components/composites/TpoWorkspaceHeader";
import { useAuth } from "../../components/providers/AuthProvider";
import { Badge, Button, ConfirmActionModal, Input, Select, Table } from "../../components/ui";
import { getTpoGreeting } from "../../config/tpo-workspace";
import {
  type AnnouncementAudienceMode,
  type DriveAudienceScope,
  type AnnouncementPriority,
  previewAnnouncement,
  publishAnnouncement,
  useAnnouncementHistory,
} from "../../hooks/use-announcements";
import {
  previewCommunication,
  sendCommunication,
  useCommunicationHistory,
  useCommunicationTemplates,
} from "../../hooks/use-communication";
import {
  getAutomationDisplayMeta,
  getAutomationRunCountLabel,
  getAutomationRunReason,
  getAutomationRunTargetPath,
  getAutomationRunTitle,
} from "../../config/tpo-automation-display";
import { useDrives } from "../../hooks/use-drives";
import { dismissAutomationRun, releaseAutomationRun, useTpoAutomationRuns } from "../../hooks/use-tpo-automation";
import { updateTenantEmailSettings, updateTenantPlacementPolicy, useTenantSettings } from "../../hooks/use-tenant";

type CommunicationMode = "email" | "announcements";
type CommunicationView = "review" | "compose-email" | "announcements" | "history";
type MessagePreset = "drive-announcement" | "eligible-reminder" | "profile-completion" | "mock-test" | "custom";

const presetLibrary: Record<MessagePreset, {
  label: string;
  subject: string;
  body: string;
  eligibleOnly: boolean;
  needsDrive: boolean;
}> = {
  "drive-announcement": {
    label: "Drive announcement",
    subject: "Placement update: {{drive_name}}",
    body: "Dear {{student_name}},\n\nThe placement cell is sharing an important update about {{drive_name}}.\n\n{{message}}\n\nRegards,\nPlacement Cell",
    eligibleOnly: true,
    needsDrive: true,
  },
  "eligible-reminder": {
    label: "Eligible reminder",
    subject: "Reminder: you are eligible for {{drive_name}}",
    body: "Dear {{student_name}},\n\nYou are currently eligible for {{drive_name}}.\n\n{{message}}\n\nPlease complete the required steps before the deadline.\n\nRegards,\nPlacement Cell",
    eligibleOnly: true,
    needsDrive: true,
  },
  "profile-completion": {
    label: "Profile completion",
    subject: "Complete your placement profile",
    body: "Dear {{student_name}},\n\nYour placement profile is still incomplete.\n\n{{message}}\n\nPlease complete it as soon as possible.\n\nRegards,\nPlacement Cell",
    eligibleOnly: false,
    needsDrive: false,
  },
  "mock-test": {
    label: "Mock test reminder",
    subject: "Practice reminder from the placement cell",
    body: "Dear {{student_name}},\n\nPlease use the mock tests and study resources regularly this week.\n\n{{message}}\n\nRegards,\nPlacement Cell",
    eligibleOnly: false,
    needsDrive: false,
  },
  custom: {
    label: "Custom",
    subject: "",
    body: "",
    eligibleOnly: false,
    needsDrive: false,
  },
};

type EmailPreviewPayload = {
  mode: "resend";
  queueBackend: "inline";
  sender: {
    fromEmail: string;
    fromName: string;
    replyToEmail: string | null;
    tenantName: string;
    senderSource: "tenant" | "platform-fallback";
    displayFrom: string;
  };
  recipientCount: number;
  sampleRecipients: Array<{
    studentId: string;
    fullName: string;
    email: string;
    driveName: string | null;
  }>;
  subject: string | null;
  bodyPreview: string | null;
};

type AnnouncementPreviewPayload = {
  recipientCount: number;
  sampleRecipients: Array<{
    studentId: string;
    fullName: string;
    email: string;
    driveName: string | null;
  }>;
  audienceSummary: string;
  preview: {
    title: string;
    message: string;
    priority: AnnouncementPriority;
    relatedDriveName: string | null;
    expiresAt: string | null;
    showPopup: boolean;
  };
};

type TriStateFilter = "any" | "yes" | "no";

function triStateToBoolean(value: TriStateFilter): boolean | undefined {
  if (value === "yes") return true;
  if (value === "no") return false;
  return undefined;
}

function toIsoDateTime(value: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

export default function TpoCommunicationPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { data: templates } = useCommunicationTemplates();
  const { data: drives } = useDrives();
  const { data: history, isLoading: historyLoading } = useCommunicationHistory();
  const { data: announcementHistory, isLoading: announcementHistoryLoading } = useAnnouncementHistory();
  const { data: tenant } = useTenantSettings();
  const automationRunId = searchParams.get("automationRunId") ?? "";
  const automationTypeParam = searchParams.get("automationType") ?? undefined;
  const triggerSourceParam = searchParams.get("triggerSource") ?? undefined;
  const { data: automationDrafts } = useTpoAutomationRuns({
    status: "draft",
    automationType: automationTypeParam as any,
    triggerSource: triggerSourceParam as any,
    limit: 12,
  });
  const requestedView = searchParams.get("view");
  const activeView: CommunicationView = requestedView === "review"
    || requestedView === "compose-email"
    || requestedView === "announcements"
    || requestedView === "history"
    ? requestedView
    : (automationDrafts && automationDrafts.length > 0 ? "review" : "compose-email");

  const [mode, setMode] = useState<CommunicationMode>("email");
  const [preset, setPreset] = useState<MessagePreset>("eligible-reminder");
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [driveId, setDriveId] = useState("");
  const [branch, setBranch] = useState("");
  const [batch, setBatch] = useState("");
  const [minCgpa, setMinCgpa] = useState("");
  const [maxActiveBacklogs, setMaxActiveBacklogs] = useState("");
  const [maxTotalBacklogs, setMaxTotalBacklogs] = useState("");
  const [minAttendance, setMinAttendance] = useState("");
  const [readinessMin, setReadinessMin] = useState("");
  const [profileCompletenessMin, setProfileCompletenessMin] = useState("");
  const [tenthMarksMin, setTenthMarksMin] = useState("");
  const [tenthMarksMax, setTenthMarksMax] = useState("");
  const [twelfthMarksMin, setTwelfthMarksMin] = useState("");
  const [twelfthMarksMax, setTwelfthMarksMax] = useState("");
  const [diplomaMarksMin, setDiplomaMarksMin] = useState("");
  const [diplomaMarksMax, setDiplomaMarksMax] = useState("");
  const [hasResume, setHasResume] = useState<TriStateFilter>("any");
  const [isCertified, setIsCertified] = useState<TriStateFilter>("any");
  const [canAccessResources, setCanAccessResources] = useState<TriStateFilter>("any");
  const [canAccessMockTests, setCanAccessMockTests] = useState<TriStateFilter>("any");
  const [maxRecipients, setMaxRecipients] = useState("200");
  const [eligibleOnly, setEligibleOnly] = useState(true);
  const [showSenderSettings, setShowSenderSettings] = useState(false);
  const [showPlacementSettings, setShowPlacementSettings] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [senderBusy, setSenderBusy] = useState(false);
  const [emailPreview, setEmailPreview] = useState<EmailPreviewPayload | null>(null);
  const [announcementPreviewData, setAnnouncementPreviewData] = useState<AnnouncementPreviewPayload | null>(null);
  const [senderFromName, setSenderFromName] = useState(tenant?.config?.emailSettings?.fromName ?? "");
  const [senderFromEmail, setSenderFromEmail] = useState(tenant?.config?.emailSettings?.fromEmail ?? "");
  const [senderReplyToEmail, setSenderReplyToEmail] = useState(tenant?.config?.emailSettings?.replyToEmail ?? "");
  const [excludePlacedStudentsByDefault, setExcludePlacedStudentsByDefault] = useState(tenant?.config?.placementPolicy?.excludePlacedStudentsByDefault === true);
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementMessage, setAnnouncementMessage] = useState("");
  const [announcementPriority, setAnnouncementPriority] = useState<AnnouncementPriority>("important");
  const [announcementExpiresAt, setAnnouncementExpiresAt] = useState("");
  const [announcementAudienceMode, setAnnouncementAudienceMode] = useState<AnnouncementAudienceMode>("all_students");
  const [driveAudienceScope, setDriveAudienceScope] = useState<DriveAudienceScope>("eligible");
  const [audienceSearch, setAudienceSearch] = useState("");
  const [audiencePrn, setAudiencePrn] = useState("");
  const [cgpaMax, setCgpaMax] = useState("");
  const [backlogsMin, setBacklogsMin] = useState("");
  const [totalHistoricalBacklogsMin, setTotalHistoricalBacklogsMin] = useState("");
  const [attendanceMax, setAttendanceMax] = useState("");
  const [readinessMax, setReadinessMax] = useState("");
  const [profileCompletenessMax, setProfileCompletenessMax] = useState("");
  const [waitingOnStudent, setWaitingOnStudent] = useState<TriStateFilter>("any");
  const [waitingOnCollege, setWaitingOnCollege] = useState<TriStateFilter>("any");
  const [targetRole, setTargetRole] = useState("");
  const [preferredLocation, setPreferredLocation] = useState("");
  const [willingToRelocate, setWillingToRelocate] = useState<TriStateFilter>("any");
  const [eligibleForUpcomingDrive, setEligibleForUpcomingDrive] = useState<TriStateFilter>("any");
  const [isPlaced, setIsPlaced] = useState<TriStateFilter>("any");
  const [isActive7d, setIsActive7d] = useState<TriStateFilter>("any");
  const [appliedRecently, setAppliedRecently] = useState<TriStateFilter>("any");
  const [needsIntervention, setNeedsIntervention] = useState<TriStateFilter>("any");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [confirmAction, setConfirmAction] = useState<null | "send-email" | "publish-announcement">(null);

  const selectedTemplate = useMemo(
    () => (templates ?? []).find((template) => template.id === templateId) ?? null,
    [templateId, templates],
  );

  const presetConfig = presetLibrary[preset];
  const effectiveSubject = selectedTemplate?.subject ?? subject;
  const effectiveBody = selectedTemplate?.body ?? body;
  const effectiveSenderDisplay = emailPreview?.sender.displayFrom
    ?? (tenant?.config?.emailSettings?.fromEmail
      ? `${tenant.config.emailSettings.fromName || `${tenant.name} Placement Cell`} <${tenant.config.emailSettings.fromEmail}>`
      : `${tenant?.name ?? "College"} Placement Cell via Smart Path`);

  useEffect(() => {
    if (!tenant?.config?.emailSettings) return;
    setSenderFromName((current) => current || tenant.config.emailSettings?.fromName || "");
    setSenderFromEmail((current) => current || tenant.config.emailSettings?.fromEmail || "");
    setSenderReplyToEmail((current) => current || tenant.config.emailSettings?.replyToEmail || "");
  }, [tenant]);

  useEffect(() => {
    setExcludePlacedStudentsByDefault(tenant?.config?.placementPolicy?.excludePlacedStudentsByDefault === true);
  }, [tenant?.config?.placementPolicy?.excludePlacedStudentsByDefault]);

  useEffect(() => {
    setTemplateId("");
    setSubject(presetConfig.subject);
    setBody(presetConfig.body);
    setEligibleOnly(presetConfig.eligibleOnly);
    if (!presetConfig.needsDrive) {
      setDriveId("");
    }
    setEmailPreview(null);
  }, [preset, presetConfig.body, presetConfig.eligibleOnly, presetConfig.needsDrive, presetConfig.subject]);

  useEffect(() => {
    setStatus(null);
  }, [mode]);

  useEffect(() => {
    const studentIds = (searchParams.get("studentIds") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const presetParam = searchParams.get("preset");
    const modeParam = searchParams.get("mode");

    setSelectedStudentIds(studentIds);
    if (modeParam === "announcements" || modeParam === "email") {
      setMode(modeParam);
    }
    if (presetParam && presetParam in presetLibrary) {
      setPreset(presetParam as MessagePreset);
    }
  }, [searchParams]);

  useEffect(() => {
    if (activeView === "announcements" && mode !== "announcements") {
      setMode("announcements");
      return;
    }
    if (activeView !== "announcements" && mode !== "email") {
      setMode("email");
    }
  }, [activeView, mode]);

  useEffect(() => {
    if (mode !== "announcements") {
      return;
    }
    if (announcementAudienceMode !== "drive_specific") {
      setDriveId("");
    }
  }, [announcementAudienceMode, mode]);

  useEffect(() => {
    if (
      mode === "announcements"
      && selectedStudentIds.length > 0
      && announcementAudienceMode === "all_students"
    ) {
      setAnnouncementAudienceMode("custom");
    }
  }, [announcementAudienceMode, mode, selectedStudentIds.length]);

  useEffect(() => {
    if (mode !== "email") {
      return;
    }

    const hasAudienceFilters = Boolean(
      selectedStudentIds.length > 0
      || driveId
      || branch
      || batch
      || minCgpa
      || maxActiveBacklogs
      || maxTotalBacklogs
      || minAttendance
      || readinessMin
      || profileCompletenessMin
      || tenthMarksMin
      || tenthMarksMax
      || twelfthMarksMin
      || twelfthMarksMax
      || diplomaMarksMin
      || diplomaMarksMax
      || hasResume !== "any"
      || isCertified !== "any"
      || canAccessResources !== "any"
      || canAccessMockTests !== "any"
      || maxRecipients !== "200"
      || eligibleOnly === false,
    );

    if (hasAudienceFilters) {
      setFiltersOpen(true);
    }
  }, [
    batch,
    branch,
    canAccessMockTests,
    canAccessResources,
    diplomaMarksMax,
    diplomaMarksMin,
    driveId,
    eligibleOnly,
    hasResume,
    isCertified,
    maxActiveBacklogs,
    maxRecipients,
    maxTotalBacklogs,
    minAttendance,
    minCgpa,
    profileCompletenessMin,
    readinessMin,
    selectedStudentIds.length,
    tenthMarksMax,
    tenthMarksMin,
    twelfthMarksMax,
    twelfthMarksMin,
    mode,
  ]);

  const hasAnnouncementCustomCriteria = useMemo(() => Boolean(
    selectedStudentIds.length > 0
    || audienceSearch
    || audiencePrn
    || branch
    || batch
    || minCgpa
    || cgpaMax
    || backlogsMin
    || maxActiveBacklogs
    || totalHistoricalBacklogsMin
    || maxTotalBacklogs
    || minAttendance
    || attendanceMax
    || readinessMin
    || readinessMax
    || profileCompletenessMin
    || profileCompletenessMax
    || tenthMarksMin
    || tenthMarksMax
    || twelfthMarksMin
    || twelfthMarksMax
    || diplomaMarksMin
    || diplomaMarksMax
    || waitingOnStudent !== "any"
    || waitingOnCollege !== "any"
    || hasResume !== "any"
    || isCertified !== "any"
    || canAccessResources !== "any"
    || canAccessMockTests !== "any"
    || targetRole
    || preferredLocation
    || willingToRelocate !== "any"
    || eligibleForUpcomingDrive !== "any"
    || isPlaced !== "any"
    || isActive7d !== "any"
    || appliedRecently !== "any"
    || needsIntervention !== "any"
  ), [
    audiencePrn,
    audienceSearch,
    attendanceMax,
    appliedRecently,
    backlogsMin,
    batch,
    branch,
    canAccessMockTests,
    canAccessResources,
    cgpaMax,
    diplomaMarksMax,
    diplomaMarksMin,
    eligibleForUpcomingDrive,
    hasResume,
    isActive7d,
    isCertified,
    isPlaced,
    maxActiveBacklogs,
    maxTotalBacklogs,
    minAttendance,
    minCgpa,
    needsIntervention,
    preferredLocation,
    profileCompletenessMax,
    profileCompletenessMin,
    readinessMax,
    readinessMin,
    selectedStudentIds.length,
    targetRole,
    tenthMarksMax,
    tenthMarksMin,
    totalHistoricalBacklogsMin,
    twelfthMarksMax,
    twelfthMarksMin,
    waitingOnCollege,
    waitingOnStudent,
    willingToRelocate,
  ]);

  const buildEmailFilters = () => ({
    driveId: driveId || undefined,
    eligibleOnly,
    branch: branch || undefined,
    batch: batch || undefined,
    minCgpa: minCgpa ? Number(minCgpa) : undefined,
    maxActiveBacklogs: maxActiveBacklogs ? Number(maxActiveBacklogs) : undefined,
    maxTotalBacklogs: maxTotalBacklogs ? Number(maxTotalBacklogs) : undefined,
    minAttendance: minAttendance ? Number(minAttendance) : undefined,
    readinessMin: readinessMin ? Number(readinessMin) : undefined,
    profileCompletenessMin: profileCompletenessMin ? Number(profileCompletenessMin) : undefined,
    tenthMarksMin: tenthMarksMin ? Number(tenthMarksMin) : undefined,
    tenthMarksMax: tenthMarksMax ? Number(tenthMarksMax) : undefined,
    twelfthMarksMin: twelfthMarksMin ? Number(twelfthMarksMin) : undefined,
    twelfthMarksMax: twelfthMarksMax ? Number(twelfthMarksMax) : undefined,
    diplomaMarksMin: diplomaMarksMin ? Number(diplomaMarksMin) : undefined,
    diplomaMarksMax: diplomaMarksMax ? Number(diplomaMarksMax) : undefined,
    hasResume: triStateToBoolean(hasResume),
    isCertified: triStateToBoolean(isCertified),
    canAccessResources: triStateToBoolean(canAccessResources),
    canAccessMockTests: triStateToBoolean(canAccessMockTests),
    maxRecipients: maxRecipients ? Number(maxRecipients) : undefined,
    studentIds: selectedStudentIds.length > 0 ? selectedStudentIds : undefined,
  });

  const buildAnnouncementFilters = () => {
    if (announcementAudienceMode === "all_students") {
      return {
        audienceMode: "all_students" as const,
      };
    }

    if (announcementAudienceMode === "drive_specific") {
      return {
        audienceMode: "drive_specific" as const,
        driveAudienceScope,
        driveId: driveId || undefined,
        maxRecipients: maxRecipients ? Number(maxRecipients) : undefined,
      };
    }

    return {
      audienceMode: "custom" as const,
      q: audienceSearch || undefined,
      prn: audiencePrn || undefined,
      branch: branch || undefined,
      batch: batch || undefined,
      minCgpa: minCgpa ? Number(minCgpa) : undefined,
      cgpaMax: cgpaMax ? Number(cgpaMax) : undefined,
      backlogsMin: backlogsMin ? Number(backlogsMin) : undefined,
      backlogsMax: maxActiveBacklogs ? Number(maxActiveBacklogs) : undefined,
      maxActiveBacklogs: maxActiveBacklogs ? Number(maxActiveBacklogs) : undefined,
      totalHistoricalBacklogsMin: totalHistoricalBacklogsMin ? Number(totalHistoricalBacklogsMin) : undefined,
      totalHistoricalBacklogsMax: maxTotalBacklogs ? Number(maxTotalBacklogs) : undefined,
      maxTotalBacklogs: maxTotalBacklogs ? Number(maxTotalBacklogs) : undefined,
      minAttendance: minAttendance ? Number(minAttendance) : undefined,
      attendanceMax: attendanceMax ? Number(attendanceMax) : undefined,
      readinessMin: readinessMin ? Number(readinessMin) : undefined,
      readinessMax: readinessMax ? Number(readinessMax) : undefined,
      profileCompletenessMin: profileCompletenessMin ? Number(profileCompletenessMin) : undefined,
      profileCompletenessMax: profileCompletenessMax ? Number(profileCompletenessMax) : undefined,
      tenthMarksMin: tenthMarksMin ? Number(tenthMarksMin) : undefined,
      tenthMarksMax: tenthMarksMax ? Number(tenthMarksMax) : undefined,
      twelfthMarksMin: twelfthMarksMin ? Number(twelfthMarksMin) : undefined,
      twelfthMarksMax: twelfthMarksMax ? Number(twelfthMarksMax) : undefined,
      diplomaMarksMin: diplomaMarksMin ? Number(diplomaMarksMin) : undefined,
      diplomaMarksMax: diplomaMarksMax ? Number(diplomaMarksMax) : undefined,
      waitingOnStudent: triStateToBoolean(waitingOnStudent),
      waitingOnCollege: triStateToBoolean(waitingOnCollege),
      hasResume: triStateToBoolean(hasResume),
      isCertified: triStateToBoolean(isCertified),
      canAccessResources: triStateToBoolean(canAccessResources),
      canAccessMockTests: triStateToBoolean(canAccessMockTests),
      targetRole: targetRole || undefined,
      preferredLocation: preferredLocation || undefined,
      willingToRelocate: triStateToBoolean(willingToRelocate),
      eligibleForUpcomingDrive: triStateToBoolean(eligibleForUpcomingDrive),
      isPlaced: triStateToBoolean(isPlaced),
      isActive7d: triStateToBoolean(isActive7d),
      appliedRecently: triStateToBoolean(appliedRecently),
      needsIntervention: triStateToBoolean(needsIntervention),
      maxRecipients: maxRecipients ? Number(maxRecipients) : undefined,
      studentIds: selectedStudentIds.length > 0 ? selectedStudentIds : undefined,
    };
  };

  const buildEmailPayload = () => ({
    templateId: templateId || undefined,
    subject: templateId ? undefined : subject,
    body: templateId ? undefined : body,
    variables: customMessage ? { message: customMessage } : undefined,
    filters: buildEmailFilters(),
  });

  const buildAnnouncementPayload = () => ({
    title: announcementTitle,
    message: announcementMessage,
    priority: announcementPriority,
    relatedDriveId: announcementAudienceMode === "drive_specific" ? driveId || undefined : undefined,
    expiresAt: toIsoDateTime(announcementExpiresAt),
    filters: buildAnnouncementFilters(),
  });

  const invalidatePreviews = () => {
    setEmailPreview(null);
    setAnnouncementPreviewData(null);
  };

  const clearSelectedStudents = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("studentIds");
    next.delete("preset");
    next.delete("mode");
    setSearchParams(next, { replace: true });
  };

  const resetAudienceFilters = () => {
    setDriveId("");
    setBranch("");
    setBatch("");
    setMinCgpa("");
    setCgpaMax("");
    setBacklogsMin("");
    setMaxActiveBacklogs("");
    setTotalHistoricalBacklogsMin("");
    setMaxTotalBacklogs("");
    setMinAttendance("");
    setAttendanceMax("");
    setReadinessMin("");
    setReadinessMax("");
    setProfileCompletenessMin("");
    setProfileCompletenessMax("");
    setTenthMarksMin("");
    setTenthMarksMax("");
    setTwelfthMarksMin("");
    setTwelfthMarksMax("");
    setDiplomaMarksMin("");
    setDiplomaMarksMax("");
    setWaitingOnStudent("any");
    setWaitingOnCollege("any");
    setHasResume("any");
    setIsCertified("any");
    setCanAccessResources("any");
    setCanAccessMockTests("any");
    setTargetRole("");
    setPreferredLocation("");
    setWillingToRelocate("any");
    setEligibleForUpcomingDrive("any");
    setIsPlaced("any");
    setIsActive7d("any");
    setAppliedRecently("any");
    setNeedsIntervention("any");
    setAnnouncementAudienceMode("all_students");
    setDriveAudienceScope("eligible");
    setAudienceSearch("");
    setAudiencePrn("");
    setMaxRecipients("200");
    setEligibleOnly(mode === "email" ? presetConfig.eligibleOnly : true);
    setSelectedStudentIds([]);
    setFiltersOpen(false);
    invalidatePreviews();

    const next = new URLSearchParams(searchParams);
    next.delete("studentIds");
    setSearchParams(next, { replace: true });
  };

  const onPreviewEmail = async () => {
    if (!effectiveSubject || !effectiveBody) {
      setStatus("Add the message first.");
      return;
    }

    if (presetConfig.needsDrive && !driveId) {
      setStatus("Choose the drive.");
      return;
    }

    setPreviewBusy(true);
    setStatus(null);

    try {
      const result = await previewCommunication(buildEmailPayload());
      setEmailPreview(result);
      setStatus(`Preview ready for ${result.recipientCount} recipients.`);
    } catch (previewError) {
      setStatus(previewError instanceof Error ? previewError.message : "Unable to preview recipients");
    } finally {
      setPreviewBusy(false);
    }
  };

  const performSendEmail = async () => {
    if (!emailPreview) {
      setStatus("Preview the message before sending.");
      return;
    }

    setBusy(true);
    setStatus(null);

    try {
      const result = await sendCommunication(buildEmailPayload());
      setStatus(`Queued communication ${result.communicationId} for ${result.recipientCount} recipients.`);
      setConfirmAction(null);
    } catch (sendError) {
      setStatus(sendError instanceof Error ? sendError.message : "Unable to send communication");
    } finally {
      setBusy(false);
    }
  };

  const onPreviewAnnouncement = async () => {
    if (!announcementTitle.trim() || !announcementMessage.trim()) {
      setStatus("Add the announcement title and message first.");
      return;
    }

    if (announcementAudienceMode === "drive_specific" && !driveId) {
      setStatus("Choose a drive for the drive-specific audience.");
      return;
    }

    if (announcementAudienceMode === "custom" && !hasAnnouncementCustomCriteria) {
      setStatus("Add at least one custom filter for the custom audience.");
      return;
    }

    setPreviewBusy(true);
    setStatus(null);

    try {
      const result = await previewAnnouncement(buildAnnouncementPayload());
      setAnnouncementPreviewData(result);
      setStatus(`Announcement preview ready for ${result.recipientCount} students.`);
    } catch (previewError) {
      setStatus(previewError instanceof Error ? previewError.message : "Unable to preview announcement");
    } finally {
      setPreviewBusy(false);
    }
  };

  const performPublishAnnouncement = async () => {
    if (!announcementPreviewData) {
      setStatus("Preview the announcement before publishing.");
      return;
    }

    setBusy(true);
    setStatus(null);

    try {
      const result = await publishAnnouncement(buildAnnouncementPayload());
      setStatus(`Published announcement ${result.announcementId} for ${result.recipientCount} students.`);
      setAnnouncementPreviewData(null);
      setConfirmAction(null);
    } catch (publishError) {
      setStatus(publishError instanceof Error ? publishError.message : "Unable to publish announcement");
    } finally {
      setBusy(false);
    }
  };

  const onSaveSenderSettings = async () => {
    setSenderBusy(true);
    setStatus(null);
    try {
      await updateTenantEmailSettings({
        fromName: senderFromName,
        fromEmail: senderFromEmail,
        replyToEmail: senderReplyToEmail,
      });
      setStatus("Sender settings saved.");
      invalidatePreviews();
      setShowSenderSettings(false);
    } catch (senderError) {
      setStatus(senderError instanceof Error ? senderError.message : "Unable to save sender settings");
    } finally {
      setSenderBusy(false);
    }
  };

  const onSavePlacementPolicy = async () => {
    setSenderBusy(true);
    setStatus(null);
    try {
      await updateTenantPlacementPolicy({ excludePlacedStudentsByDefault });
      setStatus("Placement policy saved.");
      setShowPlacementSettings(false);
    } catch (policyError) {
      setStatus(policyError instanceof Error ? policyError.message : "Unable to save placement policy");
    } finally {
      setSenderBusy(false);
    }
  };

  return (
    <section className="tpo-communication-shell">
      <TpoWorkspaceHeader
        eyebrow="Communication"
        greeting={getTpoGreeting(profile?.full_name ?? "Placement team")}
        title="Review drafts or send one message at a time."
        description="Approve automation drafts before they are sent to students or the placement office. When you compose manually, keep the current mode focused on one audience and one message."
        primaryAction={(
          <Button
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.set("view", "compose-email");
              setSearchParams(next, { replace: true });
            }}
          >
            Compose Email
          </Button>
        )}
        secondaryAction={activeView === "compose-email" ? (
          <Button
            variant="secondary"
            onClick={() => setFiltersOpen((current) => !current)}
          >
            Filters
          </Button>
        ) : activeView !== "review" ? (
          <Button
            variant="secondary"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.set("view", "review");
              setSearchParams(next, { replace: true });
            }}
          >
            Open Review Queue
          </Button>
        ) : undefined}
        actionMenu={(
          <TpoActionMenu
            items={[
              {
                label: "Open Review Queue",
                onSelect: () => {
                  const next = new URLSearchParams(searchParams);
                  next.set("view", "review");
                  setSearchParams(next, { replace: true });
                },
              },
              {
                label: showPlacementSettings ? "Hide placement policy" : "Placement policy",
                onSelect: () => setShowPlacementSettings((current) => !current),
              },
              {
                label: showSenderSettings ? "Hide sender settings" : "Sender settings",
                onSelect: () => setShowSenderSettings((current) => !current),
              },
              {
                label: "Open history",
                onSelect: () => {
                  const next = new URLSearchParams(searchParams);
                  next.set("view", "history");
                  setSearchParams(next, { replace: true });
                },
              },
            ]}
          />
        )}
      />

      <TpoSubviewSwitcher
        label="Communication views"
        items={[
          { id: "review", label: "Review Queue" },
          { id: "compose-email", label: "Compose Email" },
          { id: "announcements", label: "Announcements" },
          { id: "history", label: "History" },
        ]}
        activeId={activeView}
        onChange={(next) => {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.set("view", String(next));
          setSearchParams(nextParams, { replace: true });
        }}
      />

      {activeView === "review" && automationDrafts && automationDrafts.length > 0 ? (
        <section className="tpo-communication-panel">
          <div className="workspace-panel-header">
            <div>
              <p className="workspace-eyebrow">Review Queue</p>
              <h2>Approve automation drafts before they are sent</h2>
              <p className="muted-text">These messages were prepared automatically and still need approval before sending.</p>
            </div>
          </div>
          <div className="tpo-action-list">
            {automationDrafts.map((run) => {
              const highlighted = automationRunId === run.id;
              const meta = getAutomationDisplayMeta(run.automationType);
              const targetPath = getAutomationRunTargetPath(run);
              return (
                <div key={run.id} className="tpo-action-row" style={highlighted ? { border: "1px solid rgba(37, 99, 235, 0.2)", borderRadius: 16, padding: 12 } : undefined}>
                  <div>
                    <div className="tpo-action-row-head">
                      <strong>{getAutomationRunTitle(run)}</strong>
                      <Badge variant={highlighted ? "success" : "warning"}>{getAutomationRunCountLabel(run)}</Badge>
                    </div>
                    <p className="muted-text">{getAutomationRunReason(run)}</p>
                    <p className="muted-text">{run.audienceSummary ?? meta.helper}</p>
                  </div>
                  <div className="tpo-report-row-actions">
                    <Button
                      onClick={async () => {
                        try {
                          await releaseAutomationRun(run.id);
                          setStatus("Automation draft released successfully.");
                        } catch (actionError) {
                          setStatus(actionError instanceof Error ? actionError.message : "Unable to release automation draft");
                        }
                      }}
                    >
                      Review and Send
                    </Button>
                    <TpoActionMenu
                      items={[
                        {
                          label: meta.linkedViewLabel,
                          onSelect: () => {
                            const next = new URLSearchParams(searchParams);
                            next.set("automationRunId", run.id);
                            setSearchParams(next, { replace: true });
                            navigate(targetPath);
                          },
                        },
                        {
                          label: "Dismiss",
                          onSelect: async () => {
                            try {
                              await dismissAutomationRun(run.id);
                              setStatus("Automation draft dismissed.");
                            } catch (actionError) {
                              setStatus(actionError instanceof Error ? actionError.message : "Unable to dismiss automation draft");
                            }
                          },
                        },
                      ]}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {activeView === "review" && (!automationDrafts || automationDrafts.length === 0) ? (
        <section className="tpo-communication-panel">
          <div className="workspace-panel-header">
            <div>
              <p className="workspace-eyebrow">Review Queue</p>
              <h2>No automation drafts are waiting right now</h2>
              <p className="muted-text">When reminders, follow-ups, or digest drafts are prepared automatically, they will appear here for approval before anything is sent.</p>
            </div>
          </div>
        </section>
      ) : null}

      {mode === "email" && showSenderSettings ? (
        <section className="tpo-communication-panel">
          <div className="form-grid tpo-communication-form">
            <label>
              Sender name
              <Input value={senderFromName} onChange={(event) => setSenderFromName(event.target.value)} placeholder="Placement Cell" />
            </label>
            <label>
              Sender email
              <Input value={senderFromEmail} onChange={(event) => setSenderFromEmail(event.target.value)} placeholder="placements@college.edu" />
            </label>
            <label>
              Reply-to
              <Input value={senderReplyToEmail} onChange={(event) => setSenderReplyToEmail(event.target.value)} placeholder="tpo@college.edu" />
            </label>
          </div>
          <div className="hero-actions">
            <Button variant="secondary" disabled={senderBusy} onClick={onSaveSenderSettings}>
              {senderBusy ? "Saving..." : "Save"}
            </Button>
          </div>
        </section>
      ) : null}

      {mode === "email" && showPlacementSettings ? (
        <section className="tpo-communication-panel">
          <div className="form-grid tpo-communication-form">
            <label>
              Placed student participation
              <Select
                value={excludePlacedStudentsByDefault ? "blocked" : "allowed"}
                onChange={(event) => setExcludePlacedStudentsByDefault(event.target.value === "blocked")}
              >
                <option value="allowed">Allow placed students unless a drive blocks them</option>
                <option value="blocked">Block placed students by default</option>
              </Select>
            </label>
          </div>
          <p className="muted-text">
            This is the tenant-wide default used by drive eligibility. Individual drives can still explicitly exclude already placed students.
          </p>
          <div className="hero-actions">
            <Button variant="secondary" disabled={senderBusy} onClick={onSavePlacementPolicy}>
              {senderBusy ? "Saving..." : "Save"}
            </Button>
          </div>
        </section>
      ) : null}

      {(activeView === "compose-email" || activeView === "announcements") ? (
        <section className="tpo-communication-simple-grid">
          <div className="tpo-communication-main">
            {selectedStudentIds.length > 0 ? (
              <section className="tpo-communication-panel tpo-communication-direct-audience">
                <div>
                  <p className="workspace-eyebrow">Direct Audience</p>
                  <h2>{selectedStudentIds.length} selected student{selectedStudentIds.length === 1 ? "" : "s"}</h2>
                  <p className="muted-text">This reminder was opened from the Students intervention workspace. Drive, branch, batch, and advanced criteria still work as narrower filters on top of the selected audience.</p>
                </div>
                <Button variant="ghost" onClick={clearSelectedStudents}>Clear selection</Button>
              </section>
            ) : null}

            {mode === "email" ? (
              <>
                <section className="tpo-communication-panel">
                  <div className="tpo-compact-select-grid">
                    <label>
                      Message type
                      <Select value={preset} onChange={(event) => setPreset(event.target.value as MessagePreset)}>
                        {(Object.entries(presetLibrary) as Array<[MessagePreset, typeof presetLibrary[MessagePreset]]>).map(([id, config]) => (
                          <option key={id} value={id}>{config.label}</option>
                        ))}
                      </Select>
                    </label>
                  </div>
                  <p className="muted-text">Choose one message type first, then adjust audience filters and the message itself below.</p>
                </section>

                {filtersOpen ? (
                  <section className="tpo-communication-panel">
                    <div className="workspace-panel-header">
                      <div>
                        <p className="workspace-eyebrow">Filters</p>
                        <h2>Choose the audience for this message</h2>
                        <p className="muted-text">Use these filters only when the message needs a narrower audience.</p>
                      </div>
                      <div className="hero-actions">
                        <Button variant="ghost" onClick={resetAudienceFilters}>Reset Filters</Button>
                      </div>
                    </div>
                    <div className="tpo-communication-inline-grid">
                      {presetConfig.needsDrive ? (
                        <label>
                          Drive
                          <Select value={driveId} onChange={(event) => { setDriveId(event.target.value); invalidatePreviews(); }}>
                            <option value="">Select</option>
                            {(drives?.items ?? []).map((drive) => (
                              <option key={drive.id} value={drive.id}>
                                {drive.company} {drive.role ? `- ${drive.role}` : ""}
                              </option>
                            ))}
                          </Select>
                        </label>
                      ) : null}
                      <label>
                        Branch
                        <Input value={branch} onChange={(event) => { setBranch(event.target.value); invalidatePreviews(); }} placeholder="All" />
                      </label>
                      <label>
                        Batch
                        <Input value={batch} onChange={(event) => { setBatch(event.target.value); invalidatePreviews(); }} placeholder="All" />
                      </label>
                      <label>
                        CGPA
                        <Input type="number" min="0" max="10" step="0.1" value={minCgpa} onChange={(event) => { setMinCgpa(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Max active backlogs
                        <Input type="number" min="0" max="100" value={maxActiveBacklogs} onChange={(event) => { setMaxActiveBacklogs(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Max total backlogs
                        <Input type="number" min="0" max="100" value={maxTotalBacklogs} onChange={(event) => { setMaxTotalBacklogs(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Min attendance %
                        <Input type="number" min="0" max="100" step="0.1" value={minAttendance} onChange={(event) => { setMinAttendance(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Readiness min %
                        <Input type="number" min="0" max="100" step="0.1" value={readinessMin} onChange={(event) => { setReadinessMin(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Profile completeness %
                        <Input type="number" min="0" max="100" step="0.1" value={profileCompletenessMin} onChange={(event) => { setProfileCompletenessMin(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        10th marks min %
                        <Input type="number" min="0" max="100" step="0.1" value={tenthMarksMin} onChange={(event) => { setTenthMarksMin(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        10th marks max %
                        <Input type="number" min="0" max="100" step="0.1" value={tenthMarksMax} onChange={(event) => { setTenthMarksMax(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        12th marks min %
                        <Input type="number" min="0" max="100" step="0.1" value={twelfthMarksMin} onChange={(event) => { setTwelfthMarksMin(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        12th marks max %
                        <Input type="number" min="0" max="100" step="0.1" value={twelfthMarksMax} onChange={(event) => { setTwelfthMarksMax(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Diploma marks min %
                        <Input type="number" min="0" max="100" step="0.1" value={diplomaMarksMin} onChange={(event) => { setDiplomaMarksMin(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Diploma marks max %
                        <Input type="number" min="0" max="100" step="0.1" value={diplomaMarksMax} onChange={(event) => { setDiplomaMarksMax(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Has resume
                        <Select value={hasResume} onChange={(event) => { setHasResume(event.target.value as TriStateFilter); invalidatePreviews(); }}>
                          <option value="any">Any</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </label>
                      <label>
                        Certified profile
                        <Select value={isCertified} onChange={(event) => { setIsCertified(event.target.value as TriStateFilter); invalidatePreviews(); }}>
                          <option value="any">Any</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </label>
                      <label>
                        Resource access
                        <Select value={canAccessResources} onChange={(event) => { setCanAccessResources(event.target.value as TriStateFilter); invalidatePreviews(); }}>
                          <option value="any">Any</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </label>
                      <label>
                        Mock test access
                        <Select value={canAccessMockTests} onChange={(event) => { setCanAccessMockTests(event.target.value as TriStateFilter); invalidatePreviews(); }}>
                          <option value="any">Any</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </label>
                      <label>
                        Eligible only
                        <Select value={eligibleOnly ? "yes" : "no"} onChange={(event) => { setEligibleOnly(event.target.value === "yes"); invalidatePreviews(); }}>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </label>
                      <label>
                        Max students
                        <Input type="number" min="1" max="5000" value={maxRecipients} onChange={(event) => { setMaxRecipients(event.target.value); invalidatePreviews(); }} />
                      </label>
                    </div>
                  </section>
                ) : null}

                <section className="tpo-communication-panel">
                  <div className="tpo-communication-inline-grid">
                    <label>
                      Template
                      <Select value={templateId} onChange={(event) => { setTemplateId(event.target.value); invalidatePreviews(); }}>
                        <option value="">Use current message</option>
                        {(templates ?? []).map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="tpo-communication-full">
                      <span className="tpo-communication-message-label-row">
                        <span>Message for students</span>
                        <span className="muted-text">Write what you want to tell students here. This fills {"{{message}}"} in Message below.</span>
                      </span>
                      <Input value={customMessage} onChange={(event) => { setCustomMessage(event.target.value); invalidatePreviews(); }} placeholder="Write the message for students (deadline, room, links, instructions)" />
                    </label>
                    {!templateId ? (
                      <>
                        <label className="tpo-communication-full">
                          Subject
                          <Input value={subject} onChange={(event) => { setSubject(event.target.value); invalidatePreviews(); }} />
                        </label>
                        <label className="tpo-communication-full">
                          <span className="tpo-communication-message-label-row">
                            <span className="muted-text">Do not edit placeholders in {"{{...}}"}.</span>
                            <span>Message</span>
                          </span>
                          <textarea rows={10} value={body} onChange={(event) => { setBody(event.target.value); invalidatePreviews(); }} />
                        </label>
                      </>
                    ) : (
                      <div className="tpo-communication-preview-block tpo-communication-full">
                        <p><strong>{effectiveSubject}</strong></p>
                        <pre>{effectiveBody}</pre>
                      </div>
                    )}
                  </div>
                </section>
              </>
            ) : (
              <>
                <section className="tpo-communication-panel">
                  <div className="workspace-panel-header">
                    <div>
                      <p className="workspace-eyebrow">Audience</p>
                      <h2>Choose who should see this announcement</h2>
                      <p className="muted-text">Pick all students, a specific drive audience, or a custom filtered audience.</p>
                    </div>
                    <div className="hero-actions">
                      <Button variant="ghost" onClick={resetAudienceFilters}>Reset Audience</Button>
                    </div>
                  </div>
                  <div className="tpo-communication-inline-grid">
                    <label className="tpo-communication-full">
                      Announce to
                      <Select value={announcementAudienceMode} onChange={(event) => { setAnnouncementAudienceMode(event.target.value as AnnouncementAudienceMode); invalidatePreviews(); }}>
                        <option value="all_students">All students</option>
                        <option value="drive_specific">Specific drive audience</option>
                        <option value="custom">Custom filters</option>
                      </Select>
                    </label>
                  </div>
                </section>

                {announcementAudienceMode === "drive_specific" ? (
                  <section className="tpo-communication-panel">
                    <p className="muted-text">Select one drive and choose whether to target eligible students, appearing/applied students, or both.</p>
                    <div className="tpo-communication-inline-grid">
                      <label>
                        Drive
                        <Select value={driveId} onChange={(event) => { setDriveId(event.target.value); invalidatePreviews(); }}>
                          <option value="">Select</option>
                          {(drives?.items ?? []).map((drive) => (
                            <option key={drive.id} value={drive.id}>
                              {drive.company} {drive.role ? `- ${drive.role}` : ""}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <label>
                        Drive audience
                        <Select value={driveAudienceScope} onChange={(event) => { setDriveAudienceScope(event.target.value as DriveAudienceScope); invalidatePreviews(); }}>
                          <option value="eligible">Eligible students only</option>
                          <option value="appearing_applied">Appearing/applied students only</option>
                          <option value="both">Eligible and appearing/applied</option>
                        </Select>
                      </label>
                      <label>
                        Max students
                        <Input type="number" min="1" max="5000" value={maxRecipients} onChange={(event) => { setMaxRecipients(event.target.value); invalidatePreviews(); }} />
                      </label>
                    </div>
                  </section>
                ) : null}

                {announcementAudienceMode === "custom" ? (
                  <section className="tpo-communication-panel">
                    <p className="muted-text">Use the same advanced criteria available in the Students workspace to target this announcement.</p>
                    <div className="tpo-communication-inline-grid">
                      <label>
                        Search
                        <Input value={audienceSearch} onChange={(event) => { setAudienceSearch(event.target.value); invalidatePreviews(); }} placeholder="Name, email, roll number, or PRN" />
                      </label>
                      <label>
                        PRN
                        <Input value={audiencePrn} onChange={(event) => { setAudiencePrn(event.target.value); invalidatePreviews(); }} placeholder="PRN filter" />
                      </label>
                      <label>
                        Branch
                        <Input value={branch} onChange={(event) => { setBranch(event.target.value); invalidatePreviews(); }} placeholder="All" />
                      </label>
                      <label>
                        Year / Batch
                        <Input value={batch} onChange={(event) => { setBatch(event.target.value); invalidatePreviews(); }} placeholder="All" />
                      </label>
                      <label>
                        CGPA min
                        <Input type="number" min="0" max="10" step="0.1" value={minCgpa} onChange={(event) => { setMinCgpa(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        CGPA max
                        <Input type="number" min="0" max="10" step="0.1" value={cgpaMax} onChange={(event) => { setCgpaMax(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Active backlogs min
                        <Input type="number" min="0" max="100" value={backlogsMin} onChange={(event) => { setBacklogsMin(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Max active backlogs
                        <Input type="number" min="0" max="100" value={maxActiveBacklogs} onChange={(event) => { setMaxActiveBacklogs(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Total backlogs min
                        <Input type="number" min="0" max="100" value={totalHistoricalBacklogsMin} onChange={(event) => { setTotalHistoricalBacklogsMin(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Max total backlogs
                        <Input type="number" min="0" max="100" value={maxTotalBacklogs} onChange={(event) => { setMaxTotalBacklogs(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Min attendance %
                        <Input type="number" min="0" max="100" step="0.1" value={minAttendance} onChange={(event) => { setMinAttendance(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Attendance max %
                        <Input type="number" min="0" max="100" step="0.1" value={attendanceMax} onChange={(event) => { setAttendanceMax(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Readiness min %
                        <Input type="number" min="0" max="100" step="0.1" value={readinessMin} onChange={(event) => { setReadinessMin(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Readiness max %
                        <Input type="number" min="0" max="100" step="0.1" value={readinessMax} onChange={(event) => { setReadinessMax(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Profile completeness % min
                        <Input type="number" min="0" max="100" step="0.1" value={profileCompletenessMin} onChange={(event) => { setProfileCompletenessMin(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Profile completeness % max
                        <Input type="number" min="0" max="100" step="0.1" value={profileCompletenessMax} onChange={(event) => { setProfileCompletenessMax(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        10th marks min %
                        <Input type="number" min="0" max="100" step="0.1" value={tenthMarksMin} onChange={(event) => { setTenthMarksMin(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        10th marks max %
                        <Input type="number" min="0" max="100" step="0.1" value={tenthMarksMax} onChange={(event) => { setTenthMarksMax(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        12th marks min %
                        <Input type="number" min="0" max="100" step="0.1" value={twelfthMarksMin} onChange={(event) => { setTwelfthMarksMin(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        12th marks max %
                        <Input type="number" min="0" max="100" step="0.1" value={twelfthMarksMax} onChange={(event) => { setTwelfthMarksMax(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Diploma marks min %
                        <Input type="number" min="0" max="100" step="0.1" value={diplomaMarksMin} onChange={(event) => { setDiplomaMarksMin(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Diploma marks max %
                        <Input type="number" min="0" max="100" step="0.1" value={diplomaMarksMax} onChange={(event) => { setDiplomaMarksMax(event.target.value); invalidatePreviews(); }} placeholder="Optional" />
                      </label>
                      <label>
                        Has resume
                        <Select value={hasResume} onChange={(event) => { setHasResume(event.target.value as TriStateFilter); invalidatePreviews(); }}>
                          <option value="any">Any</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </label>
                      <label>
                        Certified profile
                        <Select value={isCertified} onChange={(event) => { setIsCertified(event.target.value as TriStateFilter); invalidatePreviews(); }}>
                          <option value="any">Any</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </label>
                      <label>
                        Waiting on student
                        <Select value={waitingOnStudent} onChange={(event) => { setWaitingOnStudent(event.target.value as TriStateFilter); invalidatePreviews(); }}>
                          <option value="any">Any</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </label>
                      <label>
                        Waiting on college
                        <Select value={waitingOnCollege} onChange={(event) => { setWaitingOnCollege(event.target.value as TriStateFilter); invalidatePreviews(); }}>
                          <option value="any">Any</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </label>
                      <label>
                        Resource access
                        <Select value={canAccessResources} onChange={(event) => { setCanAccessResources(event.target.value as TriStateFilter); invalidatePreviews(); }}>
                          <option value="any">Any</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </label>
                      <label>
                        Mock test access
                        <Select value={canAccessMockTests} onChange={(event) => { setCanAccessMockTests(event.target.value as TriStateFilter); invalidatePreviews(); }}>
                          <option value="any">Any</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </label>
                      <label>
                        Eligible for upcoming drive
                        <Select value={eligibleForUpcomingDrive} onChange={(event) => { setEligibleForUpcomingDrive(event.target.value as TriStateFilter); invalidatePreviews(); }}>
                          <option value="any">Any</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </label>
                      <label>
                        Is placed
                        <Select value={isPlaced} onChange={(event) => { setIsPlaced(event.target.value as TriStateFilter); invalidatePreviews(); }}>
                          <option value="any">Any</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </label>
                      <label>
                        Active in last 7 days
                        <Select value={isActive7d} onChange={(event) => { setIsActive7d(event.target.value as TriStateFilter); invalidatePreviews(); }}>
                          <option value="any">Any</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </label>
                      <label>
                        Applied recently
                        <Select value={appliedRecently} onChange={(event) => { setAppliedRecently(event.target.value as TriStateFilter); invalidatePreviews(); }}>
                          <option value="any">Any</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </label>
                      <label>
                        Needs intervention
                        <Select value={needsIntervention} onChange={(event) => { setNeedsIntervention(event.target.value as TriStateFilter); invalidatePreviews(); }}>
                          <option value="any">Any</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </label>
                      <label>
                        Willing to relocate
                        <Select value={willingToRelocate} onChange={(event) => { setWillingToRelocate(event.target.value as TriStateFilter); invalidatePreviews(); }}>
                          <option value="any">Any</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </label>
                      <label>
                        Target role
                        <Input value={targetRole} onChange={(event) => { setTargetRole(event.target.value); invalidatePreviews(); }} placeholder="Analyst, GET, developer" />
                      </label>
                      <label>
                        Preferred location
                        <Input value={preferredLocation} onChange={(event) => { setPreferredLocation(event.target.value); invalidatePreviews(); }} placeholder="Pune, Mumbai, Bengaluru" />
                      </label>
                      <label>
                        Max students
                        <Input type="number" min="1" max="5000" value={maxRecipients} onChange={(event) => { setMaxRecipients(event.target.value); invalidatePreviews(); }} />
                      </label>
                    </div>
                  </section>
                ) : null}

                <section className="tpo-communication-panel">
                  <div className="tpo-communication-inline-grid">
                    <label>
                      Priority
                      <Select
                        value={announcementPriority}
                        onChange={(event) => {
                          setAnnouncementPriority(event.target.value as AnnouncementPriority);
                          invalidatePreviews();
                        }}
                      >
                        <option value="normal">Normal</option>
                        <option value="important">Important</option>
                        <option value="urgent">Urgent</option>
                      </Select>
                    </label>
                    <label>
                      Expires
                      <Input
                        type="datetime-local"
                        value={announcementExpiresAt}
                        onChange={(event) => {
                          setAnnouncementExpiresAt(event.target.value);
                          invalidatePreviews();
                        }}
                      />
                    </label>
                    <label className="tpo-communication-full">
                      Title
                      <Input
                        value={announcementTitle}
                        onChange={(event) => {
                          setAnnouncementTitle(event.target.value);
                          invalidatePreviews();
                        }}
                        placeholder="Placement drive room change"
                      />
                    </label>
                    <label className="tpo-communication-full">
                      Announcement message
                      <textarea
                        rows={8}
                        value={announcementMessage}
                        onChange={(event) => {
                          setAnnouncementMessage(event.target.value);
                          invalidatePreviews();
                        }}
                        placeholder="Share the update students should see on their dashboard."
                      />
                    </label>
                  </div>
                </section>
              </>
            )}
          </div>

          <aside className="tpo-communication-side">
            {mode === "email" ? (
              <>
                <section className="tpo-communication-preview-block">
                  <p><strong>From</strong></p>
                  <p>{effectiveSenderDisplay}</p>
                  {emailPreview?.sender.replyToEmail ? <p><strong>Reply-to:</strong> {emailPreview.sender.replyToEmail}</p> : null}
                </section>

                <section className="tpo-communication-preview-block">
                  <p><strong>Preview</strong></p>
                  {emailPreview ? (
                    <>
                      <p><strong>{emailPreview.recipientCount}</strong> students</p>
                      <ul className="tpo-preview-list">
                        {emailPreview.sampleRecipients.map((recipient) => (
                          <li key={`${recipient.studentId}-${recipient.email}`}>
                            {recipient.fullName || "Student"} ({recipient.email})
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="muted-text">Preview to see who will receive this.</p>
                  )}
                </section>

                <div className="hero-actions">
                  <Button disabled={previewBusy} onClick={onPreviewEmail}>
                    {previewBusy ? "Previewing..." : "Preview"}
                  </Button>
                  <Button variant="secondary" disabled={busy || !emailPreview} onClick={() => setConfirmAction("send-email")}>
                    {busy ? "Sending..." : "Send"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <section className="tpo-communication-preview-block">
                  <p><strong>Announcement preview</strong></p>
                  {announcementPreviewData ? (
                    <div className="tpo-announcement-card-preview">
                      <div className="tpo-announcement-card-head">
                        <strong>{announcementPreviewData.preview.title}</strong>
                        <Badge variant={
                          announcementPreviewData.preview.priority === "urgent"
                            ? "danger"
                            : announcementPreviewData.preview.priority === "important"
                              ? "warning"
                              : "default"
                        }>
                          {announcementPreviewData.preview.priority}
                        </Badge>
                      </div>
                      {announcementPreviewData.preview.relatedDriveName ? (
                        <p><strong>Drive:</strong> {announcementPreviewData.preview.relatedDriveName}</p>
                      ) : null}
                      <p>{announcementPreviewData.preview.message}</p>
                      {announcementPreviewData.preview.expiresAt ? (
                        <p><strong>Expires:</strong> {new Date(announcementPreviewData.preview.expiresAt).toLocaleString()}</p>
                      ) : null}
                      {announcementPreviewData.preview.showPopup ? (
                        <p className="muted-text">Urgent announcements will open as a popup for students.</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="muted-text">Preview to see the student-facing announcement card.</p>
                  )}
                </section>

                <section className="tpo-communication-preview-block">
                  <p><strong>Audience</strong></p>
                  {announcementPreviewData ? (
                    <>
                      <p><strong>{announcementPreviewData.recipientCount}</strong> students</p>
                      <p>{announcementPreviewData.audienceSummary}</p>
                      <ul className="tpo-preview-list">
                        {announcementPreviewData.sampleRecipients.map((recipient) => (
                          <li key={`${recipient.studentId}-${recipient.email}`}>
                            {recipient.fullName || "Student"} ({recipient.email})
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="muted-text">Preview to confirm who will see this notice.</p>
                  )}
                </section>

                <div className="hero-actions">
                  <Button disabled={previewBusy} onClick={onPreviewAnnouncement}>
                    {previewBusy ? "Previewing..." : "Preview"}
                  </Button>
                  <Button variant="secondary" disabled={busy || !announcementPreviewData} onClick={() => setConfirmAction("publish-announcement")}>
                    {busy ? "Publishing..." : "Publish"}
                  </Button>
                </div>
              </>
            )}

            {status ? <p className="tpo-communication-status">{status}</p> : null}
          </aside>
        </section>
      ) : null}

      {activeView === "history" ? (
      <section className="tpo-communication-panel">
        <div className="tpo-communication-panel-head">
          <div>
            <h2>Recent communication</h2>
            <p className="muted-text">Review the last outgoing messages and announcements without mixing them into the compose workspace.</p>
          </div>
        </div>

        {historyLoading ? (
          <p className="muted-text">Loading recent messages...</p>
        ) : (history?.items ?? []).length === 0 ? (
          <p className="muted-text">No messages yet.</p>
        ) : (
          <div className="tpo-ranking-table-wrap tpo-communication-table">
            <Table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Recipients</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {(history?.items ?? []).slice(0, 8).map((item) => (
                  <tr key={item.id}>
                    <td>{item.subject}</td>
                    <td>{item.status}</td>
                    <td>{item.recipientCount}</td>
                    <td>{item.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}

        <div style={{ height: 24 }} />

        {announcementHistoryLoading ? (
          <p className="muted-text">Loading recent announcements...</p>
        ) : (announcementHistory ?? []).length === 0 ? (
          <p className="muted-text">No announcements yet.</p>
        ) : (
          <div className="tpo-ranking-table-wrap tpo-communication-table">
            <Table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Priority</th>
                  <th>Recipients</th>
                  <th>Status</th>
                  <th>Published</th>
                </tr>
              </thead>
              <tbody>
                {(announcementHistory ?? []).slice(0, 8).map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>{item.priority}</td>
                    <td>{item.recipientCount}</td>
                    <td>{item.status}</td>
                    <td>{new Date(item.publishedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </section>
      ) : null}

      {false ? (
        <section className="tpo-communication-panel">
          <div className="tpo-communication-panel-head">
            <div>
              <h2>{mode === "email" ? "Recent messages" : "Recent announcements"}</h2>
            </div>
          </div>

          {mode === "email" ? (
            historyLoading ? (
            <p className="muted-text">Loading...</p>
          ) : (history?.items ?? []).length === 0 ? (
            <p className="muted-text">No messages yet.</p>
          ) : (
            <div className="tpo-ranking-table-wrap tpo-communication-table">
              <Table>
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Recipients</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {(history?.items ?? []).slice(0, 8).map((item) => (
                    <tr key={item.id}>
                      <td>{item.subject}</td>
                      <td>{item.status}</td>
                      <td>{item.recipientCount}</td>
                      <td>{item.createdAt}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )
        ) : announcementHistoryLoading ? (
          <p className="muted-text">Loading...</p>
        ) : (announcementHistory ?? []).length === 0 ? (
          <p className="muted-text">No announcements yet.</p>
        ) : (
          <div className="tpo-ranking-table-wrap tpo-communication-table">
            <Table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Priority</th>
                  <th>Recipients</th>
                  <th>Status</th>
                  <th>Published</th>
                </tr>
              </thead>
              <tbody>
                {(announcementHistory ?? []).slice(0, 8).map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>{item.priority}</td>
                    <td>{item.recipientCount}</td>
                    <td>{item.status}</td>
                    <td>{new Date(item.publishedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </section>
      ) : null}

      <ConfirmActionModal
        open={confirmAction === "send-email"}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => void performSendEmail()}
        busy={busy}
        title="Send communication"
        message={`You are about to queue this email for ${emailPreview?.recipientCount ?? 0} student${emailPreview?.recipientCount === 1 ? "" : "s"}.`}
        confirmLabel="Queue email"
        details={[
          emailPreview ? `Recipients: ${emailPreview.recipientCount}` : "Preview the message first.",
          effectiveSubject ? `Subject: ${effectiveSubject}` : "Subject is missing.",
          selectedStudentIds.length > 0 ? `Direct audience selection: ${selectedStudentIds.length} student(s)` : "Audience comes from the current filters.",
        ]}
      />

      <ConfirmActionModal
        open={confirmAction === "publish-announcement"}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => void performPublishAnnouncement()}
        busy={busy}
        title="Publish announcement"
        message={`You are about to publish this announcement to ${announcementPreviewData?.recipientCount ?? 0} student${announcementPreviewData?.recipientCount === 1 ? "" : "s"}.`}
        confirmLabel="Publish announcement"
        details={[
          announcementPreviewData ? `Audience summary: ${announcementPreviewData.audienceSummary}` : "Preview the audience first.",
          announcementTitle ? `Title: ${announcementTitle}` : "Title is missing.",
          announcementPriority === "urgent" ? "This will show as an urgent student-facing notice." : `Priority: ${announcementPriority}`,
        ]}
      />
    </section>
  );
}
