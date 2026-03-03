import { Link } from "react-router-dom";
import { useMemo, useState } from "react";

import { Button, Card, Input, Select } from "../../components/ui";
import { useCommunicationTemplates, sendCommunication } from "../../hooks/use-communication";
import { useDrives } from "../../hooks/use-drives";

export default function TpoCommunicationComposePage() {
  const { data: templates } = useCommunicationTemplates();
  const { data: drives } = useDrives();

  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [driveId, setDriveId] = useState("");
  const [branch, setBranch] = useState("");
  const [batch, setBatch] = useState("");
  const [minCgpa, setMinCgpa] = useState("");
  const [eligibleOnly, setEligibleOnly] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedTemplate = useMemo(
    () => (templates ?? []).find((template) => template.id === templateId) ?? null,
    [templateId, templates],
  );

  const effectiveSubject = selectedTemplate?.subject ?? subject;
  const effectiveBody = selectedTemplate?.body ?? body;

  const onSend = async () => {
    if (!effectiveSubject || !effectiveBody) {
      setStatus("Template or custom subject/body is required.");
      return;
    }

    setBusy(true);
    setStatus(null);

    try {
      const result = await sendCommunication({
        templateId: templateId || undefined,
        subject: templateId ? undefined : subject,
        body: templateId ? undefined : body,
        variables: customMessage ? { message: customMessage } : undefined,
        filters: {
          driveId: driveId || undefined,
          eligibleOnly,
          branch: branch || undefined,
          batch: batch || undefined,
          minCgpa: minCgpa ? Number(minCgpa) : undefined,
        },
      });

      setStatus(`Queued communication ${result.communicationId} for ${result.recipientCount} recipients.`);
    } catch (sendError) {
      setStatus(sendError instanceof Error ? sendError.message : "Unable to send communication");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dashboard-grid">
      <Card>
        <h1>Compose Communication</h1>
        <p>Send bulk communication to filtered students.</p>
        <div className="hero-actions">
          <Link to="/tpo/communication">Back to History</Link>
        </div>
      </Card>

      <Card>
        <h2>Template & Message</h2>
        <div className="form-grid">
          <label>
            Template
            <Select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              <option value="">Custom Message</option>
              {(templates ?? []).map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </Select>
          </label>

          {!templateId ? (
            <>
              <label>
                Subject
                <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
              </label>
              <label>
                Body
                <textarea rows={8} value={body} onChange={(event) => setBody(event.target.value)} />
              </label>
            </>
          ) : (
            <div>
              <p>
                <strong>Subject:</strong> {effectiveSubject}
              </p>
              <p>
                <strong>Body Preview:</strong>
              </p>
              <pre>{effectiveBody}</pre>
            </div>
          )}

          <label>
            {"Message Variable ({{message}})"}
            <Input value={customMessage} onChange={(event) => setCustomMessage(event.target.value)} />
          </label>
        </div>
      </Card>

      <Card>
        <h2>Recipient Filters</h2>
        <div className="form-grid">
          <label>
            Drive
            <Select value={driveId} onChange={(event) => setDriveId(event.target.value)}>
              <option value="">All Students (filtered)</option>
              {(drives?.items ?? []).map((drive) => (
                <option key={drive.id} value={drive.id}>
                  {drive.company} {drive.role ? `- ${drive.role}` : ""}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Branch
            <Input value={branch} onChange={(event) => setBranch(event.target.value)} />
          </label>
          <label>
            Batch
            <Input value={batch} onChange={(event) => setBatch(event.target.value)} />
          </label>
          <label>
            Min CGPA
            <Input type="number" min="0" max="10" step="0.1" value={minCgpa} onChange={(event) => setMinCgpa(event.target.value)} />
          </label>
          <label>
            Eligible Only
            <Select value={eligibleOnly ? "yes" : "no"} onChange={(event) => setEligibleOnly(event.target.value === "yes")}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </label>
        </div>

        <div className="hero-actions">
          <Button disabled={busy} onClick={onSend}>
            {busy ? "Queueing..." : "Queue Communication"}
          </Button>
        </div>
        {status ? <p>{status}</p> : null}
      </Card>
    </section>
  );
}
