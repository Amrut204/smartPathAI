import { useState } from "react";

import { Button, Card, Input, Select, Spinner } from "../../components/ui";
import {
  createSupportTicket,
  type SupportTicketCategory,
  type SupportTicketDestinationRole,
  type SupportTicketPriority,
  type SupportTicketType,
  useMySupportTickets,
} from "../../hooks/use-support";

const ticketTypeOptions: Array<{ value: SupportTicketType; label: string }> = [
  { value: "grievance", label: "Grievance" },
  { value: "suggestion", label: "Suggestion" },
  { value: "feedback", label: "Feedback" },
];

const categoryOptions: Array<{ value: SupportTicketCategory; label: string }> = [
  { value: "placement_process", label: "Placement process" },
  { value: "drive_eligibility", label: "Drive eligibility" },
  { value: "profile_or_resume", label: "Profile or resume" },
  { value: "mock_tests", label: "Mock tests" },
  { value: "resources", label: "Resources" },
  { value: "technical_issue", label: "Technical issue" },
  { value: "harassment_or_misconduct", label: "Harassment or misconduct" },
  { value: "general_feedback", label: "General feedback" },
];

const priorityOptions: Array<{ value: SupportTicketPriority; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const destinationOptions: Array<{ value: SupportTicketDestinationRole; label: string }> = [
  { value: "tpo", label: "Send to TPO" },
  { value: "hod", label: "Send to HOD" },
];

function suggestedDestination(category: SupportTicketCategory): SupportTicketDestinationRole {
  if (["placement_process", "drive_eligibility", "profile_or_resume", "mock_tests"].includes(category)) {
    return "tpo";
  }
  return "hod";
}

function formatStatus(value: string) {
  return value.replace(/_/g, " ");
}

export default function SupportPage() {
  const { data, error, isLoading } = useMySupportTickets();
  const [ticketType, setTicketType] = useState<SupportTicketType>("grievance");
  const [category, setCategory] = useState<SupportTicketCategory>("technical_issue");
  const [priority, setPriority] = useState<SupportTicketPriority>("medium");
  const [destinationRole, setDestinationRole] = useState<SupportTicketDestinationRole>(suggestedDestination("technical_issue"));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const submitTicket = async () => {
    setBusy(true);
    setStatusMessage(null);
    try {
      await createSupportTicket({
        ticketType,
        category,
        title,
        description,
        priority,
        destinationRole,
        confidential: category === "harassment_or_misconduct",
      });
      setTitle("");
      setDescription("");
      setPriority("medium");
      setStatusMessage(`Your ticket has been submitted to the ${destinationRole === "tpo" ? "placement office" : "department office"}.`);
    } catch (submitError) {
      setStatusMessage(submitError instanceof Error ? submitError.message : "Unable to submit your ticket right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="student-workspace-shell">
      <header className="student-workspace-header">
        <div>
          <p className="resources-kicker">Support / Feedback</p>
          <h1>Raise a ticket and send it to the right college owner.</h1>
          <p>Placement-related grievances should go to the TPO. Department-level or non-placement grievances can go to your HOD.</p>
        </div>
      </header>

      <section className="student-workspace-panel">
        <div className="student-workspace-panel-head">
          <div>
            <h2>Raise ticket</h2>
            <p>Named submissions only. Your profile is already known, so you only explain the issue and choose the right owner.</p>
          </div>
        </div>
        <div className="student-profile-field-grid">
          <label>
            Ticket type
            <Select value={ticketType} onChange={(event) => setTicketType(event.target.value as SupportTicketType)}>
              {ticketTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </label>
          <label>
            Category
            <Select
              value={category}
              onChange={(event) => {
                const nextCategory = event.target.value as SupportTicketCategory;
                setCategory(nextCategory);
                setDestinationRole(suggestedDestination(nextCategory));
              }}
            >
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </label>
          <label>
            Priority
            <Select value={priority} onChange={(event) => setPriority(event.target.value as SupportTicketPriority)}>
              {priorityOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </label>
          <label>
            Send to
            <Select value={destinationRole} onChange={(event) => setDestinationRole(event.target.value as SupportTicketDestinationRole)}>
              {destinationOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </label>
          <label className="tpo-communication-full">
            Title
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Brief summary of the issue" />
          </label>
          <label className="tpo-communication-full">
            Description
            <textarea
              rows={6}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Explain what happened, what is blocked, and any important dates or drive details."
            />
          </label>
          <div className="tpo-communication-full student-workspace-inline-note">
            <span>Suggested owner for this category: {suggestedDestination(category).toUpperCase()}.</span>
            <span>Use `TPO` for placement-specific issues and `HOD` for department-level grievances.</span>
          </div>
        </div>
        <div className="hero-actions">
          <Button
            onClick={() => void submitTicket()}
            disabled={busy || title.trim().length < 4 || description.trim().length < 10}
          >
            {busy ? "Submitting..." : "Submit ticket"}
          </Button>
        </div>
        {statusMessage ? <p className="muted-text">{statusMessage}</p> : null}
      </section>

      <section className="student-workspace-panel">
        <div className="student-workspace-panel-head">
          <div>
            <h2>My tickets</h2>
            <p>Track your submissions without sending repeated follow-up messages.</p>
          </div>
        </div>

        {isLoading ? (
          <div className="app-state-card">
            <Spinner />
            <p className="muted-text">Loading your tickets...</p>
          </div>
        ) : error ? (
          <Card className="app-state-card app-state-card-error">
            <h3>Unable to load support tickets</h3>
            <p>{error instanceof Error ? error.message : "Unknown error"}</p>
          </Card>
        ) : !data || data.length === 0 ? (
          <p className="muted-text">No tickets yet. The first one you submit will appear here.</p>
        ) : (
          <div className="student-workspace-list">
            {data.map((ticket) => (
              <div key={ticket.id} className="student-workspace-row">
                <div>
                  <strong>{ticket.title}</strong>
                  <p>
                    {ticket.ticketType} • {formatStatus(ticket.category)} • {formatStatus(ticket.status)} • Sent to {ticket.destinationRole.toUpperCase()}
                  </p>
                  <p className="muted-text">{ticket.description}</p>
                  {ticket.resolutionNote ? <p><strong>Latest update:</strong> {ticket.resolutionNote}</p> : null}
                </div>
                <div className="student-announcement-row-meta">
                  <span className="ui-badge">{ticket.priority}</span>
                  <span className="muted-text">{new Date(ticket.updatedAt).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
