import { Link } from "react-router-dom";
import { useMemo, useState } from "react";

import { Button, Card, Input, Select } from "../../components/ui";
import {
  createSalesPipeline,
  updateSalesPipeline,
  useSalesPipelineList,
  type SalesPipelineEntry,
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

const PRIORITY_LABELS: Record<SalesPipelinePriority, string> = {
  A: "A - High",
  B: "B - Medium",
  C: "C - Low",
};

function formatStageLabel(stage: SalesPipelineStage) {
  return stage.replace(/_/g, " ");
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleDateString();
}

function groupByStage(items: SalesPipelineEntry[]) {
  const map = new Map<SalesPipelineStage, SalesPipelineEntry[]>();
  STAGES.forEach((stage) => map.set(stage, []));
  items.forEach((item) => {
    const bucket = map.get(item.stage);
    if (bucket) bucket.push(item);
  });
  return map;
}

export default function PipelineDashboard() {
  const { data, isLoading } = useSalesPipelineList();
  const items = data?.items ?? [];
  const grouped = useMemo(() => groupByStage(items), [items]);

  const [collegeName, setCollegeName] = useState("");
  const [tpoName, setTpoName] = useState("");
  const [tpoEmail, setTpoEmail] = useState("");
  const [priority, setPriority] = useState<SalesPipelinePriority>("B");
  const [expectedRevenue, setExpectedRevenue] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [draggingId, setDraggingId] = useState<string | null>(null);

  const scheduleFollowUp = async (item: SalesPipelineEntry) => {
    const nextActionDate = item.nextActionDate ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    try {
      await updateSalesPipeline(item.id, {
        nextAction: item.nextAction ?? "Follow-up call",
        nextActionDate,
      });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to schedule follow-up");
    }
  };

  const addQuickNote = async (item: SalesPipelineEntry) => {
    try {
      await updateSalesPipeline(item.id, { addNote: "Follow-up scheduled." });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to add note");
    }
  };

  const handleAdd = async () => {
    if (!collegeName.trim() || !tpoName.trim()) {
      setStatusMessage("College name and TPO name are required.");
      return;
    }

    setBusy(true);
    setStatusMessage(null);

    try {
      await createSalesPipeline({
        collegeName,
        tpoName,
        tpoEmail: tpoEmail || null,
        priority,
        expectedRevenue: expectedRevenue ? Number(expectedRevenue) : null,
      });
      setCollegeName("");
      setTpoName("");
      setTpoEmail("");
      setPriority("B");
      setExpectedRevenue("");
      setStatusMessage("College added to pipeline.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to add college");
    } finally {
      setBusy(false);
    }
  };

  const onDragStart = (id: string) => {
    setDraggingId(id);
  };

  const onDrop = async (stage: SalesPipelineStage) => {
    if (!draggingId) return;

    try {
      await updateSalesPipeline(draggingId, { stage });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to move stage");
    } finally {
      setDraggingId(null);
    }
  };

  return (
    <section className="pipeline-dashboard">
      <Card className="pipeline-hero">
        <div>
          <h1>Sales Pipeline</h1>
          <p>Track every college from first outreach to conversion.</p>
        </div>
        <div className="hero-actions">
          <Link to="/tpo/sales/analytics">
            <Button variant="secondary">View Analytics</Button>
          </Link>
        </div>
      </Card>

      <Card className="tpo-form-card">
        <h2>Add College</h2>
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
            TPO Email
            <Input value={tpoEmail} onChange={(event) => setTpoEmail(event.target.value)} />
          </label>
          <label>
            Priority
            <Select value={priority} onChange={(event) => setPriority(event.target.value as SalesPipelinePriority)}>
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </label>
          <label>
            Expected Revenue (INR)
            <Input value={expectedRevenue} onChange={(event) => setExpectedRevenue(event.target.value)} />
          </label>
          <div className="hero-actions">
            <Button onClick={handleAdd} disabled={busy}>
              {busy ? "Adding..." : "Add to Pipeline"}
            </Button>
          </div>
          {statusMessage ? <p>{statusMessage}</p> : null}
        </div>
      </Card>

      <div className="pipeline-board">
        {STAGES.map((stage) => {
          const stageItems = grouped.get(stage) ?? [];
          return (
            <div
              key={stage}
              className="pipeline-column"
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => onDrop(stage)}
            >
              <div className="pipeline-column-header">
                <h3>{formatStageLabel(stage)}</h3>
                <span>{stageItems.length}</span>
              </div>
              <div className="pipeline-column-body">
                {isLoading ? (
                  <Card className="app-state-card app-state-card-compact">
                    <p className="muted-text">Loading pipeline...</p>
                  </Card>
                ) : stageItems.length === 0 ? (
                  <p className="muted-text">No colleges in this stage.</p>
                ) : (
                  stageItems.map((item) => (
                    <div
                      key={item.id}
                      className={`pipeline-card priority-${item.priority.toLowerCase()}`.trim()}
                      draggable
                      onDragStart={() => onDragStart(item.id)}
                    >
                      <div className="pipeline-card-header">
                        <strong>{item.collegeName}</strong>
                        <span className={`pipeline-priority priority-${item.priority.toLowerCase()}`.trim()}>
                          {item.priority}
                        </span>
                      </div>
                      <p className="muted-text">{item.tpoName}</p>
                      <div className="pipeline-card-meta">
                        <span>Next: {item.nextAction ?? "Not set"}</span>
                        <span>{formatDate(item.nextActionDate)}</span>
                      </div>
                      <div className="pipeline-card-actions">
                        <Link to={`/tpo/sales/pipeline/${item.id}`}>
                          <Button variant="ghost">Open</Button>
                        </Link>
                        <Button variant="secondary" onClick={() => scheduleFollowUp(item)}>
                          Schedule Follow-up
                        </Button>
                        <Button variant="ghost" onClick={() => addQuickNote(item)}>
                          Add Note
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
