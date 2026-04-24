import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../components/providers/AuthProvider";
import { Button, Card, Input, Spinner, Tabs } from "../../components/ui";
import {
  createFeedbackCampaign,
  downloadFeedbackCampaignExport,
  publishFeedbackCampaign,
  useHodFeedbackCampaignDetail,
  useHodFeedbackCampaignResponses,
  useHodFeedbackCampaigns,
  type AcademicYear,
  type FeedbackCampaignType,
} from "../../hooks/use-feedback";
import {
  resolveSupportTicket,
  updateSupportTicket,
  useHodSupportTicket,
  useHodSupportTickets,
  type SupportTicketStatus,
} from "../../hooks/use-support";

type HodTabId = "create" | "campaigns" | "responses" | "grievance";

const tabItems: Array<{ id: HodTabId; label: string }> = [
  { id: "create", label: "Create Feedback" },
  { id: "campaigns", label: "Published & Drafts" },
  { id: "responses", label: "Responses" },
  { id: "grievance", label: "Grievance" },
];

const campaignTypeOptions: Array<{ value: FeedbackCampaignType; label: string }> = [
  { value: "drive_feedback", label: "Drive feedback" },
  { value: "faculty_feedback_single", label: "Faculty feedback (single)" },
  { value: "faculty_feedback_all", label: "Faculty feedback (all faculty)" },
  { value: "training_activity_feedback", label: "Training activity feedback" },
  { value: "mock_test_feedback", label: "Mock test feedback" },
  { value: "general_department_feedback", label: "General department feedback" },
  { value: "custom_feedback", label: "Custom feedback form" },
];

const academicYearOptions: Array<{ value: AcademicYear; label: string }> = [
  { value: "first_year", label: "First year" },
  { value: "second_year", label: "Second year" },
  { value: "third_year", label: "Third year" },
  { value: "final_year", label: "Final year" },
];

function formatType(value: string) {
  return value.replace(/_/g, " ");
}

