import { Link, useParams } from "react-router-dom";
import { useEffect, useState } from "react";

import { Button, Card, Input, Select, Table } from "../../components/ui";
import {
  updateSalesPipeline,
  useSalesPipelineRecord,
  type SalesPipelinePriority,
  type SalesPipelineStage,
} from "../../hooks/use-sales-pipeline";

const STAGES: SalesPipelineStage[] = [
  "contacted",
  "demo_scheduled",
  "demo_completed",
  "pilot_started",
  "pilot_completed",
  "converted",
  "lost",
];

const PRIORITIES: SalesPipelinePriority[] = ["A", "B", "C"];

function formatStageLabel(stage: SalesPipelineStage) {
  return stage.replace(/_/g, " ");
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleDateString();
}

export default function CollegeDetail() {
  const { pipelineId } = useParams();
  const { data, isLoading } = useSalesPipelineRecord(pipelineId);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [details, setDetails] = useState({
    stage: "contacted" as SalesPipelineStage,
    priority: "B" as SalesPipelinePriority,
    nextAction: "",
    nextActionDate: "",
    expectedRevenue: "",
    lostReason: "",
  });
  const [contact, setContact] = useState({
    tpoName: "",
    tpoEmail: "",
    tpoPhone: "",
    tpoLinkedIn: "",
  });

  useEffect(() => {
    if (!data) return;
    setDetails({
      stage: data.stage,
      priority: data.priority,
      nextAction: data.nextAction ?? "",
      nextActionDate: data.nextActionDate ? data.nextActionDate.slice(0, 10) : "",
      expectedRevenue: data.expectedRevenue?.toString() ?? "",
      lostReason: data.lostReason ?? "",
    });
    setContact({
      tpoName: data.tpoName,
      tpoEmail: data.tpoEmail ?? "",
      tpoPhone: data.tpoPhone ?? "",
      tpoLinkedIn: data.tpoLinkedIn ?? "",
    });
  }, [data]);

  if (isLoading || !data) {
    return (
      <section className="dashboard-grid">
        <Card><p className="muted-text">Loading college details...</p></Card>
      </section>
    );
  }

  const onUpdateField = async (payload: Record<string, unknown>) => {
    if (!pipelineId) return;
    setBusy(true);
    setStatus(null);
    try {
      await updateSalesPipeline(pipelineId, payload);
      setStatus("Saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update");
    } finally {
      setBusy(false);
    }
  };

  const onAddNote = async () => {
    if (!pipelineId || !note.trim()) return;
    await onUpdateField({ addNote: note.trim() });
    setNote("");
  };

  const onSaveDetails = async () => {
    await onUpdateField({
      stage: details.stage,
      priority: details.priority,
      nextAction: details.nextAction || null,
      nextActionDate: details.nextActionDate ? new Date(details.nextActionDate).toISOString() : null,
      expectedRevenue: details.expectedRevenue ? Number(details.expectedRevenue) : null,
      lostReason: details.lostReason || null,
    });
  };

  const onSaveContact = async () => {
    await onUpdateField({
      tpoName: contact.tpoName,
      tpoEmail: contact.tpoEmail || null,
      tpoPhone: contact.tpoPhone || null,
      tpoLinkedIn: contact.tpoLinkedIn || null,
    });
  };

  return (
    <section className="dashboard-grid">
      <Card className="pipeline-detail-hero">
        <div>
          <h1>{data.collegeName}</h1>
          <p>{data.collegeLocation ?? "Location not set"}</p>
        </div>
        <div className="hero-actions">
          <Link to="/tpo/sales/pipeline">
            <Button variant="secondary">Back to Pipeline</Button>
          </Link>
        </div>
      </Card>

      <Card className="pipeline-detail-card">
        <h2>Pipeline Status</h2>
        <div className="form-grid">
          <label>
            Stage
            <Select
              value={details.stage}
              onChange={(event) => setDetails((prev) => ({ ...prev, stage: event.target.value as SalesPipelineStage }))}
              disabled={busy}
            >
              {STAGES.map((stage) => (
                <option key={stage} value={stage}>{formatStageLabel(stage)}</option>
              ))}
            </Select>
          </label>
          <label>
            Priority
            <Select
              value={details.priority}
              onChange={(event) => setDetails((prev) => ({ ...prev, priority: event.target.value as SalesPipelinePriority }))}
              disabled={busy}
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>{priority}</option>
              ))}
            </Select>
          </label>
          <label>
            Next Action
            <Input
              value={details.nextAction}
              onChange={(event) => setDetails((prev) => ({ ...prev, nextAction: event.target.value }))}
              disabled={busy}
            />
          </label>
          <label>
            Next Action Date
            <Input
              type="date"
              value={details.nextActionDate}
              onChange={(event) => setDetails((prev) => ({ ...prev, nextActionDate: event.target.value }))}
              disabled={busy}
            />
          </label>
          <label>
            Expected Revenue (INR)
            <Input
              value={details.expectedRevenue}
              onChange={(event) => setDetails((prev) => ({ ...prev, expectedRevenue: event.target.value }))}
              disabled={busy}
            />
          </label>
          <label>
            Lost Reason
            <Input
              value={details.lostReason}
              onChange={(event) => setDetails((prev) => ({ ...prev, lostReason: event.target.value }))}
              disabled={busy}
            />
          </label>
          <div className="hero-actions">
            <Button onClick={onSaveDetails} disabled={busy}>Save Status</Button>
          </div>
          {status ? <p>{status}</p> : null}
        </div>
      </Card>

      <Card className="pipeline-detail-card">
        <h2>Contact Details</h2>
        <div className="form-grid">
          <label>
            TPO Name
            <Input
              value={contact.tpoName}
              onChange={(event) => setContact((prev) => ({ ...prev, tpoName: event.target.value }))}
              disabled={busy}
            />
          </label>
          <label>
            TPO Email
            <Input
              value={contact.tpoEmail}
              onChange={(event) => setContact((prev) => ({ ...prev, tpoEmail: event.target.value }))}
              disabled={busy}
            />
          </label>
          <label>
            TPO Phone
            <Input
              value={contact.tpoPhone}
              onChange={(event) => setContact((prev) => ({ ...prev, tpoPhone: event.target.value }))}
              disabled={busy}
            />
          </label>
          <label>
            LinkedIn
            <Input
              value={contact.tpoLinkedIn}
              onChange={(event) => setContact((prev) => ({ ...prev, tpoLinkedIn: event.target.value }))}
              disabled={busy}
            />
          </label>
          <div className="hero-actions">
            <Button onClick={onSaveContact} disabled={busy}>Save Contact</Button>
          </div>
        </div>
      </Card>

      <Card className="pipeline-detail-card">
        <h2>Milestones</h2>
        <div className="tpo-ranking-table-wrap">
          <Table>
            <thead>
              <tr>
                <th>Contacted</th>
                <th>Demo</th>
                <th>Pilot Start</th>
                <th>Conversion</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{formatDate(data.contactDate)}</td>
                <td>{formatDate(data.demoDate)}</td>
                <td>{formatDate(data.pilotStartDate)}</td>
                <td>{formatDate(data.conversionDate)}</td>
              </tr>
            </tbody>
          </Table>
        </div>
      </Card>

      <Card className="pipeline-detail-card">
        <h2>Notes</h2>
        <div className="form-grid">
          <label>
            Add Note
            <textarea
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Log a call summary or next step."
            />
          </label>
          <div className="hero-actions">
            <Button onClick={onAddNote} disabled={busy || !note.trim()}>
              Add Note
            </Button>
          </div>
        </div>
        {data.notes.length > 0 ? (
          <ul className="pipeline-notes">
            {data.notes.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="muted-text">No notes yet.</p>
        )}
      </Card>
    </section>
  );
}
