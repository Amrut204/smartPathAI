import { useMemo, useState } from "react";

import { TpoActionMenu } from "../../components/composites/TpoActionMenu";
import { TpoSubviewSwitcher } from "../../components/composites/TpoSubviewSwitcher";
import { TpoWorkspaceHeader } from "../../components/composites/TpoWorkspaceHeader";
import { useAuth } from "../../components/providers/AuthProvider";
import { Badge, Button, Card, Input, Select, Spinner } from "../../components/ui";
import { getTpoGreeting } from "../../config/tpo-workspace";
import {
  createSupportTicket,
  resolveSupportTicket,
  type SupportTicketCategory,
  type SupportTicketPriority,
  type SupportTicketStatus,
  type SupportTicketType,
  updateSupportTicket,
  useTpoSupportTicket,
  useTpoSupportTickets,
} from "../../hooks/use-support";

type SupportView = "open" | "in_review" | "resolved";

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

function formatLabel(value: string) {
  return value.replace(/_/g, " ");
}

function badgeVariant(status: SupportTicketStatus) {
  if (status === "open") return "warning" as const;
  if (status === "in_review") return "default" as const;
  if (status === "rejected") return "danger" as const;
  return "success" as const;
}

export default function TpoSupportPage() {
  const { profile } = useAuth();
  const greeting = getTpoGreeting(profile?.full_name ?? "Placement team");
  const [activeView, setActiveView] = useState<SupportView>("open");
  const [search, setSearch] = useState("");
  const [submitterRole, setSubmitterRole] = useState<"" | "student" | "tpo">("");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [ticketType, setTicketType] = useState<SupportTicketType>("feedback");
  const [category, setCategory] = useState<SupportTicketCategory>("general_feedback");
  const [priority, setPriority] = useState<SupportTicketPriority>("medium");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const statusFilter: SupportTicketStatus | undefined = useMemo(() => {
    if (activeView === "open") return "open";
    if (activeView === "in_review") return "in_review";
    return undefined;
  }, [activeView]);

  const ticketsQuery = useTpoSupportTickets({
    status: activeView === "resolved" ? undefined : statusFilter,
    submitterRole: submitterRole || undefined,
    q: search || undefined,
  });

  const visibleTickets = useMemo(() => {
    const items = ticketsQuery.data?.items ?? [];
    if (activeView === "resolved") {
      return items.filter((item) => ["resolved", "closed", "rejected"].includes(item.status));
    }
    return items;
  }, [activeView, ticketsQuery.data?.items]);

  const selectedTicket = useTpoSupportTicket(selectedTicketId);
  const selectedTicketDetail = selectedTicket.data ?? null;

  const createInternalTicket = async () => {
    setBusy(true);
    setStatusMessage(null);
    try {
      await createSupportTicket({
        ticketType,
        category,
        title,
        description,
        priority,
        destinationRole: "tpo",
        confidential: category === "harassment_or_misconduct",
      });
      setTitle("");
      setDescription("");
      setStatusMessage("Internal support ticket submitted.");
    } catch (submitError) {
      setStatusMessage(submitError instanceof Error ? submitError.message : "Unable to submit ticket right now.");
    } finally {
      setBusy(false);
    }
  };

  const assignToMe = async () => {
    if (!selectedTicketId || !profile?.id) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      await updateSupportTicket("tpo", selectedTicketId, {
        assignedToUserId: profile.id,
        status: "in_review",
      });
      setStatusMessage("Ticket assigned to you and moved to in review.");
    } catch (updateError) {
      setStatusMessage(updateError instanceof Error ? updateError.message : "Unable to assign ticket right now.");
    } finally {
      setBusy(false);
    }
  };

  const markResolved = async (status: "resolved" | "closed" | "rejected") => {
    if (!selectedTicketId || resolutionNote.trim().length < 2) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      await resolveSupportTicket("tpo", selectedTicketId, {
        resolutionNote,
        status,
      });
      setResolutionNote("");
      setStatusMessage(`Ticket marked as ${formatLabel(status)}.`);
    } catch (resolveError) {
      setStatusMessage(resolveError instanceof Error ? resolveError.message : "Unable to update ticket right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tpo-dashboard control-center-page">
      <TpoWorkspaceHeader
        eyebrow="Grievance & Feedback"
        greeting={greeting}
        title="Review support tickets in one queue-first workspace."
        description="Students and TPO staff can raise structured tickets here. Review the queue, resolve blockers, and keep updates visible."
        primaryAction={(
          <Button onClick={() => setSelectedTicketId(null)}>Raise internal ticket</Button>
        )}
        actionMenu={(
          <TpoActionMenu
            items={[
              { label: "Open tickets", onSelect: () => setActiveView("open") },
              { label: "In review", onSelect: () => setActiveView("in_review") },
              { label: "Resolved history", onSelect: () => setActiveView("resolved") },
            ]}
          />
        )}
      />

      <TpoSubviewSwitcher
        label="Support ticket views"
        items={[
          { id: "open", label: `Open (${ticketsQuery.data?.counts.open ?? 0})` },
          { id: "in_review", label: `In review (${ticketsQuery.data?.counts.inReview ?? 0})` },
          { id: "resolved", label: `Resolved (${ticketsQuery.data?.counts.resolved ?? 0})` },
        ]}
        activeId={activeView}
        onChange={(next) => setActiveView(next as SupportView)}
      />

      <Card className="tpo-single-pane-card">
        <div className="tpo-inline-section-head">
          <div>
            <p className="workspace-eyebrow">Queue</p>
            <h2>Support review queue</h2>
            <p className="muted-text">Filter by submitter, focus on one ticket, then resolve it with a clear note.</p>
          </div>
        </div>

        <div className="student-profile-field-grid">
          <label>
            Search
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Title, description, name, email" />
          </label>
          <label>
            Submitter role
            <Select value={submitterRole} onChange={(event) => setSubmitterRole(event.target.value as "" | "student" | "tpo")}>
              <option value="">All roles</option>
              <option value="student">Student</option>
              <option value="tpo">TPO</option>
            </Select>
          </label>
        </div>

        <div className="tpo-inline-section">
          {ticketsQuery.isLoading ? (
            <div className="app-state-card">
              <Spinner />
              <p className="muted-text">Loading support queue...</p>
            </div>
          ) : ticketsQuery.error ? (
            <Card className="app-state-card app-state-card-error">
              <h3>Unable to load support tickets</h3>
              <p>{ticketsQuery.error instanceof Error ? ticketsQuery.error.message : "Unknown error"}</p>
            </Card>
          ) : visibleTickets.length === 0 ? (
            <p className="muted-text">No tickets matched this queue.</p>
          ) : (
            <div className="student-workspace-list">
              {visibleTickets.map((ticket) => (
                <button
                  key={ticket.id}
                  type="button"
                  className={`student-workspace-row ${selectedTicketId === ticket.id ? "is-active" : ""}`.trim()}
                  onClick={() => setSelectedTicketId(ticket.id)}
                  style={{ textAlign: "left" }}
                >
                  <div>
                    <strong>{ticket.title}</strong>
                    <p>{formatLabel(ticket.ticketType)} • {formatLabel(ticket.category)} • {ticket.createdBy.fullName}</p>
                    <p className="muted-text">{ticket.description.slice(0, 180)}{ticket.description.length > 180 ? "..." : ""}</p>
                    <p className="muted-text">{ticket.assignedTo ? `Assigned to ${ticket.assignedTo.fullName}` : "Unassigned"} • Updated {new Date(ticket.updatedAt).toLocaleString()}</p>
                  </div>
                  <div className="student-announcement-row-meta">
                    <Badge variant={badgeVariant(ticket.status)}>{formatLabel(ticket.status)}</Badge>
                    <Badge variant="default">{ticket.priority}</Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card className="tpo-single-pane-card">
        {!selectedTicketId ? (
          <>
            <div className="tpo-inline-section-head">
              <div>
                <p className="workspace-eyebrow">Raise ticket</p>
                <h2>Internal grievance or feedback</h2>
                <p className="muted-text">Use this for TPO-side process issues or internal feedback that still belongs in the same compliance workflow.</p>
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
                <Select value={category} onChange={(event) => setCategory(event.target.value as SupportTicketCategory)}>
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
              <label className="tpo-communication-full">
                Title
                <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Internal support summary" />
              </label>
              <label className="tpo-communication-full">
                Description
                <textarea rows={6} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the issue, blocker, or feedback clearly." />
              </label>
            </div>
            <div className="hero-actions">
              <Button onClick={() => void createInternalTicket()} disabled={busy || title.trim().length < 4 || description.trim().length < 10}>
                {busy ? "Submitting..." : "Submit internal ticket"}
              </Button>
            </div>
          </>
        ) : selectedTicket.isLoading ? (
          <div className="app-state-card">
            <Spinner />
            <p className="muted-text">Loading ticket detail...</p>
          </div>
        ) : selectedTicket.error || !selectedTicketDetail ? (
          <Card className="app-state-card app-state-card-error">
            <h3>Unable to load ticket detail</h3>
            <p>{selectedTicket.error instanceof Error ? selectedTicket.error.message : "Unknown error"}</p>
          </Card>
        ) : (
          <>
            <div className="tpo-inline-section-head">
              <div>
                <p className="workspace-eyebrow">Selected ticket</p>
                <h2>{selectedTicketDetail.title}</h2>
                <p className="muted-text">{selectedTicketDetail.createdBy.fullName} - {selectedTicketDetail.createdBy.email}</p>
              </div>
              <TpoActionMenu
                items={[
                  { label: "Assign to me", onSelect: () => void assignToMe() },
                  { label: "Move to in review", onSelect: () => void updateSupportTicket("tpo", selectedTicketDetail.id, { status: "in_review" }) },
                  { label: "Reopen", onSelect: () => void updateSupportTicket("tpo", selectedTicketDetail.id, { status: "open" }) },
                ]}
              />
            </div>
            <div className="student-workspace-inline-note">
              <span>Status: {formatLabel(selectedTicketDetail.status)}</span>
              <span>Priority: {selectedTicketDetail.priority}</span>
              <span>{selectedTicketDetail.assignedTo ? `Assigned to ${selectedTicketDetail.assignedTo.fullName}` : "Unassigned"}</span>
            </div>
            <p>{selectedTicketDetail.description}</p>
            {selectedTicketDetail.resolutionNote ? <p><strong>Latest resolution note:</strong> {selectedTicketDetail.resolutionNote}</p> : null}

            <div className="student-profile-field-grid">
              <label className="tpo-communication-full">
                Resolution note
                <textarea
                  rows={5}
                  value={resolutionNote}
                  onChange={(event) => setResolutionNote(event.target.value)}
                  placeholder="Explain what was checked, what changed, and what the submitter should do next."
                />
              </label>
            </div>
            <div className="hero-actions">
              <Button onClick={() => void markResolved("resolved")} disabled={busy || resolutionNote.trim().length < 2}>
                Mark resolved
              </Button>
              <Button variant="secondary" onClick={() => void markResolved("closed")} disabled={busy || resolutionNote.trim().length < 2}>
                Close
              </Button>
              <Button variant="ghost" onClick={() => void markResolved("rejected")} disabled={busy || resolutionNote.trim().length < 2}>
                Reject
              </Button>
            </div>

            <div className="tpo-inline-section">
              <div className="tpo-inline-section-head">
                <div>
                  <h3>Ticket history</h3>
                  <p className="muted-text">Every change on this ticket stays visible for operational clarity.</p>
                </div>
              </div>
              <div className="student-workspace-list">
                {selectedTicketDetail.events.map((event) => (
                  <div key={event.id} className="student-workspace-row">
                    <div>
                      <strong>{formatLabel(event.eventType)}</strong>
                      <p>{event.actorRole} - {new Date(event.createdAt).toLocaleString()}</p>
                      {event.note ? <p className="muted-text">{event.note}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        {statusMessage ? <p className="muted-text">{statusMessage}</p> : null}
      </Card>
    </section>
  );
}

