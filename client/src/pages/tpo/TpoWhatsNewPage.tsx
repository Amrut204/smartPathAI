import { TpoWorkspaceHeader } from "../../components/composites/TpoWorkspaceHeader";
import { useAuth } from "../../components/providers/AuthProvider";
import { Card } from "../../components/ui";
import { getTpoGreeting } from "../../config/tpo-workspace";
import { tpoWhatsNewEntries } from "../../config/tpo-whats-new";

export default function TpoWhatsNewPage() {
  const { profile } = useAuth();

  return (
    <section className="tpo-dashboard control-center-page">
      <TpoWorkspaceHeader
        eyebrow="What's New"
        greeting={getTpoGreeting(profile?.full_name ?? "Placement team")}
        title="Recent product changes for placement operations."
        description="This lightweight changelog keeps new capabilities visible inside the product instead of depending on manual updates."
      />

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
