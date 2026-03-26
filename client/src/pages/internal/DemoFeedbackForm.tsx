import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Button, Card, Input, Select, Table } from "../../components/ui";
import {
  createDemoFeedback,
  useDemoFeedbackList,
  type DemoFeedbackStatus,
} from "../../hooks/use-demo-feedback";

const STATUS_OPTIONS: DemoFeedbackStatus[] = [
  "demo_completed",
  "follow_up_scheduled",
  "pilot_started",
  "converted",
  "lost",
];

function parseListField(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatStatusLabel(value: DemoFeedbackStatus) {
  return value.replace(/_/g, " ");
}

export default function DemoFeedbackForm() {
  const { data, isLoading } = useDemoFeedbackList();
  const recentItems = data?.items ?? [];

  const [collegeName, setCollegeName] = useState("");
  const [tpoName, setTpoName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [demoDate, setDemoDate] = useState(new Date().toISOString().slice(0, 16));
  const [demoRating, setDemoRating] = useState("");
  const [productFit, setProductFit] = useState("");
  const [conversionLikelihood, setConversionLikelihood] = useState("");
  const [painPoints, setPainPoints] = useState("");
  const [featureRequests, setFeatureRequests] = useState("");
  const [concerns, setConcerns] = useState("");
  const [competitorMentions, setCompetitorMentions] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [status, setStatus] = useState<DemoFeedbackStatus>("demo_completed");
  const [notes, setNotes] = useState("");
  const [submissionStatus, setSubmissionStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const recentSummary = useMemo(() => recentItems.slice(0, 8), [recentItems]);

  const onSubmit = async () => {
    if (!collegeName.trim() || !tpoName.trim()) {
      setSubmissionStatus("College name and TPO name are required.");
      return;
    }

    setBusy(true);
    setSubmissionStatus(null);

    try {
      await createDemoFeedback({
        collegeName,
        tpoName,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
        demoDate: demoDate ? new Date(demoDate).toISOString() : null,
        demoRating: demoRating ? Number(demoRating) : null,
        productFit: productFit ? Number(productFit) : null,
        conversionLikelihood: conversionLikelihood ? Number(conversionLikelihood) : null,
        painPoints: parseListField(painPoints),
        featureRequests: parseListField(featureRequests),
        concerns: parseListField(concerns),
        competitorMentions: parseListField(competitorMentions),
        nextSteps: nextSteps || null,
        followUpDate: followUpDate ? new Date(followUpDate).toISOString() : null,
        status,
        notes: notes || null,
      });

      setCollegeName("");
      setTpoName("");
      setContactEmail("");
      setContactPhone("");
      setDemoDate(new Date().toISOString().slice(0, 16));
      setDemoRating("");
      setProductFit("");
      setConversionLikelihood("");
      setPainPoints("");
      setFeatureRequests("");
      setConcerns("");
      setCompetitorMentions("");
      setNextSteps("");
      setFollowUpDate("");
      setStatus("demo_completed");
      setNotes("");
      setSubmissionStatus("Demo feedback saved.");
    } catch (error) {
      setSubmissionStatus(error instanceof Error ? error.message : "Unable to save demo feedback");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dashboard-grid">
      <Card className="tpo-form-card">
        <div className="hero-actions" style={{ justifyContent: "space-between" }}>
          <div>
            <h1>Demo Feedback</h1>
            <p>Capture sales learning immediately after every TPO call.</p>
          </div>
          <Link to="/tpo/internal/demo-analytics">
            <Button variant="secondary">View Analytics</Button>
          </Link>
        </div>

        <div className="form-grid">
          <label>
            College Name
            <Input value={collegeName} onChange={(event) => setCollegeName(event.target.value)} />
          </label>
          <label>
            TPO Name
            <Input value={tpoName} onChange={(event) => setTpoName(event.target.value)} />
          </label>
          <label>
            Contact Email
            <Input value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} />
          </label>
          <label>
            Contact Phone
            <Input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} />
          </label>
          <label>
            Demo Date
            <Input type="datetime-local" value={demoDate} onChange={(event) => setDemoDate(event.target.value)} />
          </label>
          <label>
            Follow-up Date
            <Input type="datetime-local" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />
          </label>
          <label>
            Demo Rating (1-10)
            <Input type="number" min="1" max="10" value={demoRating} onChange={(event) => setDemoRating(event.target.value)} />
          </label>
          <label>
            Product Fit (1-10)
            <Input type="number" min="1" max="10" value={productFit} onChange={(event) => setProductFit(event.target.value)} />
          </label>
          <label>
            Conversion Likelihood (1-10)
            <Input type="number" min="1" max="10" value={conversionLikelihood} onChange={(event) => setConversionLikelihood(event.target.value)} />
          </label>
          <label>
            Status
            <Select value={status} onChange={(event) => setStatus(event.target.value as DemoFeedbackStatus)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>{formatStatusLabel(option)}</option>
              ))}
            </Select>
          </label>
          <label>
            Pain Points
            <textarea rows={4} value={painPoints} onChange={(event) => setPainPoints(event.target.value)} placeholder="One per line or comma-separated" />
          </label>
          <label>
            Feature Requests
            <textarea rows={4} value={featureRequests} onChange={(event) => setFeatureRequests(event.target.value)} placeholder="One per line or comma-separated" />
          </label>
          <label>
            Concerns
            <textarea rows={4} value={concerns} onChange={(event) => setConcerns(event.target.value)} placeholder="One per line or comma-separated" />
          </label>
          <label>
            Competitor Mentions
            <textarea rows={4} value={competitorMentions} onChange={(event) => setCompetitorMentions(event.target.value)} placeholder="Excel, ERP, internal portal..." />
          </label>
          <label>
            Next Steps
            <textarea rows={4} value={nextSteps} onChange={(event) => setNextSteps(event.target.value)} />
          </label>
          <label>
            Notes
            <textarea rows={6} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <div className="hero-actions">
            <Button onClick={onSubmit} disabled={busy}>
              {busy ? "Saving..." : "Save Feedback"}
            </Button>
          </div>
          {submissionStatus ? <p>{submissionStatus}</p> : null}
        </div>
      </Card>

      <Card className="tpo-table-card">
        <h2>Recent Demo Calls</h2>
        {isLoading ? (
          <p className="muted-text">Loading feedback history...</p>
        ) : (
          <div className="tpo-ranking-table-wrap">
            <Table>
              <thead>
                <tr>
                  <th>College</th>
                  <th>TPO</th>
                  <th>Status</th>
                  <th>Rating</th>
                  <th>Product Fit</th>
                  <th>Follow-up</th>
                </tr>
              </thead>
              <tbody>
                {recentSummary.map((item) => (
                  <tr key={item.id}>
                    <td>{item.collegeName}</td>
                    <td>{item.tpoName}</td>
                    <td>{formatStatusLabel(item.status)}</td>
                    <td>{item.demoRating ?? "-"}</td>
                    <td>{item.productFit ?? "-"}</td>
                    <td>{item.followUpDate ? new Date(item.followUpDate).toLocaleDateString() : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </section>
  );
}
