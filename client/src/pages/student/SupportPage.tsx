import { useState, type FormEvent } from "react";

import { Badge, Button, Card, Spinner } from "../../components/ui";
import {
  createStudentSupportRequest,
  useStudentSupportRequests,
} from "../../hooks/use-support";

function statusVariant(status: "open" | "resolved"): "success" | "warning" {
  return status === "resolved" ? "success" : "warning";
}

export default function SupportPage() {
  const { data, isLoading, error } = useStudentSupportRequests(true);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const requests = data ?? [];

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    setIsSubmitting(true);
    try {
      await createStudentSupportRequest({
        subject: subject.trim(),
        message: message.trim(),
      });
      setSubject("");
      setMessage("");
      setStatus("Your request has been sent to your placement office.");
    } catch (submitError) {
      setStatus(submitError instanceof Error ? submitError.message : "Unable to send support request.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="student-workspace-shell">
      <header className="student-workspace-header">
        <div>
          <h1>Support</h1>
          <p>Send a help request to your placement office and keep track of the response here.</p>
        </div>
      </header>

      <section className="student-workspace-panel">
        <div className="student-workspace-panel-head">
          <div>
            <h2>Request help</h2>
            <p>Share the issue clearly so your TPO can resolve it faster.</p>
          </div>
        </div>

        <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Subject"
            maxLength={160}
            required
          />
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Describe the issue, what you expected, and anything your TPO should know."
            rows={5}
            maxLength={2000}
            required
          />
          {status ? (
            <p className={status.includes("sent") ? "success-text" : "error-text"}>{status}</p>
          ) : null}
          <div className="hero-actions">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Sending..." : "Send Request"}
            </Button>
          </div>
        </form>
      </section>

      <section className="student-workspace-panel">
        <div className="student-workspace-panel-head">
          <div>
            <h2>Your requests</h2>
            <p>You will see the current status of every request you submit.</p>
          </div>
        </div>

        {isLoading ? (
          <Card className="app-state-card">
            <Spinner />
            <p className="muted-text">Loading support requests...</p>
          </Card>
        ) : error ? (
          <Card className="app-state-card app-state-card-error">
            <h2>Unable to load your support requests.</h2>
          </Card>
        ) : requests.length === 0 ? (
          <Card className="app-state-card app-state-card-compact">
            <p className="muted-text">No support requests yet.</p>
          </Card>
        ) : (
          <div className="student-workspace-list">
            {requests.map((request) => (
              <div key={request.id} className="student-workspace-row">
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <strong>{request.subject}</strong>
                    <Badge variant={statusVariant(request.status)}>
                      {request.status === "resolved" ? "Resolved" : "Open"}
                    </Badge>
                  </div>
                  <p>{request.message}</p>
                  <p className="student-workspace-meta">
                    Sent {new Date(request.created_at).toLocaleString()}
                    {request.resolved_at ? ` - Resolved ${new Date(request.resolved_at).toLocaleString()}` : ""}
                  </p>
                  {request.resolution_note ? (
                    <p className="muted-text">TPO note: {request.resolution_note}</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
