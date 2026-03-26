import { useEffect, useState } from "react";

import { Badge, Button, Spinner } from "../../components/ui";
import {
  markAnnouncementRead,
  markAnnouncementsSeen,
  useStudentAnnouncements,
} from "../../hooks/use-announcements";

export default function AnnouncementsPage() {
  const { data, error, isLoading } = useStudentAnnouncements();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    void markAnnouncementsSeen().catch(() => null);
  }, []);

  if (isLoading) {
    return (
      <section className="student-workspace-shell">
        <div className="student-workspace-panel app-state-card">
          <Spinner />
          <p className="muted-text">Loading announcements...</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="student-workspace-shell">
        <div className="student-workspace-panel app-state-card app-state-card-error">
          <h2>Unable to load announcements</h2>
          <p>{error instanceof Error ? error.message : "Unknown error"}</p>
        </div>
      </section>
    );
  }

  const announcements = data ?? [];

  const onMarkRead = async (announcementId: string) => {
    setBusyId(announcementId);
    try {
      await markAnnouncementRead(announcementId);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="student-workspace-shell">
      <header className="student-workspace-header">
        <div>
          <p className="resources-kicker">Student announcements</p>
          <h1>Stay updated with notices from your placement cell.</h1>
          <p>Important drive updates, reminders, and instructions appear here in one place.</p>
        </div>
      </header>

      <section className="student-workspace-panel">
        <div className="student-workspace-panel-head">
          <div>
            <h2>Announcements</h2>
            <p>{announcements.length} active notice(s)</p>
          </div>
        </div>

        {announcements.length === 0 ? (
          <p className="muted-text">No active announcements right now.</p>
        ) : (
          <div className="student-announcement-stack">
            {announcements.map((item) => {
              const expanded = expandedId === item.id;
              return (
                <div key={item.id} className={`student-announcement-row ${item.unread ? "unread" : ""}`}>
                  <div className="student-announcement-row-head">
                    <div>
                      <strong>{item.title}</strong>
                      <p>
                        {new Date(item.publishedAt).toLocaleString()}
                        {item.relatedDriveName ? ` • ${item.relatedDriveName}` : ""}
                      </p>
                    </div>
                    <div className="student-announcement-row-meta">
                      <Badge variant={item.priority === "urgent" ? "danger" : item.priority === "important" ? "warning" : "default"}>
                        {item.priority}
                      </Badge>
                      {item.unread ? <Badge variant="success">Unread</Badge> : null}
                    </div>
                  </div>
                  <p>{expanded ? item.message : `${item.message.slice(0, 220)}${item.message.length > 220 ? "..." : ""}`}</p>
                  <div className="hero-actions">
                    {item.message.length > 220 ? (
                      <Button variant="ghost" onClick={() => setExpandedId(expanded ? null : item.id)}>
                        {expanded ? "Show Less" : "Show More"}
                      </Button>
                    ) : null}
                    {item.unread ? (
                      <Button variant="secondary" disabled={busyId === item.id} onClick={() => void onMarkRead(item.id)}>
                        {busyId === item.id ? "Saving..." : "Mark Read"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