function toIsoOrUndefined(value: string) {
  if (!value.trim()) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatAcademicYear(value: string | null | undefined) {
  if (!value) return "Not mapped";
  return value.replace(/_/g, " ");
}

export default function HodDashboardPage() {
  const { profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<HodTabId>(location.hash === "#grievance" ? "grievance" : "create");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [publishBusyId, setPublishBusyId] = useState<string | null>(null);
  const [exportBusyId, setExportBusyId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [type, setType] = useState<FeedbackCampaignType>("drive_feedback");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [facultyInput, setFacultyInput] = useState("");
  const [openAt, setOpenAt] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [selectedYears, setSelectedYears] = useState<AcademicYear[]>([]);
  const [customSubjectLabel, setCustomSubjectLabel] = useState("");
  const [customCommentPrompt, setCustomCommentPrompt] = useState("Share your feedback.");
  const [customQuestions, setCustomQuestions] = useState<string[]>([""]);
  const [grievanceView, setGrievanceView] = useState<"open" | "in_review" | "resolved">("open");
  const [grievanceSearch, setGrievanceSearch] = useState("");
  const [selectedGrievanceId, setSelectedGrievanceId] = useState<string | null>(null);
  const [grievanceResolutionNote, setGrievanceResolutionNote] = useState("");
  const [grievanceBusy, setGrievanceBusy] = useState(false);
  const [grievanceStatusMessage, setGrievanceStatusMessage] = useState<string | null>(null);

  const { data: campaigns, error: campaignsError, isLoading: campaignsLoading } = useHodFeedbackCampaigns();
  const { data: campaignDetail, error: detailError, isLoading: detailLoading } = useHodFeedbackCampaignDetail(selectedCampaignId);
  const { data: campaignResponses, error: responsesError, isLoading: responsesLoading } = useHodFeedbackCampaignResponses(selectedCampaignId);
  const grievanceQuery = useHodSupportTickets({
    status: grievanceView === "resolved" ? undefined : grievanceView,
    submitterRole: "student",
    q: grievanceSearch || undefined,
  });
  const grievanceDetail = useHodSupportTicket(selectedGrievanceId);

  useEffect(() => {
    setActiveTab(location.hash === "#grievance" ? "grievance" : activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash]);

  useEffect(() => {
    if (!selectedCampaignId && campaigns && campaigns.length > 0) {
      setSelectedCampaignId(campaigns[0].id);
    }
  }, [campaigns, selectedCampaignId]);

  useEffect(() => {
    if (!selectedGrievanceId && grievanceQuery.data && grievanceQuery.data.items.length > 0) {
      setSelectedGrievanceId(grievanceQuery.data.items[0].id);
    }
  }, [grievanceQuery.data, selectedGrievanceId]);

  const resetCreateForm = () => {
    setType("drive_feedback");
    setTitle("");
    setDescription("");
    setBatchInput("");
    setFacultyInput("");
    setOpenAt("");
    setCloseAt("");
    setSelectedYears([]);
    setCustomSubjectLabel("");
    setCustomCommentPrompt("Share your feedback.");
    setCustomQuestions([""]);
  };

  const toggleAcademicYear = (year: AcademicYear) => {
    setSelectedYears((current) =>
      current.includes(year) ? current.filter((item) => item !== year) : [...current, year],
    );
  };

  const setQuestionAt = (index: number, value: string) => {
    setCustomQuestions((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
  };

  const addQuestion = () => {
    setCustomQuestions((current) => [...current, ""]);
  };

  const removeQuestion = (index: number) => {
    setCustomQuestions((current) => (current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index)));
  };

  const canCreate = title.trim().length >= 4 && (
    type !== "custom_feedback"
      ? true
      : customSubjectLabel.trim().length >= 2 && customQuestions.some((question) => question.trim().length >= 2)
  );

  const submitCreate = async () => {
    if (!canCreate) return;
    setCreateBusy(true);
    setStatusMessage(null);
    try {
      const created = await createFeedbackCampaign({
        type,
        title: title.trim(),
        description: description.trim() || undefined,
        targetBatches: splitCsv(batchInput),
        targetAcademicYears: selectedYears,
        facultyTargets: splitCsv(facultyInput).map((name) => ({ name })),
        openAt: toIsoOrUndefined(openAt),
        closeAt: toIsoOrUndefined(closeAt),
        customTemplate: type === "custom_feedback"
          ? {
            subjectLabel: customSubjectLabel.trim(),
            commentPrompt: customCommentPrompt.trim() || undefined,
            questions: customQuestions
              .map((question) => question.trim())
              .filter(Boolean)
              .map((label) => ({ label })),
          }
          : undefined,
      });
      setSelectedCampaignId(created.id);
      setActiveTab("campaigns");
      setStatusMessage("Feedback campaign saved as draft.");
      resetCreateForm();
    } catch (createError) {
      setStatusMessage(createError instanceof Error ? createError.message : "Unable to create feedback campaign right now.");
    } finally {
      setCreateBusy(false);
    }
  };

  const handlePublish = async (campaignId: string) => {
    setPublishBusyId(campaignId);
    setStatusMessage(null);
    try {
      await publishFeedbackCampaign(campaignId);
      setSelectedCampaignId(campaignId);
      setActiveTab("responses");
      setStatusMessage("Feedback campaign published successfully.");
    } catch (publishError) {
      setStatusMessage(publishError instanceof Error ? publishError.message : "Unable to publish this campaign.");
    } finally {
      setPublishBusyId(null);
    }
  };

  const handleExport = async (campaignId: string, filenameHint: string) => {
    setExportBusyId(campaignId);
    setStatusMessage(null);
    try {
      await downloadFeedbackCampaignExport(campaignId, filenameHint);
    } catch (exportError) {
      setStatusMessage(exportError instanceof Error ? exportError.message : "Unable to download the feedback export.");
    } finally {
      setExportBusyId(null);
    }
  };

  const switchTab = (tabId: string) => {
    const nextTab = tabId as HodTabId;
    setActiveTab(nextTab);
    if (nextTab === "grievance") {
      navigate("/hod#grievance", { replace: true });
      return;
    }
    if (location.hash) {
      navigate("/hod", { replace: true });
    }
  };

  const visibleGrievances = useMemo(() => {
    const items = grievanceQuery.data?.items ?? [];
    if (grievanceView === "resolved") {
      return items.filter((item) => ["resolved", "closed", "rejected"].includes(item.status));
    }
    return items;
  }, [grievanceQuery.data?.items, grievanceView]);

  const assignGrievanceToMe = async () => {
    if (!selectedGrievanceId || !profile?.id) return;
    setGrievanceBusy(true);
    setGrievanceStatusMessage(null);
    try {
      await updateSupportTicket("hod", selectedGrievanceId, {
        assignedToUserId: profile.id,
        status: "in_review",
      });
      setGrievanceStatusMessage("Grievance assigned to you and moved to in review.");
    } catch (error) {
      setGrievanceStatusMessage(error instanceof Error ? error.message : "Unable to assign this grievance right now.");
    } finally {
      setGrievanceBusy(false);
    }
  };

  const moveGrievanceStatus = async (status: SupportTicketStatus) => {
    if (!selectedGrievanceId) return;
    setGrievanceBusy(true);
    setGrievanceStatusMessage(null);
    try {
      await updateSupportTicket("hod", selectedGrievanceId, { status });
      setGrievanceStatusMessage(`Grievance moved to ${status.replace(/_/g, " ")}.`);
    } catch (error) {
      setGrievanceStatusMessage(error instanceof Error ? error.message : "Unable to update this grievance right now.");
    } finally {
      setGrievanceBusy(false);
    }
  };

  const resolveGrievance = async (status: "resolved" | "closed" | "rejected") => {
    if (!selectedGrievanceId || grievanceResolutionNote.trim().length < 2) return;
    setGrievanceBusy(true);
    setGrievanceStatusMessage(null);
    try {
      await resolveSupportTicket("hod", selectedGrievanceId, {
        resolutionNote: grievanceResolutionNote,
        status,
      });
      setGrievanceResolutionNote("");
      setGrievanceStatusMessage(`Grievance marked as ${status.replace(/_/g, " ")}.`);
    } catch (error) {
      setGrievanceStatusMessage(error instanceof Error ? error.message : "Unable to resolve this grievance right now.");
    } finally {
      setGrievanceBusy(false);
    }
  };

  return (
    <section className="student-workspace-shell">
      <header className="tpo-workspace-header">
        <div className="tpo-workspace-header-copy">
          <p className="resources-kicker">HOD dashboard</p>
          <h1>Publish feedback and review responses in one focused workspace.</h1>
          <p>
            Students respond without typing their name, branch, batch, or PRN again.
            SmartPath maps that automatically from their login.
          </p>
        </div>
      </header>

      <Tabs tabs={tabItems} activeId={activeTab} onChange={switchTab} />

      {statusMessage ? (
        <Card className="app-state-card app-state-card-compact">
          <p>{statusMessage}</p>
        </Card>
      ) : null}

      {activeTab === "create" ? (
        <Card className="feedback-tab-panel">
          <div className="tpo-queue-card-head">
            <div>
              <h2>Create feedback</h2>
              <p className="muted-text">Publish department feedback without sending students through scattered cards and forms.</p>
            </div>
          </div>

          <div className="student-profile-field-grid">
            <label>
              Feedback type
              <select value={type} onChange={(event) => setType(event.target.value as FeedbackCampaignType)}>
                {campaignTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label>
              Title
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Final year faculty feedback" />
            </label>

            <label className="tpo-communication-full">
              Description
              <textarea
                rows={4}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Tell students what this feedback is for and any special instructions."
              />
            </label>

            <label>
              Batches
              <Input
                value={batchInput}
                onChange={(event) => setBatchInput(event.target.value)}
                placeholder="e.g. 2025, 2026"
              />
            </label>

            <label>
              Faculty names
              <Input
                value={facultyInput}
                onChange={(event) => setFacultyInput(event.target.value)}
                placeholder="Comma separated. Needed for faculty feedback."
              />
            </label>

            <label>
              Open at
              <input type="datetime-local" value={openAt} onChange={(event) => setOpenAt(event.target.value)} />
            </label>

            <label>
              Close at
              <input type="datetime-local" value={closeAt} onChange={(event) => setCloseAt(event.target.value)} />
            </label>

            <div className="tpo-communication-full">
              <span>Academic years</span>
              <div className="feedback-chip-grid">
                {academicYearOptions.map((option) => (
                  <label key={option.value} className="feedback-chip-option">
                    <input
                      type="checkbox"
                      checked={selectedYears.includes(option.value)}
                      onChange={() => toggleAcademicYear(option.value)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {type === "custom_feedback" ? (
              <div className="tpo-communication-full feedback-custom-builder">
                <div className="tpo-queue-card-head">
                  <div>
                    <h3>Custom form builder</h3>
                    <p className="muted-text">This lets you create a department-specific feedback form without forcing a fixed template.</p>
                  </div>
                </div>
                <div className="student-profile-field-grid">
                  <label>
                    Subject label
                    <Input
                      value={customSubjectLabel}
                      onChange={(event) => setCustomSubjectLabel(event.target.value)}
                      placeholder="e.g. Laboratory, Event, Course module"
                    />
                  </label>

                  <label className="tpo-communication-full">
                    Comment prompt
                    <Input
                      value={customCommentPrompt}
                      onChange={(event) => setCustomCommentPrompt(event.target.value)}
                      placeholder="e.g. Share one thing that should improve"
                    />
                  </label>

                  <div className="tpo-communication-full feedback-question-builder">
                    <div className="feedback-question-builder-head">
                      <strong>Questions</strong>
                      <Button variant="ghost" onClick={addQuestion}>Add question</Button>
                    </div>
                    {customQuestions.map((question, index) => (
                      <div key={`question-${index}`} className="feedback-question-row">
                        <Input
                          value={question}
                          onChange={(event) => setQuestionAt(index, event.target.value)}
                          placeholder={`Question ${index + 1}`}
                        />
                        <Button
                          variant="ghost"
                          onClick={() => removeQuestion(index)}
                          disabled={customQuestions.length === 1}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="feedback-toolbar">
            <Button onClick={() => void submitCreate()} disabled={!canCreate || createBusy}>
              {createBusy ? "Saving..." : "Save draft"}
            </Button>
          </div>
        </Card>
      ) : null}

      {activeTab === "campaigns" ? (
        <Card className="feedback-tab-panel">
          <div className="tpo-queue-card-head">
            <div>
              <h2>Campaigns</h2>
              <p className="muted-text">Click any campaign and the full response workspace opens immediately.</p>
            </div>
          </div>

          {campaignsLoading ? (
            <div className="app-state-card">
              <Spinner />
              <p className="muted-text">Loading feedback campaigns...</p>
            </div>
          ) : campaignsError ? (
            <div className="app-state-card app-state-card-error">
              <h3>Unable to load campaigns</h3>
              <p>{campaignsError instanceof Error ? campaignsError.message : "Unknown error"}</p>
            </div>
          ) : !campaigns || campaigns.length === 0 ? (
            <div className="app-state-card">
              <h3>No feedback campaigns yet</h3>
              <p className="muted-text">Create your first feedback request from the tab above.</p>
            </div>
          ) : (
            <div className="student-workspace-list">
              {campaigns.map((campaign) => (
                <button
                  key={campaign.id}
                  type="button"
                  className={`student-workspace-row feedback-list-button ${selectedCampaignId === campaign.id ? "active" : ""}`.trim()}
                  onClick={() => {
                    setSelectedCampaignId(campaign.id);
                    setActiveTab("responses");
                  }}
                >
                  <div>
                    <strong>{campaign.title}</strong>
                    <p>{formatType(campaign.type)}</p>
                    <p className="muted-text">
                      {campaign.responseCount} response{campaign.responseCount === 1 ? "" : "s"} • {campaign.pendingCount} pending
                    </p>
                  </div>
                  <div className="feedback-row-actions">
                    <span className={`ui-badge ${campaign.status === "published" ? "success" : "default"}`.trim()}>
                      {campaign.status.replace(/_/g, " ")}
                    </span>
                    <Button
                      variant="ghost"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleExport(campaign.id, campaign.title);
                      }}
                      disabled={exportBusyId === campaign.id}
                    >
                      {exportBusyId === campaign.id ? "Downloading..." : "Download Excel"}
                    </Button>
                    {campaign.status === "draft" ? (
                      <Button
                        onClick={(event) => {
                          event.stopPropagation();
                          void handlePublish(campaign.id);
                        }}
                        disabled={publishBusyId === campaign.id}
                      >
                        {publishBusyId === campaign.id ? "Publishing..." : "Publish"}
                      </Button>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {activeTab === "responses" ? (
        <Card className="feedback-tab-panel">
          {!selectedCampaignId ? (
            <div className="app-state-card">
              <h3>Select a campaign first</h3>
              <p className="muted-text">Open a campaign from the previous tab and the full response view will appear here.</p>
            </div>
          ) : detailLoading || responsesLoading ? (
            <div className="app-state-card">
              <Spinner />
              <p className="muted-text">Loading responses...</p>
            </div>
          ) : detailError || responsesError || !campaignDetail || !campaignResponses ? (
            <div className="app-state-card app-state-card-error">
              <h3>Unable to load campaign responses</h3>
              <p>{detailError instanceof Error ? detailError.message : responsesError instanceof Error ? responsesError.message : "Unknown error"}</p>
            </div>
          ) : (
            <div className="student-workspace-list">
              <div className="student-workspace-row">
                <div>
                  <strong>{campaignDetail.title}</strong>
                  <p>{formatType(campaignDetail.type)}</p>
                  <p className="muted-text">
                    {campaignDetail.analytics.totalResponses} responses • {campaignDetail.pendingCount} pending
                  </p>
                </div>
                <div className="feedback-row-actions">
                  <Button
                    variant="ghost"
                    onClick={() => void handleExport(campaignDetail.id, campaignDetail.title)}
                    disabled={exportBusyId === campaignDetail.id}
                  >
                    {exportBusyId === campaignDetail.id ? "Downloading..." : "Download Excel"}
                  </Button>
                </div>
              </div>

              <div className="feedback-split-grid">
                <Card className="feedback-inline-card">
                  <div className="tpo-queue-card-head">
                    <div>
                      <h3>Question averages</h3>
                      <p className="muted-text">This stays high level so you can read trends quickly.</p>
                    </div>
                  </div>
                  {campaignDetail.analytics.questionAverages.length === 0 ? (
                    <p className="muted-text">No responses yet.</p>
                  ) : (
                    <div className="student-workspace-list">
                      {campaignDetail.analytics.questionAverages.map((item) => (
                        <div key={item.key} className="student-workspace-row">
                          <div>
                            <strong>{item.label}</strong>
                            <p className="muted-text">{item.count} ratings</p>
                          </div>
                          <span className="ui-badge default">{item.average.toFixed(2)} / 5</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card className="feedback-inline-card">
                  <div className="tpo-queue-card-head">
                    <div>
                      <h3>Recent comments</h3>
                      <p className="muted-text">Latest comments are kept visible without pushing the response table far down.</p>
                    </div>
                  </div>
                  {campaignDetail.analytics.comments.length === 0 ? (
                    <p className="muted-text">No comments yet.</p>
                  ) : (
                    <div className="student-workspace-list">
                      {campaignDetail.analytics.comments.slice(0, 6).map((item, index) => (
                        <div key={`${item.studentName}-${index}`} className="student-workspace-row">
                          <div>
                            <strong>{item.studentName}</strong>
                            <p>{item.subjectLabel}</p>
                            <p className="muted-text">{item.comment}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              <Card className="feedback-inline-card">
                <div className="tpo-queue-card-head">
                  <div>
                    <h3>Response table</h3>
                    <p className="muted-text">Student info is auto-mapped. This is the same data that goes into the Excel export.</p>
                  </div>
                </div>
                {campaignResponses.items.length === 0 ? (
                  <p className="muted-text">No responses submitted yet.</p>
                ) : (
                  <div className="student-workspace-list">
                    {campaignResponses.items.map((item) => (
                      <div key={item.id} className="student-workspace-row feedback-response-row">
                        <div>
                          <strong>{item.student.fullName}</strong>
                          <p>
                            {item.student.branch} • {item.student.batch} • {formatAcademicYear(item.student.academicYear)}
                          </p>
                          <p className="muted-text">
                            PRN: {item.student.prn || "Not mapped"} • Roll: {item.student.rollNumber || "Not mapped"}
                          </p>
                          <p className="muted-text">
                            {item.responses.length} feedback entr{item.responses.length === 1 ? "y" : "ies"} • {new Date(item.submittedAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}
        </Card>
      ) : null}

      {activeTab === "grievance" ? (
        <Card className="feedback-tab-panel">
          <div className="tpo-queue-card-head">
            <div>
              <h2>Grievance</h2>
              <p className="muted-text">Students can now send department-level grievances here. This queue only shows HOD-routed tickets for your department.</p>
            </div>
          </div>
          <Tabs
            tabs={[
              { id: "open", label: `Open (${grievanceQuery.data?.counts.open ?? 0})` },
              { id: "in_review", label: `In review (${grievanceQuery.data?.counts.inReview ?? 0})` },
              { id: "resolved", label: `Resolved (${grievanceQuery.data?.counts.resolved ?? 0})` },
            ]}
            activeId={grievanceView}
            onChange={(tabId) => setGrievanceView(tabId as "open" | "in_review" | "resolved")}
          />

          <div className="student-profile-field-grid">
            <label className="tpo-communication-full">
              Search grievances
              <Input
                value={grievanceSearch}
                onChange={(event) => setGrievanceSearch(event.target.value)}
                placeholder="Title, description, student name, or email"
              />
            </label>
          </div>

          <div className="feedback-split-grid">
            <Card className="feedback-inline-card">
              <div className="tpo-queue-card-head">
                <div>
                  <h3>Department grievance queue</h3>
                  <p className="muted-text">Only grievances routed to HOD are shown here.</p>
                </div>
              </div>
              {grievanceQuery.isLoading ? (
                <div className="app-state-card">
                  <Spinner />
                  <p className="muted-text">Loading grievances...</p>
                </div>
              ) : grievanceQuery.error ? (
                <div className="app-state-card app-state-card-error">
                  <h3>Unable to load grievances</h3>
                  <p>{grievanceQuery.error instanceof Error ? grievanceQuery.error.message : "Unknown error"}</p>
                </div>
              ) : visibleGrievances.length === 0 ? (
                <p className="muted-text">No grievances matched this queue.</p>
              ) : (
                <div className="student-workspace-list">
                  {visibleGrievances.map((ticket) => (
                    <button
                      key={ticket.id}
                      type="button"
                      className={`student-workspace-row feedback-list-button ${selectedGrievanceId === ticket.id ? "active" : ""}`.trim()}
                      onClick={() => setSelectedGrievanceId(ticket.id)}
                    >
                      <div>
                        <strong>{ticket.title}</strong>
                        <p>{ticket.createdBy.fullName} • {ticket.category.replace(/_/g, " ")}</p>
                        <p className="muted-text">{ticket.description.slice(0, 140)}{ticket.description.length > 140 ? "..." : ""}</p>
                      </div>
                      <span className="ui-badge warning">{ticket.status.replace(/_/g, " ")}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>

            <Card className="feedback-inline-card">
              {!selectedGrievanceId ? (
                <div className="app-state-card">
                  <h3>Select a grievance</h3>
                  <p className="muted-text">Open one item from the queue to review and resolve it here.</p>
                </div>
              ) : grievanceDetail.isLoading ? (
                <div className="app-state-card">
                  <Spinner />
                  <p className="muted-text">Loading grievance detail...</p>
                </div>
              ) : grievanceDetail.error || !grievanceDetail.data ? (
                <div className="app-state-card app-state-card-error">
                  <h3>Unable to load grievance detail</h3>
                  <p>{grievanceDetail.error instanceof Error ? grievanceDetail.error.message : "Unknown error"}</p>
                </div>
              ) : (
                <>
                  <div className="tpo-queue-card-head">
                    <div>
                      <h3>{grievanceDetail.data.title}</h3>
                      <p className="muted-text">{grievanceDetail.data.createdBy.fullName} • {grievanceDetail.data.createdBy.email}</p>
                    </div>
                  </div>
                  <p>{grievanceDetail.data.description}</p>
                  <div className="student-workspace-inline-note">
                    <span>Status: {grievanceDetail.data.status.replace(/_/g, " ")}</span>
                    <span>Priority: {grievanceDetail.data.priority}</span>
                    <span>{grievanceDetail.data.assignedTo ? `Assigned to ${grievanceDetail.data.assignedTo.fullName}` : "Unassigned"}</span>
                  </div>
                  {grievanceDetail.data.resolutionNote ? (
                    <p><strong>Latest resolution note:</strong> {grievanceDetail.data.resolutionNote}</p>
                  ) : null}
                  <div className="feedback-row-actions">
                    <Button variant="ghost" onClick={() => void assignGrievanceToMe()} disabled={grievanceBusy}>
                      Assign to me
                    </Button>
                    <Button variant="ghost" onClick={() => void moveGrievanceStatus("in_review")} disabled={grievanceBusy}>
                      Move to in review
                    </Button>
                    <Button variant="ghost" onClick={() => void moveGrievanceStatus("open")} disabled={grievanceBusy}>
                      Reopen
                    </Button>
                  </div>
                  <label className="tpo-communication-full">
                    Resolution note
                    <textarea
                      rows={5}
                      value={grievanceResolutionNote}
                      onChange={(event) => setGrievanceResolutionNote(event.target.value)}
                      placeholder="Explain what was checked, what changed, and what the student should do next."
                    />
                  </label>
                  <div className="feedback-row-actions">
                    <Button onClick={() => void resolveGrievance("resolved")} disabled={grievanceBusy || grievanceResolutionNote.trim().length < 2}>
                      Mark resolved
                    </Button>
                    <Button variant="secondary" onClick={() => void resolveGrievance("closed")} disabled={grievanceBusy || grievanceResolutionNote.trim().length < 2}>
                      Close
                    </Button>
                    <Button variant="ghost" onClick={() => void resolveGrievance("rejected")} disabled={grievanceBusy || grievanceResolutionNote.trim().length < 2}>
                      Reject
                    </Button>
                  </div>
                  {grievanceStatusMessage ? <p className="muted-text">{grievanceStatusMessage}</p> : null}
                </>
              )}
            </Card>
          </div>
        </Card>
      ) : null}
    </section>
  );
}
