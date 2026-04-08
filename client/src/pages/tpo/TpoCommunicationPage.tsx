import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Badge, Button, ConfirmActionModal, Input, Select, Table, Tabs } from "../../components/ui";
import {
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
import { useDrives } from "../../hooks/use-drives";
import { dismissAutomationRun, releaseAutomationRun, useTpoAutomationRuns } from "../../hooks/use-tpo-automation";
import { updateTenantEmailSettings, updateTenantPlacementPolicy, useTenantSettings } from "../../hooks/use-tenant";

type CommunicationMode = "email" | "announcements";
type MessagePreset = "drive-announcement" | "eligible-reminder" | "profile-completion" | "mock-test" | "custom";

const modeTabs: Array<{ id: CommunicationMode; label: string }> = [
  { id: "email", label: "Email" },
  { id: "announcements", label: "Announcements" },
];

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

function toIsoDateTime(value: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

export default function TpoCommunicationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
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

  const buildFilters = () => ({
    driveId: driveId || undefined,
    eligibleOnly,
    branch: branch || undefined,
    batch: batch || undefined,
    minCgpa: minCgpa ? Number(minCgpa) : undefined,
    maxRecipients: maxRecipients ? Number(maxRecipients) : undefined,
    studentIds: selectedStudentIds.length > 0 ? selectedStudentIds : undefined,
  });

  const buildEmailPayload = () => ({
    templateId: templateId || undefined,
    subject: templateId ? undefined : subject,
    body: templateId ? undefined : body,
    variables: customMessage ? { message: customMessage } : undefined,
    filters: buildFilters(),
  });

  const buildAnnouncementPayload = () => ({
    title: announcementTitle,
    message: announcementMessage,
    priority: announcementPriority,
    relatedDriveId: driveId || undefined,
    expiresAt: toIsoDateTime(announcementExpiresAt),
    filters: buildFilters(),
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
      <header className="tpo-communication-header">
        <div>
          <h1>Communication</h1>
        </div>
        {mode === "email" ? (
          <div className="hero-actions">
            <Button variant="ghost" onClick={() => setShowPlacementSettings((current) => !current)}>
              {showPlacementSettings ? "Hide placement policy" : "Placement policy"}
            </Button>
            <Button variant="ghost" onClick={() => setShowSenderSettings((current) => !current)}>
              {showSenderSettings ? "Hide sender" : "Sender"}
            </Button>
          </div>
        ) : null}
      </header>

      <div className="tpo-communication-switcher">
        <Tabs tabs={modeTabs} activeId={mode} onChange={(id) => setMode(id as CommunicationMode)} />
      </div>

      {automationDrafts && automationDrafts.length > 0 ? (
        <section className="tpo-communication-panel">
          <div className="workspace-panel-header">
            <div>
              <p className="workspace-eyebrow">Automation Drafts</p>
              <h2>Review-first reminders and digests</h2>
              <p className="muted-text">These runs were generated automatically, but they still need explicit TPO review before anything is sent.</p>
            </div>
          </div>
          <div className="tpo-action-list">
            {automationDrafts.map((run) => {
              const preview = run.preview as { title?: string; targetPath?: string };
              const highlighted = automationRunId === run.id;
              return (
                <div key={run.id} className="tpo-action-row" style={highlighted ? { border: "1px solid rgba(37, 99, 235, 0.2)", borderRadius: 16, padding: 12 } : undefined}>
                  <div>
                    <div className="tpo-action-row-head">
                      <strong>{preview.title ?? run.automationType.replace(/_/g, " ")}</strong>
                      <Badge variant={highlighted ? "success" : "warning"}>{run.status}</Badge>
                    </div>
                    <p className="muted-text">{run.explanation}</p>
                    <p className="muted-text">{run.audienceSummary ?? "Pending automation draft"}</p>
                  </div>
                  <div className="hero-actions">
                    {preview.targetPath ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          const next = new URLSearchParams(searchParams);
                          next.set("automationRunId", run.id);
                          setSearchParams(next, { replace: true });
                        }}
                      >
                        Focus
                      </Button>
                    ) : null}
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await releaseAutomationRun(run.id);
                          setStatus("Automation draft released successfully.");
                        } catch (actionError) {
                          setStatus(actionError instanceof Error ? actionError.message : "Unable to release automation draft");
                        }
                      }}
                    >
                      Release
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await dismissAutomationRun(run.id);
                          setStatus("Automation draft dismissed.");
                        } catch (actionError) {
                          setStatus(actionError instanceof Error ? actionError.message : "Unable to dismiss automation draft");
                        }
                      }}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              );
            })}
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

      <section className="tpo-communication-simple-grid">
        <div className="tpo-communication-main">
          {selectedStudentIds.length > 0 ? (
            <section className="tpo-communication-panel tpo-communication-direct-audience">
              <div>
                <p className="workspace-eyebrow">Direct Audience</p>
                <h2>{selectedStudentIds.length} selected student{selectedStudentIds.length === 1 ? "" : "s"}</h2>
                <p className="muted-text">This reminder was opened from the Students intervention workspace. Drive, branch, and batch filters still work as narrower filters on top of the selected audience.</p>
              </div>
              <Button variant="ghost" onClick={clearSelectedStudents}>Clear selection</Button>
            </section>
          ) : null}

          {mode === "email" ? (
            <>
              <section className="tpo-communication-panel">
                <div className="tpo-communication-purpose-pills">
                  {(Object.entries(presetLibrary) as Array<[MessagePreset, typeof presetLibrary[MessagePreset]]>).map(([id, config]) => (
                    <button
                      key={id}
                      type="button"
                      className={`tpo-communication-pill ${preset === id ? "active" : ""}`}
                      onClick={() => setPreset(id)}
                    >
                      {config.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="tpo-communication-panel">
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
                    Note
                    <Input value={customMessage} onChange={(event) => { setCustomMessage(event.target.value); invalidatePreviews(); }} placeholder="Add the exact update, deadline, room, or instruction" />
                  </label>
                  {!templateId ? (
                    <>
                      <label className="tpo-communication-full">
                        Subject
                        <Input value={subject} onChange={(event) => { setSubject(event.target.value); invalidatePreviews(); }} />
                      </label>
                      <label className="tpo-communication-full">
                        Message
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
                <div className="tpo-communication-inline-grid">
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
                    Related drive
                    <Select value={driveId} onChange={(event) => { setDriveId(event.target.value); invalidatePreviews(); }}>
                      <option value="">None</option>
                      {(drives?.items ?? []).map((drive) => (
                        <option key={drive.id} value={drive.id}>
                          {drive.company} {drive.role ? `- ${drive.role}` : ""}
                        </option>
                      ))}
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
