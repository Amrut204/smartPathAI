import { Card } from "../../components/ui";
import { tpoWhatsNewEntries } from "../../config/tpo-whats-new";

export default function TpoWhatsNewPage() {
  return (
    <section className="tpo-dashboard control-center-page">
      <Card className="career-hero-card control-center-hero-card">
        <div className="tpo-ops-hero-copy">
          <p className="workspace-eyebrow">What&apos;s New</p>
          <h1>Recent product changes for placement operations.</h1>
          <p className="muted-text">
            This is a lightweight changelog for TPOs so new capabilities are visible inside the product instead of depending on manual updates.
          </p>
        </div>
      </Card>

      <div className="tpo-whats-new-grid">
        {tpoWhatsNewEntries.map((entry) => (
          <Card key={entry.id} className="tpo-whats-new-card">
            <div className="tpo-whats-new-head">
              <span className="workspace-eyebrow">{entry.workflow}</span>
              <strong>{new Date(entry.date).toLocaleDateString()}</strong>
            </div>
            <h2>{entry.title}</h2>
            <p>{entry.summary}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
