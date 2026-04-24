import { useEffect, useMemo, useState } from "react";

import { Button, Card, Spinner, Tabs } from "../../components/ui";
import {
  submitFeedbackCampaign,
  useStudentFeedbackCampaign,
  useStudentFeedbackCampaigns,
} from "../../hooks/use-feedback";

type StudentTabId = "pending" | "form" | "submitted";

type FormState = Array<{
  subjectId?: string;
  subjectLabel: string;
  ratings: Record<string, number>;
  comment: string;
}>;

const tabItems: Array<{ id: StudentTabId; label: string }> = [
  { id: "pending", label: "Pending" },
  { id: "form", label: "Form" },
  { id: "submitted", label: "Submitted" },
];

function formatStatus(value: string) {
  return value.replace(/_/g, " ");
}

function buildInitialResponses(campaign: NonNullable<ReturnType<typeof useStudentFeedbackCampaign>["data"]>): FormState {
  const template = campaign.template;
  if (!template) return [];

  const subjectSeed = campaign.facultyTargets.length > 0
    ? campaign.facultyTargets.map((target) => ({
      subjectId: target.id || undefined,
      subjectLabel: target.name,
    }))
    : [{
      subjectId: undefined,
      subjectLabel:
        template.subjectLabel === "Department"
          ? campaign.department
          : template.subjectLabel === "Drive"
            ? campaign.title
            : template.subjectLabel,
    }];

  return subjectSeed.map((subject) => ({
    subjectId: subject.subjectId,
    subjectLabel: subject.subjectLabel,
    ratings: Object.fromEntries(template.questions.map((question) => [question.key, 0])),
    comment: "",
  }));
}

