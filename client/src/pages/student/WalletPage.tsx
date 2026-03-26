import { useState } from "react";

import { Badge, Button, Card, Input } from "../../components/ui";
import { addWalletItem, useStudentCareerHub } from "../../hooks/use-career";

export default function WalletPage() {
  const { data, error, isLoading, mutate } = useStudentCareerHub();
  const [form, setForm] = useState({
    title: "",
    issuer: "",
    type: "Certificate",
    achievedAt: new Date().toISOString().slice(0, 10),
    evidenceUrl: "",
  });
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await addWalletItem({
        title: form.title,
        issuer: form.issuer,
        type: form.type,
        achievedAt: form.achievedAt,
        evidenceUrl: form.evidenceUrl || undefined,
      });
      await mutate();
      setForm({
        title: "",
        issuer: "",
        type: "Certificate",
        achievedAt: new Date().toISOString().slice(0, 10),
        evidenceUrl: "",
      });
      setStatus("Wallet item added.");
    } catch (submitError) {
      setStatus(submitError instanceof Error ? submitError.message : "Unable to add wallet item");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return <Card>Loading wallet...</Card>;
  }

  if (error || !data) {
    return <Card>Unable to load wallet.</Card>;
  }

  return (
    <section className="career-page">
      <Card className="career-hero-card">
        <h1>Certificate & Achievement Wallet</h1>
        <p className="muted-text">Store placement-relevant certificates, achievements, and proof links in one place.</p>
      </Card>

      <div className="career-grid">
        <Card>
          <h2>Add Achievement</h2>
          <div className="form-grid">
            <label>
              Title
              <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label>
              Issuer
              <Input value={form.issuer} onChange={(event) => setForm((current) => ({ ...current, issuer: event.target.value }))} />
            </label>
            <label>
              Type
              <Input value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))} />
            </label>
            <label>
              Achieved On
              <Input type="date" value={form.achievedAt} onChange={(event) => setForm((current) => ({ ...current, achievedAt: event.target.value }))} />
            </label>
            <label>
              Evidence URL
              <Input value={form.evidenceUrl} onChange={(event) => setForm((current) => ({ ...current, evidenceUrl: event.target.value }))} />
            </label>
            <Button onClick={onSubmit} disabled={busy}>
              {busy ? "Saving..." : "Add to Wallet"}
            </Button>
            {status ? <p className="muted-text">{status}</p> : null}
          </div>
        </Card>

        <Card>
          <h2>Saved Items</h2>
          <div className="career-section-stack">
            {data.wallet.items.length > 0 ? data.wallet.items.map((item) => (
              <div key={item.id} className="career-list-row">
                <div>
                  <strong>{item.title}</strong>
                  <p className="muted-text">{item.issuer} | {item.achieved_at}</p>
                  {item.evidence_url ? (
                    <a href={item.evidence_url} target="_blank" rel="noreferrer">
                      View proof
                    </a>
                  ) : null}
                </div>
                <Badge>{item.type}</Badge>
              </div>
            )) : <p className="muted-text">No certificates or achievements added yet.</p>}
          </div>
        </Card>
      </div>
    </section>
  );
}
