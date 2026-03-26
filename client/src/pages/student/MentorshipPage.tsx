import { useState } from "react";

import { Badge, Button, Card, Input } from "../../components/ui";
import { requestMentorship, useStudentCareerHub } from "../../hooks/use-career";

export default function MentorshipPage() {
  const { data, error, isLoading, mutate } = useStudentCareerHub();
  const [form, setForm] = useState({
    domain: "Full Stack",
    targetCompany: "Infosys",
    note: "I want guidance on interview preparation and project storytelling.",
  });
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await requestMentorship(form);
      await mutate();
      setStatus("Mentor match created.");
    } catch (submitError) {
      setStatus(submitError instanceof Error ? submitError.message : "Unable to request mentorship");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return <Card>Loading mentorship...</Card>;
  }

  if (error || !data) {
    return <Card>Unable to load mentorship data.</Card>;
  }

  return (
    <section className="career-page">
      <Card className="career-hero-card">
        <h1>Alumni Mentorship</h1>
        <p className="muted-text">Request domain-specific alumni guidance and track your active matches.</p>
      </Card>

      <div className="career-grid">
        <Card>
          <h2>Available Mentor Pool</h2>
          <div className="career-section-stack">
            {data.mentorship.pool.map((mentor) => (
              <div key={`${mentor.name}-${mentor.company}`} className="career-list-row">
                <div>
                  <strong>{mentor.name}</strong>
                  <p className="muted-text">{mentor.company} - {mentor.role}</p>
                </div>
                <Badge>{mentor.domain}</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2>Request a Mentor</h2>
          <div className="form-grid">
            <label>
              Domain
              <Input
                value={form.domain}
                onChange={(event) => setForm((current) => ({ ...current, domain: event.target.value }))}
              />
            </label>
            <label>
              Target Company
              <Input
                value={form.targetCompany}
                onChange={(event) => setForm((current) => ({ ...current, targetCompany: event.target.value }))}
              />
            </label>
            <label>
              Why do you need mentorship?
              <textarea
                rows={5}
                value={form.note}
                onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
              />
            </label>
            <Button onClick={onSubmit} disabled={busy}>
              {busy ? "Matching..." : "Request Match"}
            </Button>
            {status ? <p className="muted-text">{status}</p> : null}
          </div>
        </Card>

        <Card>
          <h2>Your Matches</h2>
          <div className="career-section-stack">
            {data.mentorship.matches.length > 0 ? data.mentorship.matches.map((match) => (
              <div key={match.id} className="career-list-row">
                <div>
                  <strong>{match.mentor_name}</strong>
                  <p className="muted-text">
                    {match.company} - {match.role} | {match.domain}
                  </p>
                  <p className="muted-text">{match.request_note}</p>
                </div>
                <Badge variant="success">{match.status}</Badge>
              </div>
            )) : <p className="muted-text">No active mentor matches yet.</p>}
          </div>
        </Card>
      </div>
    </section>
  );
}