export default function FeedbackPage() {
  const { data, error, isLoading } = useStudentFeedbackCampaigns();
  const [activeTab, setActiveTab] = useState<StudentTabId>("pending");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const { data: selectedCampaign, error: detailError, isLoading: detailLoading } = useStudentFeedbackCampaign(selectedCampaignId);
  const [formState, setFormState] = useState<FormState>([]);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const pendingCampaigns = useMemo(
    () => (data ?? []).filter((campaign) => !campaign.submittedAt),
    [data],
  );
  const submittedCampaigns = useMemo(
    () => (data ?? []).filter((campaign) => campaign.submittedAt),
    [data],
  );

  useEffect(() => {
    if (pendingCampaigns.length > 0 && !selectedCampaignId) {
      setSelectedCampaignId(pendingCampaigns[0].id);
    }
  }, [pendingCampaigns, selectedCampaignId]);

  useEffect(() => {
    if (selectedCampaign) {
      setFormState(buildInitialResponses(selectedCampaign));
      setStatusMessage(null);
    }
  }, [selectedCampaign]);

  const openCampaign = (campaignId: string) => {
    setSelectedCampaignId(campaignId);
    setActiveTab("form");
  };

  const submit = async () => {
    if (!selectedCampaignId) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      await submitFeedbackCampaign(selectedCampaignId, {
        responses: formState.map((item) => ({
          subjectId: item.subjectId,
          subjectLabel: item.subjectLabel,
          ratings: item.ratings,
          comment: item.comment.trim() || undefined,
        })),
      });
      setStatusMessage("Feedback submitted successfully.");
      setActiveTab("submitted");
    } catch (submitError) {
      setStatusMessage(submitError instanceof Error ? submitError.message : "Unable to submit feedback right now.");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = formState.length > 0 && formState.every((item) =>
    Object.values(item.ratings).every((value) => value >= 1 && value <= 5),
  );

  return (
    <section className="student-workspace-shell">
      <header className="student-workspace-header">
        <div>
          <p className="resources-kicker">Feedback</p>
          <h1>Open one feedback form at a time and submit it on the same screen.</h1>
          <p>
            Your SmartPath account already fills your student identity.
            You only answer the feedback itself.
          </p>
        </div>
      </header>

      <Tabs tabs={tabItems} activeId={activeTab} onChange={(tabId) => setActiveTab(tabId as StudentTabId)} />

      {statusMessage ? (
        <Card className="app-state-card app-state-card-compact">
          <p>{statusMessage}</p>
        </Card>
      ) : null}

      {activeTab === "pending" ? (
        <Card className="feedback-tab-panel">
          <div className="tpo-queue-card-head">
            <div>
              <h2>Pending feedback</h2>
              <p className="muted-text">Click once and the full form opens immediately in the next tab.</p>
            </div>
          </div>

          {isLoading ? (
            <div className="app-state-card">
              <Spinner />
              <p className="muted-text">Loading assigned feedback...</p>
            </div>
          ) : error ? (
            <div className="app-state-card app-state-card-error">
              <h3>Unable to load feedback</h3>
              <p>{error instanceof Error ? error.message : "Unknown error"}</p>
            </div>
          ) : pendingCampaigns.length === 0 ? (
            <div className="app-state-card">
              <h3>No pending feedback right now</h3>
              <p className="muted-text">New feedback requests will appear here automatically when your department publishes them.</p>
            </div>
          ) : (
            <div className="student-workspace-list">
              {pendingCampaigns.map((campaign) => (
                <button
                  key={campaign.id}
                  type="button"
                  className={`student-workspace-row feedback-list-button ${selectedCampaignId === campaign.id ? "active" : ""}`.trim()}
                  onClick={() => openCampaign(campaign.id)}
                >
                  <div>
                    <strong>{campaign.title}</strong>
                    <p>{formatStatus(campaign.type)}</p>
                    <p className="muted-text">{campaign.description || "Open this form to respond."}</p>
                  </div>
                  <span className="ui-badge warning">Pending</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {activeTab === "form" ? (
        <Card className="feedback-tab-panel">
          <div className="tpo-queue-card-head">
            <div>
              <h2>Feedback form</h2>
              <p className="muted-text">The selected form uses the full main content area so nothing feels hidden below a card stack.</p>
            </div>
          </div>

          {!selectedCampaignId ? (
            <div className="app-state-card">
              <h3>Select a feedback request first</h3>
              <p className="muted-text">Open the Pending tab and choose one feedback item.</p>
            </div>
          ) : detailLoading ? (
            <div className="app-state-card">
              <Spinner />
              <p className="muted-text">Loading feedback form...</p>
            </div>
          ) : detailError || !selectedCampaign ? (
            <div className="app-state-card app-state-card-error">
              <h3>Unable to load this feedback</h3>
              <p>{detailError instanceof Error ? detailError.message : "Unknown error"}</p>
            </div>
          ) : selectedCampaign.submittedAt ? (
            <div className="app-state-card">
              <h3>{selectedCampaign.title}</h3>
              <p className="muted-text">Already submitted on {new Date(selectedCampaign.submittedAt).toLocaleString()}.</p>
            </div>
          ) : !selectedCampaign.template ? (
            <div className="app-state-card app-state-card-error">
              <h3>This feedback form is incomplete</h3>
              <p>The question template could not be loaded. Please contact your department office.</p>
            </div>
          ) : (
            <div className="student-workspace-list">
              <div className="student-workspace-row">
                <div>
                  <strong>{selectedCampaign.title}</strong>
                  <p>
                    {selectedCampaign.studentContext.branch} • {selectedCampaign.studentContext.batch} • {selectedCampaign.studentContext.academicYear
                      ? formatStatus(selectedCampaign.studentContext.academicYear)
                      : "Year not mapped"}
                  </p>
                  <p className="muted-text">{selectedCampaign.description || "Please complete all ratings and add comments where needed."}</p>
                </div>
              </div>

              {formState.map((item, itemIndex) => (
                <Card key={`${item.subjectLabel}-${itemIndex}`} className="feedback-inline-card">
                  <div className="tpo-queue-card-head">
                    <div>
                      <h3>{item.subjectLabel}</h3>
                      <p className="muted-text">Rate each item from 1 to 5.</p>
                    </div>
                  </div>

                  <div className="student-profile-field-grid">
                    {selectedCampaign.template!.questions.map((question) => (
                      <label key={question.key}>
                        {question.label}
                        <select
                          value={item.ratings[question.key] || 0}
                          onChange={(event) => {
                            const nextValue = Number(event.target.value);
                            setFormState((current) => current.map((entry, entryIndex) => (
                              entryIndex === itemIndex
                                ? {
                                  ...entry,
                                  ratings: {
                                    ...entry.ratings,
                                    [question.key]: nextValue,
                                  },
                                }
                                : entry
                            )));
                          }}
                        >
                          <option value={0}>Select</option>
                          <option value={1}>1</option>
                          <option value={2}>2</option>
                          <option value={3}>3</option>
                          <option value={4}>4</option>
                          <option value={5}>5</option>
                        </select>
                      </label>
                    ))}
                    <label className="tpo-communication-full">
                      Comment
                      <textarea
                        rows={4}
                        value={item.comment}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setFormState((current) => current.map((entry, entryIndex) => (
                            entryIndex === itemIndex
                              ? { ...entry, comment: nextValue }
                              : entry
                          )));
                        }}
                        placeholder={selectedCampaign.template!.commentPrompt}
                      />
                    </label>
                  </div>
                </Card>
              ))}

              <div className="feedback-toolbar">
                <Button disabled={!canSubmit || busy} onClick={() => void submit()}>
                  {busy ? "Submitting..." : "Submit feedback"}
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {activeTab === "submitted" ? (
        <Card className="feedback-tab-panel">
          <div className="tpo-queue-card-head">
            <div>
              <h2>Submitted feedback</h2>
              <p className="muted-text">Your completed forms stay here for confirmation.</p>
            </div>
          </div>

          {submittedCampaigns.length === 0 ? (
            <div className="app-state-card">
              <h3>No submitted feedback yet</h3>
              <p className="muted-text">Once you submit a form, it will move here automatically.</p>
            </div>
          ) : (
            <div className="student-workspace-list">
              {submittedCampaigns.map((campaign) => (
                <div key={campaign.id} className="student-workspace-row">
                  <div>
                    <strong>{campaign.title}</strong>
                    <p>{formatStatus(campaign.type)}</p>
                    <p className="muted-text">
                      Submitted on {campaign.submittedAt ? new Date(campaign.submittedAt).toLocaleString() : "unknown date"}
                    </p>
                  </div>
                  <span className="ui-badge success">Submitted</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}
    </section>
  );
}
