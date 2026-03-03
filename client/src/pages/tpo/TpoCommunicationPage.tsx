import { Link } from "react-router-dom";
import { useState } from "react";

import { Button, Card, Input, Table } from "../../components/ui";
import {
  createCommunicationTemplate,
  useCommunicationHistory,
  useCommunicationTemplates,
} from "../../hooks/use-communication";

export default function TpoCommunicationPage() {
  const { data: history, isLoading: historyLoading } = useCommunicationHistory();
  const { data: templates, isLoading: templatesLoading } = useCommunicationTemplates();
  const historyItems = history?.items ?? [];

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onCreateTemplate = async () => {
    if (!name || !slug || !subject || !body) {
      setStatus("All template fields are required.");
      return;
    }

    setBusy(true);
    setStatus(null);

    try {
      await createCommunicationTemplate({ name, slug, subject, body });
      setName("");
      setSlug("");
      setSubject("");
      setBody("");
      setStatus("Template created.");
    } catch (createError) {
      setStatus(createError instanceof Error ? createError.message : "Unable to create template");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dashboard-grid">
      <Card>
        <h1>Communication Center</h1>
        <p>Review sent messages and manage reusable email templates.</p>
        <div className="hero-actions">
          <Link to="/tpo/communication/compose">
            <Button>Compose Message</Button>
          </Link>
        </div>
      </Card>

      <Card>
        <h2>Message History</h2>
        {historyLoading ? (
          <p>Loading history...</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Status</th>
                <th>Recipients</th>
                <th>Provider</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {historyItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.subject}</td>
                  <td>{item.status}</td>
                  <td>{item.recipientCount}</td>
                  <td>{item.provider ?? "-"}</td>
                  <td>{item.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <h2>Email Templates</h2>
        {templatesLoading ? (
          <p>Loading templates...</p>
        ) : (
          <ul>
            {(templates ?? []).map((template) => (
              <li key={template.id}>
                <strong>{template.name}</strong> ({template.slug}) {template.isSystem ? "[system]" : ""}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2>Create Template</h2>
        <div className="form-grid">
          <label>
            Name
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Slug
            <Input value={slug} onChange={(event) => setSlug(event.target.value)} />
          </label>
          <label>
            Subject
            <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
          </label>
          <label>
            Body
            <textarea rows={6} value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
          <div className="hero-actions">
            <Button disabled={busy} onClick={onCreateTemplate}>
              {busy ? "Creating..." : "Create Template"}
            </Button>
          </div>
          {status ? <p>{status}</p> : null}
        </div>
      </Card>
    </section>
  );
}
